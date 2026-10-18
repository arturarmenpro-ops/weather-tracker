// Варианты маршрута: идём по основному, а рядом смотрим ещё 1–3 маршрута — погода по датам, ETA, часы сверх пределов.
// Данные: voyage.json → "variants": [{ id, name, route:{name, wps}, dep, speed, speeds, startIdx, pos }].
// Основной маршрут считает и рисует app.js; здесь — только варианты (их погода по точкам, линии, «призраки» судна, сравнение).
(function () {
  const WT = (window.WT = window.WT || {});
  const H = 3600e3;
  // цвета вариантов (не совпадают со статусными зелёный/жёлтый/оранжевый/красный основного маршрута)
  const COLORS = ['#9085e9', '#e87ba4', '#3987e5', '#c3c2b7'];
  const MAIN_COLOR = '#f0efec';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f0 = (x) => (x == null || isNaN(x) ? '—' : Math.round(x).toString());
  const f1 = (x) => (x == null || isNaN(x) ? '—' : x.toFixed(1));
  const num = (x) => (Number.isFinite(+x) && +x > 0 ? +x : null);

  const V = { list: [], layer: null, ghosts: null };

  // из voyage.json — только проверенные поля
  WT.parseVariants = function (raw) {
    return (Array.isArray(raw) ? raw : []).slice(0, 4).map((v, k) => {
      const wps = ((v.route && v.route.wps) || []).map((w, i) => ({
        name: String(w.name || 'WP' + (i + 1)).slice(0, 30), lat: +w.lat, lon: +w.lon, geom: w.geom === 'GC' ? 'GC' : 'RL', speed: num(w.speed),
      })).filter((w) => Number.isFinite(w.lat) && Number.isFinite(w.lon) && Math.abs(w.lat) <= 90 && Math.abs(w.lon) <= 180);
      return {
        id: String(v.id || String.fromCharCode(66 + k)).slice(0, 12),
        name: String(v.name || (v.route && v.route.name) || 'Вариант ' + String.fromCharCode(66 + k)).slice(0, 60),
        route: { name: String((v.route && v.route.name) || v.name || '').slice(0, 60), wps },
        dep: Date.parse(v.dep), speed: num(v.speed), startIdx: Math.max(0, parseInt(v.startIdx, 10) || 0),
        speeds: Object.fromEntries(Object.entries(v.speeds || {}).filter(([, x]) => num(x)).map(([k2, x]) => [k2, num(x)])),
        pos: typeof v.pos === 'string' ? v.pos.slice(0, 60) : '',
        color: COLORS[k % COLORS.length],
      };
    }).filter((v) => v.route.wps.length >= 2);
  };

  // посчитать варианты: путь, точки расчёта, погода по точкам (последовательно — бережём лимит Open-Meteo)
  WT.buildVariants = async function (variants, main, ctx) {
    V.list = [];
    for (const v of variants) {
      let startPos = null;
      if (v.pos) { const f = WT.findLatLon(v.pos); if (f) startPos = { lat: f.lat, lon: f.lon }; }
      const voy = WT.buildVoyage(v.route, {
        startIdx: Math.min(v.startIdx, v.route.wps.length - 2), depMs: Number.isFinite(v.dep) ? v.dep : main.dep,
        speed: v.speed || main.speed, speeds: v.speeds, startPos,
      });
      const samples = WT.samples(voy, main.stepH);
      ctx.status && ctx.status('Вариант «' + v.name + '»: погода по маршруту…');
      const wx = await WT.fetchRouteWeather(samples, ctx);
      const sums = wx.map((w) => WT.summarize(w));
      V.list.push(Object.assign({}, v, { voy, samples, sums, sev: sums.map((s) => WT.severity(s, main.lim)) }));
    }
    return V.list;
  };
  WT.variantsList = () => V.list;
  WT.clearVariants = function (map) {
    if (V.layer) map.removeLayer(V.layer);
    if (V.ghosts) map.removeLayer(V.ghosts);
    V.layer = V.ghosts = null; V.list = [];
  };
  WT.resevVariants = function (lim) { for (const v of V.list) v.sev = v.sums.map((s) => WT.severity(s, lim)); };

  // линии вариантов на карте: свой цвет, пунктир; участки сверх пределов — красные точки
  WT.drawVariants = function (map, refLon) {
    if (V.layer) map.removeLayer(V.layer);
    V.layer = L.layerGroup().addTo(map);
    for (const v of V.list) {
      let ref = refLon;
      const line = WT.routeLine(v.route, 0).map(([la, lo]) => [la, (ref = near(lo, ref))]);
      L.polyline(line, { pane: 'route', color: '#000', weight: 6, opacity: 0.45, interactive: false }).addTo(V.layer);
      L.polyline(line, { pane: 'route', color: v.color, weight: 3.5, opacity: 0.95, dashArray: '8 6' })
        .bindTooltip(esc(v.name) + ' · ' + Math.round(v.voy.dist) + " миль · ETA " + WT.fmtTime(v.voy.eta) + ' UTC', { sticky: true })
        .addTo(V.layer);
      v.samples.forEach((s, i) => {
        if (v.sev[i] !== 'critical') return;
        L.circleMarker([s.lat, near(s.lon, refLon)], { pane: 'route', radius: 4, color: '#000', weight: 1, fillColor: WT.STATUS.critical, fillOpacity: 1 })
          .bindTooltip(esc(v.name) + ' · ' + WT.fmtTime(s.t) + ' UTC · сверх предела', { direction: 'top' }).addTo(V.layer);
      });
    }
  };
  const near = (lon, ref) => { while (lon - ref > 180) lon -= 360; while (lon - ref < -180) lon += 360; return lon; };

  // «призраки» судна на вариантах в то же время, что и основное судно
  WT.placeVariantShips = function (map, t, refLon) {
    if (!V.list.length) { if (V.ghosts) { map.removeLayer(V.ghosts); V.ghosts = null; } return; }
    if (!V.ghosts) V.ghosts = L.layerGroup().addTo(map);
    V.ghosts.clearLayers();
    for (const v of V.list) {
      if (t < v.voy.dep || t > v.voy.eta) continue;
      const p = WT.positionAt(v.voy, t);
      L.circleMarker([p.lat, near(p.lon, refLon)], { pane: 'route', radius: 6, color: v.color, weight: 3, fillColor: '#1a1a19', fillOpacity: 1, interactive: false }).addTo(V.ghosts);
    }
  };

  function sumAt(v, t) {
    const S = v.samples;
    if (!S.length || t < S[0].t - H || t > S[S.length - 1].t + H) return null;
    let best = 0;
    for (let i = 0; i < S.length; i++) if (Math.abs(S[i].t - t) < Math.abs(S[best].t - t)) best = i;
    return v.sums[best];
  }

  // строчки в карточку судна: погода на вариантах в это же время
  WT.variantsCardHtml = function (t) {
    if (!V.list.length) return '';
    const rows = V.list.map((v) => {
      const s = sumAt(v, t);
      const txt = !s || s.windSpd == null ? 'нет прогноза / вне рейса'
        : WT.compass(s.windDir) + ' ' + f0(s.windSpd) + ' уз · ' + WT.beaufort(s.windSpd).n + ' Бф' + (s.hs != null ? ' · волна ' + f1(s.hs) + ' м' : '');
      return '<div class="s"><span class="lg"><i style="background:' + v.color + '"></i>' + esc(v.name) + '</span>: ' + txt + '</div>';
    }).join('');
    return '<div class="row"><div class="k">Варианты в это же время</div>' + rows + '</div>';
  };

  // итог по маршруту: худший ветер и волна, часы сверх пределов, ETA
  function stats(name, color, voy, samples, sums, lim, stepH) {
    let wMax = null, wT = null, hMax = null, hT = null, hrsW = 0, hrsH = 0, noData = 0;
    const limKn = WT.bfEdge(lim.bf);
    samples.forEach((s, i) => {
      const x = sums[i];
      if (!x || x.windSpd == null) { noData++; return; }
      if (wMax == null || x.windSpd > wMax) { wMax = x.windSpd; wT = s.t; }
      if (x.hs != null && (hMax == null || x.hs > hMax)) { hMax = x.hs; hT = s.t; }
      if (x.windSpd >= limKn) hrsW += stepH;
      if (x.hs != null && x.hs >= lim.hs) hrsH += stepH;
    });
    return { name, color, dist: voy.dist, eta: voy.eta, wMax, wT, hMax, hT, hrsW, hrsH, noData, n: samples.length };
  }

  // окно «Сравнение маршрутов»: таблица + два графика по датам (одна линия на маршрут)
  WT.renderCompare = function (box, main, lim, stepH, onMakeMain) {
    const all = [stats('Основной: ' + main.name, MAIN_COLOR, main.voy, main.samples, main.sums, lim, stepH)]
      .concat(V.list.map((v) => stats(v.name, v.color, v.voy, v.samples, v.sums, lim, stepH)));
    const best = all.slice().sort((a, b) => (a.hrsW + a.hrsH) - (b.hrsW + b.hrsH) || (a.wMax || 0) - (b.wMax || 0))[0];
    const tr = all.map((r, k) => {
      const ok = r.hrsW + r.hrsH === 0;
      return '<tr><td><span class="lg"><i style="background:' + r.color + '"></i>' + esc(r.name) + '</span>' + (r === best ? ' <b class="agree good">лучший</b>' : '') + '</td>' +
        '<td>' + Math.round(r.dist) + "'</td><td>" + WT.fmtTime(r.eta) + '</td>' +
        '<td>' + (r.wMax == null ? '—' : f0(r.wMax) + ' уз · ' + WT.beaufort(r.wMax).n + ' Бф<br><span class="muted">' + WT.fmtTime(r.wT) + '</span>') + '</td>' +
        '<td>' + (r.hMax == null ? '—' : f1(r.hMax) + ' м · Д' + WT.douglasSea(r.hMax).n + '<br><span class="muted">' + WT.fmtTime(r.hT) + '</span>') + '</td>' +
        '<td>' + (ok ? '<span class="agree good">✓ нет</span>' : '<span class="agree critical">ветер ' + r.hrsW + ' ч · волна ' + r.hrsH + ' ч</span>') + '</td>' +
        '<td>' + (r.noData ? r.noData + ' из ' + r.n : '—') + '</td>' +
        '<td>' + (k > 0 ? '<button class="btn sm" data-main="' + (k - 1) + '">Сделать основным</button>' : '') + '</td></tr>';
    }).join('');
    box.innerHTML = '<table class="cmp"><thead><tr><th>Маршрут</th><th>Миль</th><th>ETA, UTC</th><th>Худший ветер</th><th>Худшая волна</th><th>Сверх пределов (' + lim.bf + ' Бф / ' + lim.hs + ' м)</th><th>Нет прогноза</th><th></th></tr></thead><tbody>' + tr + '</tbody></table>' +
      '<div class="cmp-charts"><div class="chart" id="cmpWind"></div><div class="chart" id="cmpWave"></div></div>' +
      '<div class="muted small" style="padding:6px 10px">Значения — медиана по моделям в точке судна на каждом маршруте. «Сверх пределов» — сколько часов ветер или волна не меньше пределов судна.</div>';
    const routes = [{ name: 'Основной', color: MAIN_COLOR, samples: main.samples, sums: main.sums }].concat(V.list);
    const t0 = Math.min(...routes.map((r) => r.samples[0].t)), t1 = Math.max(...routes.map((r) => r.samples[r.samples.length - 1].t));
    const maxW = Math.max(15, ...routes.flatMap((r) => r.sums.map((s) => (s && s.windSpd) || 0)));
    const maxH = Math.max(1.5, ...routes.flatMap((r) => r.sums.map((s) => (s && s.hs) || 0)));
    miniChart(box.querySelector('#cmpWind'), 'Ветер, уз', routes, (s) => s && s.windSpd, t0, t1, Math.max(maxW * 1.1, WT.bfEdge(lim.bf) + 3), WT.bfEdge(lim.bf), 'предел ' + lim.bf + ' Бф');
    miniChart(box.querySelector('#cmpWave'), 'Волна, м', routes, (s) => s && s.hs, t0, t1, Math.max(maxH * 1.15, lim.hs + 0.5), lim.hs, 'предел ' + lim.hs + ' м');
    box.querySelectorAll('[data-main]').forEach((b) => b.addEventListener('click', () => onMakeMain(+b.dataset.main)));
  };

  function miniChart(el, title, routes, val, t0, t1, yMax, limV, limLbl) {
    const W = Math.max(260, el.clientWidth - 8), Hc = 150;
    const m = { l: 30, r: 10, t: 6, b: 16 };
    const x = (t) => m.l + ((t - t0) / (t1 - t0 || 1)) * (W - m.l - m.r);
    const y = (v) => Hc - m.b - (v / yMax) * (Hc - m.t - m.b);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + Hc + '" preserveAspectRatio="none">';
    for (const v of [0, yMax / 2, yMax]) svg += '<text x="' + (m.l - 4) + '" y="' + (y(v) + 3) + '" fill="#8f8e86" font-size="9.5" text-anchor="end">' + (yMax < 10 ? v.toFixed(1) : Math.round(v)) + '</text>';
    svg += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#52514e"/>';
    for (let t = Math.ceil(t0 / (24 * H)) * 24 * H; t < t1; t += 24 * H) {
      svg += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + m.t + '" y2="' + y(0) + '" stroke="#2c2c2a" stroke-dasharray="2 3"/>' +
        '<text x="' + (x(t) + 3) + '" y="' + (Hc - 3) + '" fill="#8f8e86" font-size="9.5">' + WT.fmtDay(t) + '</text>';
    }
    if (limV < yMax) svg += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(limV) + '" y2="' + y(limV) + '" stroke="#d03b3b" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (m.l + 4) + '" y="' + (y(limV) - 3) + '" fill="#e66767" font-size="9.5">' + limLbl + '</text>';
    for (const r of routes) {
      let d = '', pen = false;
      r.samples.forEach((s, i) => {
        const v = val(r.sums[i]);
        if (v == null) { pen = false; return; }
        d += (pen ? 'L' : 'M') + x(s.t).toFixed(1) + ' ' + y(v).toFixed(1) + ' '; pen = true;
      });
      if (d) svg += '<path d="' + d + '" fill="none" stroke="' + r.color + '" stroke-width="2" stroke-linejoin="round"/>';
    }
    el.innerHTML = '<div class="ch-head"><b>' + title + '</b>' + routes.map((r) => '<span class="lg"><i style="background:' + r.color + '"></i>' + esc(r.name) + '</span>').join('') + '</div>' + svg + '</svg>';
  }
})();
