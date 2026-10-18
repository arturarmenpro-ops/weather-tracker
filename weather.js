// Погода: запросы к Open-Meteo (через наш сервер с кэшем), несколько моделей, сравнение между ними.
(function () {
  const WT = (window.WT = window.WT || {});
  const H = 3600e3;

  // Модели — те же, что показывает Windy. Цвет закреплён за моделью (одинаковый на графиках и в карточке).
  WT.WIND_MODELS = [
    { id: 'ecmwf_ifs025', name: 'ECMWF', full: 'ECMWF IFS 0.25° (Европа)', color: '#3987e5' },
    { id: 'gfs_seamless', name: 'GFS', full: 'NOAA GFS (США)', color: '#d95926' },
    { id: 'icon_seamless', name: 'ICON', full: 'DWD ICON (Германия)', color: '#199e70' },
  ];
  WT.WAVE_MODELS = [
    { id: 'ecmwf_wam025', name: 'ECMWF WAM', full: 'ECMWF WAM (Европа) — только общая волна', color: '#3987e5', split: false },
    { id: 'ncep_gfswave025', name: 'NOAA WW3', full: 'NOAA GFS-Wave / WaveWatch III (США)', color: '#d95926', split: true },
    { id: 'dwd_gwam', name: 'DWD GWAM', full: 'DWD GWAM (Германия)', color: '#199e70', split: true },
    { id: 'meteofrance_wave', name: 'MF MFWAM', full: 'Météo-France MFWAM', color: '#c98500', split: true },
  ];
  WT.CURRENT_SOURCE = 'Copernicus Marine / Mercator (через Météo-France SMOC)';

  const WIND_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl'];
  // Open-Meteo считает «вес» запроса как (переменные × модели) / 10 на каждую точку (не меньше 1),
  // поэтому общую волну берём у всех 4 моделей, а ветровую волну и зыбь — отдельно у 3 моделей, где они есть.
  const WAVE_VARS = ['wave_height', 'wave_direction', 'wave_period'];
  const SPLIT_VARS = ['wind_wave_height', 'wind_wave_direction', 'wind_wave_period', 'swell_wave_height', 'swell_wave_direction', 'swell_wave_period'];
  const CUR_VARS = ['ocean_current_velocity', 'ocean_current_direction'];
  // сетка карты (одна модель): ветер + слои «как у Windy»
  const GRID_VARS = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'pressure_msl', 'precipitation', 'cloud_cover', 'visibility'];
  const FC = 'https://api.open-meteo.com/v1/forecast', MAR = 'https://marine-api.open-meteo.com/v1/marine';

  // ---------- запрос: через наш сервер с кэшем (на Маке), а если сервера нет (страница по ссылке) — напрямую ----------
  let direct = false;
  async function get(url) {
    if (!direct) {
      try {
        const r = await fetch('/api/om?u=' + encodeURIComponent(url));
        if (r.status !== 404 && r.status !== 405 && (r.headers.get('content-type') || '').includes('json')) return r;
      } catch (e) { /* нет сервера */ }
      direct = true;
    }
    return fetch(url);
  }
  // ctx: функция-сообщение или { status(msg), alive() } — alive() === false значит расчёт уже заменён новым, бросаем
  const ctxOf = (x) => (typeof x === 'function' ? { status: x } : x || {});
  const CANCELLED = 'cancelled';
  const say = (x, msg) => { const c = ctxOf(x); if (c.status) c.status(msg); };
  WT.isCancelled = (e) => e && e.message === CANCELLED;
  WT.staleAge = 0; // если сервер отдал сохранённый прогноз без связи — сколько секунд ему
  async function om(url, x) {
    const ctx = ctxOf(x), alive = () => !ctx.alive || ctx.alive();
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!alive()) throw new Error(CANCELLED);
      let r;
      try { r = await get(url); } catch (e) { throw new Error('Нет интернета или Open-Meteo недоступен'); }
      let j;
      try { j = await r.json(); } catch (e) { throw new Error('Сервер ответил не JSON (' + r.status + ')'); }
      if (r.ok && !j.error) {
        const stale = +(r.headers.get('X-WT-Stale') || 0);
        if (stale) WT.staleAge = Math.max(WT.staleAge, stale);
        return Array.isArray(j) ? j : [j];
      }
      const msg = j.reason || j.error || 'ошибка ' + r.status;
      if (/daily/i.test(msg)) throw new Error('Дневной лимит бесплатного Open-Meteo исчерпан — попробуйте завтра (сброс в 00:00 UTC)');
      if (/hourly/i.test(msg)) throw new Error('Часовой лимит бесплатного Open-Meteo исчерпан — попробуйте в начале следующего часа');
      if (/minutely|limit|too many/i.test(msg) && attempt < 2) { // минутный лимит — ждём и повторяем
        ctx.status && ctx.status('Лимит запросов Open-Meteo в минуту — жду минуту…');
        for (let k = 0; k < 61 && alive(); k++) await new Promise((res) => setTimeout(res, 1000));
        continue;
      }
      throw new Error(msg);
    }
  }

  // даты запроса: не раньше 90 дней назад и не дальше 15 суток вперёд
  function dateRange(t0, t1) {
    const now = Date.now();
    const a = Math.max(t0, now - 90 * 24 * H), b = Math.min(t1, now + 15 * 24 * H);
    if (b < a) return null;
    return { start: WT.isoDate(a), end: WT.isoDate(b) };
  }

  // много точек — частями по 100
  async function multi(base, params, pts, onWait) {
    const out = [];
    for (let i = 0; i < pts.length; i += 100) {
      const ctx = ctxOf(onWait);
      if (ctx.alive && !ctx.alive()) throw new Error(CANCELLED);
      const chunk = pts.slice(i, i + 100);
      const lat = chunk.map((p) => p.lat.toFixed(3)).join(','), lon = chunk.map((p) => WT.wrap180(p.lon).toFixed(3)).join(',');
      const res = await om(base + '?latitude=' + lat + '&longitude=' + lon + '&' + params, onWait);
      out.push(...res);
    }
    return out;
  }

  const pick = (h, v, m) => (h[v + '_' + m] !== undefined ? h[v + '_' + m] : h[v]);
  const tIndex = (res) => { const t0 = Date.parse(res.hourly.time[0] + 'Z'); return (t) => Math.round((t - t0) / H); };
  const at = (arr, i) => (arr && i >= 0 && i < arr.length ? arr[i] : null);

  // ================= ПОГОДА ПО ТОЧКАМ МАРШРУТА =================
  WT.fetchRouteWeather = async function (samples, onStatus) {
    const t0 = samples[0].t, t1 = samples[samples.length - 1].t;
    const rng = dateRange(t0 - H, t1 + H);
    const out = samples.map(() => ({ wind: {}, wave: {}, cur: null, pres: null }));
    if (!rng) return out;
    const common = '&timezone=GMT&wind_speed_unit=kn&cell_selection=sea&start_date=' + rng.start + '&end_date=' + rng.end;

    say(onStatus, 'Ветер: ECMWF, GFS, ICON…');
    const w = await multi(FC, 'hourly=' + WIND_VARS.join(',') + '&models=' + WT.WIND_MODELS.map((m) => m.id).join(',') + common, samples, onStatus);
    say(onStatus, 'Волна и зыбь: 4 модели…');
    const v = await multi(MAR, 'hourly=' + WAVE_VARS.join(',') + '&models=' + WT.WAVE_MODELS.map((m) => m.id).join(',') + common, samples, onStatus);
    const v2 = await multi(MAR, 'hourly=' + SPLIT_VARS.join(',') + '&models=' + WT.WAVE_MODELS.filter((m) => m.split).map((m) => m.id).join(',') + common, samples, onStatus);
    say(onStatus, 'Течения…');
    const c = await multi(MAR, 'hourly=' + CUR_VARS.join(',') + common, samples, onStatus);

    samples.forEach((s, k) => {
      const o = out[k];
      if (w[k]) {
        const h = w[k].hourly, i = tIndex(w[k])(s.t);
        for (const m of WT.WIND_MODELS) {
          const spd = at(pick(h, 'wind_speed_10m', m.id), i);
          if (spd == null) continue;
          o.wind[m.id] = { spd, dir: at(pick(h, 'wind_direction_10m', m.id), i), gust: at(pick(h, 'wind_gusts_10m', m.id), i), pres: at(pick(h, 'pressure_msl', m.id), i) };
        }
      }
      if (v[k]) {
        const h = v[k].hourly, i = tIndex(v[k])(s.t);
        const h2 = v2[k] && v2[k].hourly, i2 = v2[k] ? tIndex(v2[k])(s.t) : -1;
        for (const m of WT.WAVE_MODELS) {
          const hs = at(pick(h, 'wave_height', m.id), i);
          if (hs == null) continue;
          const g = (n) => (WAVE_VARS.includes(n) ? at(pick(h, n, m.id), i) : m.split && h2 ? at(pick(h2, n, m.id), i2) : null);
          o.wave[m.id] = {
            hs, dir: g('wave_direction'), tp: g('wave_period'),
            wwH: g('wind_wave_height'), wwDir: g('wind_wave_direction'), wwT: g('wind_wave_period'),
            swH: g('swell_wave_height'), swDir: g('swell_wave_direction'), swT: g('swell_wave_period'),
          };
        }
      }
      if (c[k]) {
        const h = c[k].hourly, i = tIndex(c[k])(s.t);
        const spd = at(h.ocean_current_velocity, i);
        if (spd != null) o.cur = { spd, dir: at(h.ocean_current_direction, i) };
      }
    });
    return out;
  };

  // ---------- сводка по моделям: среднее (медиана), разброс, согласие ----------
  const median = (a) => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  function vecMeanDir(dirs) {
    let x = 0, y = 0;
    for (const d of dirs) { x += Math.sin((d * Math.PI) / 180); y += Math.cos((d * Math.PI) / 180); }
    return dirs.length ? ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360 : null;
  }

  WT.summarize = function (wx) {
    const S = { models: { wind: {}, wave: {} } };
    // ветер
    const ws = Object.entries(wx.wind);
    if (ws.length) {
      const spd = ws.map(([, v]) => v.spd);
      S.windSpd = median(spd);
      S.windMin = Math.min(...spd); S.windMax = Math.max(...spd);
      S.windDir = vecMeanDir(ws.map(([, v]) => v.dir).filter((d) => d != null));
      S.gust = median(ws.map(([, v]) => v.gust).filter((g) => g != null));
      S.pres = median(ws.map(([, v]) => v.pres).filter((g) => g != null));
      for (const [id, v] of ws) S.models.wind[id] = v.spd;
      const dBf = WT.beaufort(S.windMax).n - WT.beaufort(S.windMin).n;
      S.windAgree = ws.length < 2 ? 'none' : dBf <= 1 ? 'good' : dBf === 2 ? 'warning' : 'critical';
    }
    // волна
    const vs = Object.entries(wx.wave);
    if (vs.length) {
      const hs = vs.map(([, v]) => v.hs);
      S.hs = median(hs); S.hsMin = Math.min(...hs); S.hsMax = Math.max(...hs);
      S.waveDir = vecMeanDir(vs.map(([, v]) => v.dir).filter((d) => d != null));
      S.tp = median(vs.map(([, v]) => v.tp).filter((d) => d != null));
      for (const [id, v] of vs) S.models.wave[id] = v.hs;
      const spread = S.hsMax - S.hsMin - 0.01; // 0.01 — запас на округление (модели дают высоту с точностью 0.1 м)
      S.waveAgree = vs.length < 2 ? 'none' : spread <= Math.max(0.5, 0.25 * S.hs) ? 'good' : spread <= Math.max(1.0, 0.5 * S.hs) ? 'warning' : 'critical';
      // ветровая волна и зыбь — из моделей, где они есть раздельно
      const sp = vs.filter(([id, v]) => v.swH != null);
      if (sp.length) {
        S.swH = median(sp.map(([, v]) => v.swH));
        S.swT = median(sp.map(([, v]) => v.swT).filter((x) => x != null));
        S.swDir = vecMeanDir(sp.map(([, v]) => v.swDir).filter((x) => x != null));
        S.wwH = median(sp.map(([, v]) => v.wwH).filter((x) => x != null));
        S.wwT = median(sp.map(([, v]) => v.wwT).filter((x) => x != null));
        S.wwDir = vecMeanDir(sp.map(([, v]) => v.wwDir).filter((x) => x != null));
      }
    }
    if (wx.cur) { S.curSpd = wx.cur.spd; S.curDir = wx.cur.dir; }
    return S;
  };

  // уровень опасности для раскраски маршрута — от пределов судна
  WT.severity = function (S, lim) {
    if (!S || S.windSpd == null && S.hs == null) return 'none';
    const bf = S.windSpd != null ? WT.beaufort(S.windSpd).n : 0, hs = S.hs || 0;
    if (bf >= lim.bf || hs >= lim.hs) return 'critical';
    if (bf >= lim.bf - 1 || hs >= 0.75 * lim.hs) return 'serious';
    if (bf >= lim.bf - 2 || hs >= 0.5 * lim.hs) return 'warning';
    return 'good';
  };

  // плавный переход между двумя сводками (для анимации между точками)
  WT.lerpSummary = function (a, b, f) {
    if (!a) return b; if (!b) return a;
    const o = {};
    for (const k of Object.keys(a)) {
      const x = a[k], y = b[k];
      if (typeof x === 'number' && typeof y === 'number') {
        if (/Dir$/.test(k)) { let d = ((y - x + 540) % 360) - 180; o[k] = (x + d * f + 360) % 360; }
        else o[k] = x + (y - x) * f;
      } else if (x && typeof x === 'object' && y && typeof y === 'object') o[k] = WT.lerpSummary(x, y, f);
      else o[k] = f < 0.5 ? x : y;
    }
    return o;
  };

  // ================= СЕТКА ДЛЯ КАРТЫ (как у Windy: заливка + частицы) =================
  WT.gridFor = function (bounds) {
    // bounds: {s, n, w, e} (долготы могут выходить за 180 — так маршрут не рвётся)
    // поле вокруг маршрута с запасом, чтобы была видна обстановка рядом (как у Windy)
    const mLat = Math.max(5, 0.4 * (bounds.n - bounds.s)), mLon = Math.max(7, 0.3 * (bounds.e - bounds.w));
    let s = Math.max(-78, bounds.s - mLat), n = Math.min(80, bounds.n + mLat), w = bounds.w - mLon, e = bounds.e + mLon;
    const area = (n - s) * (e - w);
    let step = Math.sqrt(area / 150); // ~150 точек: сетка ветра + волн ≈ 300 «запросов» из 600 в минуту
    step = [0.5, 0.75, 1, 1.5, 2, 2.5, 3, 4, 5].find((x) => x >= step) || 5;
    s = Math.floor(s / step) * step; n = Math.ceil(n / step) * step;
    w = Math.floor(w / step) * step; e = Math.ceil(e / step) * step;
    const ny = Math.round((n - s) / step) + 1, nx = Math.round((e - w) / step) + 1;
    const pts = [];
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) pts.push({ lat: n - r * step, lon: w + c * step });
    return { s, n, w, e, step, nx, ny, pts };
  };

  WT.fetchGrid = async function (g, t0, t1, windModel, onStatus) {
    const rng = dateRange(t0 - 3 * H, t1 + 3 * H);
    if (!rng) throw new Error('Даты рейса вне прогноза');
    const common = '&timezone=GMT&wind_speed_unit=kn&start_date=' + rng.start + '&end_date=' + rng.end;
    say(onStatus, 'Карта ветра (' + g.pts.length + ' точек)…');
    const w = await multi(FC, 'hourly=' + GRID_VARS.join(',') + '&models=' + windModel + '&cell_selection=sea' + common, g.pts, onStatus);
    say(onStatus, 'Карта волн и течений…');
    const m = await multi(MAR, 'hourly=wave_height,swell_wave_height,wind_wave_height,' + CUR_VARS.join(',') + '&cell_selection=sea' + common, g.pts, onStatus);

    const times = w[0].hourly.time.map((x) => Date.parse(x + 'Z'));
    const nt = times.length, np = g.pts.length;
    const mk = () => Array.from({ length: nt }, () => new Array(np).fill(null));
    const G = { ...g, times, windModel, wind: { spd: mk(), u: mk(), v: mk() }, gust: mk(), pres: mk(), rain: mk(), cloud: mk(), vis: mk(), hs: mk(), sw: mk(), ww: mk(), cur: { spd: mk(), u: mk(), v: mk() } };
    const KN = 0.514444;
    for (let k = 0; k < np; k++) {
      const h = w[k] && w[k].hourly;
      if (h) {
        const S = pick(h, 'wind_speed_10m', windModel), D = pick(h, 'wind_direction_10m', windModel);
        const GU = pick(h, 'wind_gusts_10m', windModel) || [], PR = pick(h, 'pressure_msl', windModel) || [];
        const RA = pick(h, 'precipitation', windModel) || [], CL = pick(h, 'cloud_cover', windModel) || [], VI = pick(h, 'visibility', windModel) || [];
        for (let t = 0; t < nt; t++) {
          G.gust[t][k] = at(GU, t); G.pres[t][k] = at(PR, t); G.rain[t][k] = at(RA, t); G.cloud[t][k] = at(CL, t);
          const vi = at(VI, t); G.vis[t][k] = vi == null ? null : vi / 1000; // м → км
          const s = S[t], d = D[t];
          if (s == null || d == null) continue;
          const r = (d * Math.PI) / 180, ms = s * KN;
          G.wind.spd[t][k] = s; G.wind.u[t][k] = -ms * Math.sin(r); G.wind.v[t][k] = -ms * Math.cos(r); // «откуда» → вектор
        }
      }
      const hm = m[k] && m[k].hourly;
      if (hm) {
        const mt0 = Date.parse(hm.time[0] + 'Z'), off = Math.round((times[0] - mt0) / H);
        for (let t = 0; t < nt; t++) {
          const j = t + off;
          G.hs[t][k] = at(hm.wave_height, j); G.sw[t][k] = at(hm.swell_wave_height, j); G.ww[t][k] = at(hm.wind_wave_height, j);
          const cs = at(hm.ocean_current_velocity, j), cd = at(hm.ocean_current_direction, j);
          if (cs != null && cd != null) {
            const r = (cd * Math.PI) / 180, ms = cs * KN;
            G.cur.spd[t][k] = cs; G.cur.u[t][k] = ms * Math.sin(r); G.cur.v[t][k] = ms * Math.cos(r); // течение «куда»
          }
        }
      }
    }
    return G;
  };

  // У ECMWF в Open-Meteo нет видимости (у ICON — только у Европы и ~5 суток). Если слой пуст — догружаем видимость из GFS.
  WT.gridHasData = (arr2d) => arr2d.some((row) => row.some((v) => v != null));
  WT.visGaps = (G) => G.vis.some((row, t) => row.some((v, k) => v == null && G.wind.spd[t][k] != null));
  WT.fetchGridVis = async function (G, onStatus) {
    const had = WT.gridHasData(G.vis);
    const t0 = G.times[0], t1 = G.times[G.times.length - 1];
    const rng = dateRange(t0, t1);
    if (!rng) return false;
    say(onStatus, 'Видимость (GFS)…');
    const r = await multi(FC, 'hourly=visibility&models=gfs_seamless&cell_selection=sea&timezone=GMT&start_date=' + rng.start + '&end_date=' + rng.end, G.pts, onStatus);
    for (let k = 0; k < G.pts.length; k++) {
      const h = r[k] && r[k].hourly;
      if (!h) continue;
      const off = Math.round((G.times[0] - Date.parse(h.time[0] + 'Z')) / H), V = pick(h, 'visibility', 'gfs_seamless');
      for (let t = 0; t < G.times.length; t++) { if (G.vis[t][k] != null) continue; const x = at(V, t + off); G.vis[t][k] = x == null ? null : x / 1000; }
    }
    G.visSource = had ? (WT.WIND_MODELS.find((m) => m.id === G.windModel) || {}).name + ' + GFS' : 'GFS';
    return true;
  };

  // значение поля сетки в точке (билинейно, пустые клетки — суша — пропускаем)
  WT.gridSample = function (G, arr, lat, lon) {
    let x = (lon - G.w) / G.step, y = (G.n - lat) / G.step;
    if (x < 0 || y < 0 || x > G.nx - 1 || y > G.ny - 1) return null;
    const x0 = Math.min(Math.floor(x), G.nx - 2), y0 = Math.min(Math.floor(y), G.ny - 2);
    const fx = x - x0, fy = y - y0;
    let sum = 0, wsum = 0;
    const add = (r, c, wgt) => { const v = arr[r * G.nx + c]; if (v != null && wgt > 0) { sum += v * wgt; wsum += wgt; } };
    add(y0, x0, (1 - fx) * (1 - fy)); add(y0, x0 + 1, fx * (1 - fy)); add(y0 + 1, x0, (1 - fx) * fy); add(y0 + 1, x0 + 1, fx * fy);
    return wsum > 0.15 ? sum / wsum : null;
  };
})();
