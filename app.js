// Weather Tracker — дашборд: карта как у Windy, маршрут, судно по времени, сравнение моделей.
(function () {
  const WT = window.WT;
  const $ = (id) => document.getElementById(id);
  const H = 3600e3;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem('wt.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('wt.' + k, JSON.stringify(v)); } catch (e) { /* приватный режим */ } },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const f1 = (x) => (x == null || isNaN(x) ? '—' : x.toFixed(1));
  const f0 = (x) => (x == null || isNaN(x) ? '—' : Math.round(x).toString());

  const st = {
    route: null, voy: null, samples: [], sums: [], sev: [], grid: null, t: 0, playing: false,
    layer: LS.get('layer', 'wind'), particles: LS.get('particles', true), seamarks: LS.get('seamarks', false), isobars: LS.get('isobars', true),
    mapModel: LS.get('mapModel', 'ecmwf_ifs025'), tz: LS.get('tz', 0), stepH: LS.get('stepH', 3),
    lim: LS.get('lim', { bf: 7, hs: 4 }), speed: LS.get('speed', 12), rate: LS.get('rate', 3),
    speeds: {}, hasServer: false, sampleLon: [],
  };

  // ======================= КАРТА =======================
  const map = L.map('map', { zoomControl: false, minZoom: 2, worldCopyJump: false }).setView([40, 0], 4);
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  WT.map = map;
  for (const [name, z] of [['wx', 250], ['labels', 330], ['seamarks', 340], ['route', 450]]) {
    map.createPane(name); map.getPane(name).style.zIndex = z;
    if (name !== 'route') map.getPane(name).style.pointerEvents = 'none';
  }
  const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/';
  L.tileLayer(ESRI + 'World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, attribution: 'Карта © Esri, © OpenStreetMap · <a href="https://open-meteo.com/" target="_blank" rel="noopener">Weather data by Open-Meteo.com</a> (CC BY 4.0: ECMWF, NOAA, DWD, Météo-France, Copernicus)' }).addTo(map);
  L.tileLayer(ESRI + 'World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16, pane: 'labels' }).addTo(map);
  const seamarks = L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', { maxZoom: 18, pane: 'seamarks', attribution: '© OpenSeaMap' });
  const planLayer = L.layerGroup().addTo(map), segLayer = L.layerGroup().addTo(map);
  let shipMarker = null, overlay = null, vel = null;

  const SHIP_SVG = '<svg viewBox="0 0 26 26"><path d="M13 2 L19 21 L13 17.5 L7 21 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';

  // ======================= СООБЩЕНИЯ =======================
  let toastTimer = null;
  function toast(msg, isErr, ms) {
    const t = $('toast');
    t.textContent = msg; t.hidden = !msg; t.classList.toggle('err', !!isErr);
    clearTimeout(toastTimer);
    if (msg && ms !== 0) toastTimer = setTimeout(() => (t.hidden = true), ms || (isErr ? 9000 : 3500));
  }

  // ======================= МАРШРУТЫ =======================
  async function loadRouteList() {
    let list = [];
    try {
      const r = await fetch('/api/routes');
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) { list = await r.json(); st.hasServer = true; }
    } catch (e) { /* без сервера */ }
    if (!st.hasServer) {
      try { const r = await fetch('routes/index.json'); if (r.ok) list = await r.json(); } catch (e) { /* нет списка */ }
    }
    // рейс, присланный капитаном (через Telegram) — voyage.json рядом со страницей
    st.voyage = null;
    try {
      const r = await fetch('voyage.json', { cache: 'no-store' });
      if (r.ok && (r.headers.get('content-type') || '').includes('json')) st.voyage = await r.json();
    } catch (e) { /* рейса нет */ }
    st.viewer = !st.hasServer && !!st.voyage; // страница по ссылке: показываем только присланный рейс
    document.body.classList.toggle('viewer', st.viewer);
    document.body.classList.toggle('noserver', !st.hasServer);
    const sel = $('routeSel');
    sel.innerHTML = (st.voyage ? '<option value="__voyage__">★ Рейс из Telegram' + (st.voyage.route && st.voyage.route.name ? ': ' + esc(st.voyage.route.name) : '') + '</option>' : '') +
      '<option value="">— выбрать —</option>' + list.map((x) => '<option value="' + esc(x.name || x) + '">' + esc(x.name || x) + '</option>').join('');
    return (st.voyage ? ['__voyage__'] : []).concat(list.map((x) => x.name || x));
  }

  async function openRouteByName(name) {
    if (!name) return;
    if (name === '__voyage__') return useVoyage(st.voyage);
    st.variantsData = []; // у отдельного файла маршрута вариантов нет
    try {
      const r = await fetch('routes/' + encodeURIComponent(name));
      if (!r.ok) throw new Error('файл не найден');
      useRoute(name, await r.text());
    } catch (e) { toast('Не открылся маршрут ' + name + ': ' + e.message, true); }
  }

  async function openFile(file) {
    let text = await file.text();
    // файл из Windows в старой кодировке: «°» превращается в «�» — перечитываем как Windows-1252
    if (text.includes('\uFFFD')) { try { text = new TextDecoder('windows-1252').decode(await file.arrayBuffer()); } catch (e) { /* оставляем как есть */ } }
    let name = file.name;
    let route;
    try { route = WT.parseRoute(file.name, text); } catch (e) { return toast(e.message, true); }
    if (st.hasServer) { // сохраняем в папку routes/, чтобы был в списке
      try {
        const r = await fetch('/api/routes?name=' + encodeURIComponent(file.name), { method: 'POST', body: text });
        const j = await r.json();
        if (j.name) name = j.name;
        await loadRouteList();
        $('routeSel').value = name;
      } catch (e) { /* не страшно */ }
    }
    route.file = name;
    st.variantsData = [];
    useRoute(name, text, route);
  }

  function useVoyage(v) {
    const num = (x) => (Number.isFinite(+x) && +x > 0 ? +x : null); // из рейса берём только числа
    if (!v || !v.route || !v.route.wps || v.route.wps.length < 2) return toast('В рейсе из Telegram нет маршрута', true);
    const route = {
      format: 'Telegram', file: '__voyage__', name: v.route.name || 'Рейс', vessel: v.route.vessel || v.vessel || '',
      wps: v.route.wps.map((w, i) => ({ name: w.name || 'WP' + (i + 1), lat: +w.lat, lon: +w.lon, geom: w.geom === 'GC' ? 'GC' : 'RL', speed: num(w.speed) })),
      updated: v.updated || '', source: v.source || '', note: v.note || '',
    };
    st.voyageRaw = v;
    st.variantsData = WT.parseVariants(v.variants);
    useRoute('__voyage__', null, route, {
      updated: v.updated || '', dep: Date.parse(v.dep), speed: num(v.speed), startIdx: Math.max(0, parseInt(v.startIdx, 10) || 0), speeds: Object.fromEntries(Object.entries(v.speeds || {}).filter(([, x]) => num(x)).map(([k, x]) => [k, num(x)])),
      pos: v.pos || '', lim: v.limits, tz: v.tz,
    });
  }

  function useRoute(name, text, parsed, preset) {
    let route;
    try { route = parsed || WT.parseRoute(name, text); } catch (e) { return toast(e.message, true); }
    stop();
    st.route = route; st.voy = null; st.samples = []; st.sums = []; st.grid = null; clearWeather();
    LS.set('route', name);
    $('routeSel').value = name;
    let saved = LS.get('r.' + name, {});
    // новый рейс из Telegram важнее того, что человек поменял у себя раньше
    if (preset && saved.updated !== preset.updated) saved = Object.assign({}, preset);
    // пределы и судовое время: из нового рейса, а если человек их у себя менял — его значения (как и для скорости/отхода)
    if (saved.lim) { st.lim = saved.lim; $('limBf').value = st.lim.bf; $('limHs').value = st.lim.hs; }
    if (saved.tz != null) { st.tz = +saved.tz || 0; $('tz').value = st.tz; }
    st.speeds = saved.speeds || {};
    $('pos').value = saved.pos || '';
    // отход: из файла (RTZ-расписание) → сохранённый → ближайший час
    const now = Math.ceil(Date.now() / H) * H;
    const dep = saved.dep || route.etd || now;
    $('dep').value = new Date(dep).toISOString().slice(0, 16);
    $('speed').value = saved.speed || (preset && preset.speed) || st.speed;
    const sw = $('startWp');
    sw.innerHTML = route.wps.slice(0, -1).map((w, i) => '<option value="' + i + '">' + (i + 1) + '. ' + esc(w.name) + '</option>').join('');
    sw.value = Math.min(saved.startIdx || 0, route.wps.length - 2);
    const tot = route.wps.slice(1).reduce((s, w, i) => s + (w.geom === 'GC' ? WT.great(route.wps[i], w) : WT.rhumb(route.wps[i], w)).dist, 0);
    $('routeInfo').innerHTML = '<b>' + esc(route.name) + '</b> · ' + route.format + ' · ' + route.wps.length + ' точек · ' + Math.round(tot) + ' миль' + (route.vessel ? ' · ' + esc(route.vessel) : '') + (route.etd ? ' · ETD из файла' : '') +
      (route.updated ? '<br>Получен ' + WT.fmtTime(Date.parse(route.updated)) + ' UTC' + (route.source ? ' · ' + esc(route.source) : '') : '') +
      (route.note ? '<br>' + esc(route.note) : '');
    renderWpTable();
    drawPlan();
    map.fitBounds(L.latLngBounds(WT.unwrap(route.wps)).pad(0.15), { paddingTopLeft: [window.innerWidth > 760 ? 370 : 0, 40], paddingBottomRight: [window.innerWidth > 760 ? 170 : 0, 40] });
    $('build').disabled = false;
    build();
  }

  function renderWpTable() {
    const r = st.route, start = st.voy ? st.voy.startIdx + (st.voy.startPos ? 1 : 0) : +$('startWp').value || 0;
    $('wpCount').textContent = '(' + r.wps.length + ')';
    $('wpTable').querySelector('tbody').innerHTML = r.wps.map((w, i) => {
      const leg = i === 0 ? '' : (w.geom === 'GC' ? 'GC ' : 'RL ') + WT.deg3((w.geom === 'GC' ? WT.great(r.wps[i - 1], w) : WT.rhumb(r.wps[i - 1], w)).course) + ' ' + Math.round((w.geom === 'GC' ? WT.great(r.wps[i - 1], w) : WT.rhumb(r.wps[i - 1], w)).dist) + "'";
      const sp = i === 0 ? '' : '<input type="number" step="0.5" min="1" max="40" data-i="' + i + '" value="' + esc(st.speeds[i] || w.speed || '') + '" placeholder="' + esc($('speed').value) + '">';
      return '<tr class="' + (i < start ? 'before' : '') + '"><td>' + (i + 1) + '</td><td class="nm" title="' + esc(w.name) + '">' + esc(w.name) + '</td><td>' + WT.fmtLat(w.lat) + '</td><td>' + WT.fmtLon(w.lon) + '</td><td>' + leg + '</td><td>' + sp + '</td></tr>';
    }).join('');
  }

  function saveRouteSettings() {
    if (!st.route) return;
    LS.set('r.' + st.route.file, { dep: Date.parse($('dep').value + 'Z'), speed: +$('speed').value, startIdx: +$('startWp').value, speeds: st.speeds, pos: $('pos').value.trim(), updated: st.route.updated || undefined, lim: st.lim, tz: st.tz });
  }

  function drawPlan() {
    planLayer.clearLayers();
    const r = st.route;
    L.polyline(WT.routeLine(r, 0), { pane: 'route', color: '#ffffff', weight: 1.5, opacity: 0.55, dashArray: '4 6', interactive: false }).addTo(planLayer);
    const un = WT.unwrap(r.wps);
    r.wps.forEach((w, i) => {
      L.circleMarker(un[i], { pane: 'route', radius: 4, color: '#fff', weight: 1.5, fillColor: '#1a1a19', fillOpacity: 1 })
        .bindTooltip((i + 1) + '. ' + esc(w.name) + '<br>' + WT.fmtLat(w.lat) + ' ' + WT.fmtLon(w.lon) + '<span class="wpEta" data-i="' + i + '"></span>', { direction: 'top' })
        .on('tooltipopen', (e) => {
          const leg = st.voy && st.voy.legs.find((l) => l.i === i);
          const el = e.tooltip.getElement().querySelector('.wpEta');
          if (el) el.innerHTML = leg ? '<br>ETA ' + WT.fmtTime(leg.t1) + ' UTC' : '';
        })
        .addTo(planLayer);
    });
  }

  const posLayer = L.layerGroup().addTo(map);
  function drawPos() {
    posLayer.clearLayers();
    const p = st.voy && st.voy.startPos;
    if (!p) return;
    L.circleMarker([p.lat, near(p.lon, planRef())], { pane: 'route', radius: 6, color: '#fab219', weight: 2, fillColor: '#1a1a19', fillOpacity: 1 })
      .bindTooltip('Позиция судна ' + WT.fmtLat(p.lat) + ' ' + WT.fmtLon(p.lon) + '<br>' + WT.fmtTime(st.voy.dep) + ' UTC → к точке ' + (st.voy.startIdx + 2) + '. ' + esc(st.route.wps[st.voy.startIdx + 1].name), { direction: 'top' })
      .addTo(posLayer);
  }

  // ======================= РАСЧЁТ =======================
  let buildId = 0;
  // поля меняют часто — считаем заново через 0.7 с после последней правки, а не на каждое нажатие
  let buildTimer = null;
  const buildSoon = () => { clearTimeout(buildTimer); buildTimer = setTimeout(() => { if (st.route) build(); }, 700); };
  async function build() {
    if (!st.route) return;
    const id = ++buildId;
    stop();
    const dep = Date.parse($('dep').value + 'Z');
    if (isNaN(dep)) return toast('Укажите время отхода', true);
    st.speed = +$('speed').value || 12; LS.set('speed', st.speed);
    st.stepH = +$('step').value; LS.set('stepH', st.stepH);
    st.lim = { bf: +$('limBf').value || 7, hs: +$('limHs').value || 4 }; LS.set('lim', st.lim);
    // позиция судна (если уже в пути): рейс считается от неё к следующей точке
    let startPos = null;
    const posTxt = $('pos').value.trim();
    if (posTxt) {
      const f = WT.findLatLon(posTxt);
      if (!f) return toast('Не понял позицию. Пример: 45 30.5 N 010 15.2 W', true);
      startPos = { lat: f.lat, lon: f.lon };
    }
    $('startWp').disabled = !!startPos;
    $('depLbl').textContent = startPos ? 'Время позиции, UTC' : 'Отход, UTC';
    saveRouteSettings();
    const startIdx = +$('startWp').value || 0;
    st.voy = WT.buildVoyage(st.route, { startIdx, depMs: dep, speed: st.speed, speeds: st.speeds, startPos });
    if (startPos) $('startWp').value = Math.min(st.voy.startIdx, st.route.wps.length - 2);
    drawPos();
    st.samples = WT.samples(st.voy, st.stepH);
    computeSampleLon();
    renderWpTable();
    setupTimeline();
    st.t = Math.min(Math.max(Date.now(), st.voy.dep), st.voy.eta);
    if (Date.now() < st.voy.dep || Date.now() > st.voy.eta) st.t = st.voy.dep;
    clearWeather();
    placeShip();
    $('build').disabled = true;
    st.builtPos = posTxt;
    const alive = () => id === buildId;
    try {
      toast('Загружаю прогноз по маршруту…', false, 0);
      WT.staleAge = 0;
      const wx = await WT.fetchRouteWeather(st.samples, { status: (m) => alive() && toast(m, false, 0), alive });
      if (!alive()) return;
      st.sums = wx.map((w) => WT.summarize(w));
      st.wx = wx;
      st.sev = st.sums.map((s) => WT.severity(s, st.lim));
      drawSegments();
      $('btnTable').disabled = false; $('btnCharts').disabled = false;
      if (!document.body.classList.contains('dragging')) { $('panel').classList.add('closed'); $('btnPanel').classList.remove('on'); } // панель закрываем — под ней карточка судна
      drawCharts();
      setTime(st.t);
      const noData = st.sums.filter((s) => s.windSpd == null).length;
      if (WT.staleAge) toast('Нет связи с Open-Meteo: показан сохранённый прогноз ' + Math.round(WT.staleAge / 3600 * 10) / 10 + ' ч назад', true, 12000);
      else toast(noData ? 'Готово. Нет прогноза для ' + noData + ' из ' + st.sums.length + ' точек (дальше горизонта прогноза).' : 'Погода по маршруту готова', false, noData ? 7000 : 2500);
      if ((st.variantsData || []).length) {
        try {
          await WT.buildVariants(st.variantsData, { dep: st.voy.dep, speed: st.speed, stepH: st.stepH, lim: st.lim },
            { status: (m) => alive() && toast(m, false, 0), alive });
          if (!alive()) return;
          WT.drawVariants(map, planRef());
          $('btnCompare').hidden = false;
          setTime(st.t);
          toast('Варианты маршрута готовы: ' + WT.variantsList().length, false, 2500);
        } catch (e) {
          if (WT.isCancelled(e) || !alive()) return;
          toast('Варианты маршрута не загрузились: ' + e.message, true);
        }
      }
      await loadGrid(id);
    } catch (e) {
      if (WT.isCancelled(e) || !alive()) return;
      toast('Ошибка загрузки погоды: ' + e.message, true);
    } finally {
      if (id === buildId) $('build').disabled = false;
    }
  }

  let gridSeq = 0;
  async function loadGrid(id) {
    const lats = st.samples.map((s) => s.lat), lons = st.sampleLon.slice();
    for (const v of WT.variantsList()) for (const s of v.samples) { lats.push(s.lat); lons.push(near(s.lon, planRef())); }
    const g = WT.gridFor({ s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lons), e: Math.max(...lons) });
    const gid = ++gridSeq, model = st.mapModel; // при быстрой смене модели побеждает последний запрос
    const alive = () => id === buildId && gid === gridSeq;
    try {
      const G = await WT.fetchGrid(g, st.voy.dep, st.voy.eta, model, { status: (m) => alive() && toast(m, false, 0), alive });
      if (!alive()) return;
      st.grid = G;
      lastOv = ''; lastVel = '';
      renderMapWx(true);
      ensureLayerData(st.layer);
      toast('Карта погоды готова (сетка ' + G.step + '°)', false, 2000);
    } catch (e) {
      if (WT.isCancelled(e) || !alive()) return;
      toast('Карта погоды не загрузилась: ' + e.message, true);
    }
  }

  function clearWeather() {
    segLayer.clearLayers();
    if (overlay) { map.removeLayer(overlay); overlay = null; }
    if (vel) { map.removeLayer(vel); vel = null; }
    isoLayer.clearLayers(); lastIso = '';
    WT.clearVariants(map); $('btnCompare').hidden = true;
    st.grid = null; st.sums = []; st.sev = [];
    $('card').hidden = true; $('btnTable').disabled = true; $('btnCharts').disabled = true;
    $('chWind').innerHTML = ''; $('chWave').innerHTML = '';
  }

  // раскрашенный маршрут: участок между соседними точками расчёта — цвет худшей из двух
  // долгота «рядом» с опорной (без скачка на 360° через линию перемены дат)
  const near = (lon, ref) => { while (lon - ref > 180) lon -= 360; while (lon - ref < -180) lon += 360; return lon; };
  // опора — точка начала рейса на линии плана (план рисуется от первой точки маршрута)
  const planRef = () => WT.unwrap(st.route.wps)[st.voy.startIdx][1];
  function computeSampleLon() {
    let ref = planRef();
    st.sampleLon = st.samples.map((s) => (ref = near(s.lon, ref)));
  }

  function drawSegments() {
    segLayer.clearLayers();
    const S = st.samples, rank = { none: -1, good: 0, warning: 1, serious: 2, critical: 3 };
    for (let i = 0; i < S.length - 1; i++) {
      const pts = [{ lat: S[i].lat, lon: st.sampleLon[i] }];
      for (const l of st.voy.legs) if (l.t1 > S[i].t && l.t1 < S[i + 1].t) pts.push(WT.positionAt(st.voy, l.t1));
      pts.push({ lat: S[i + 1].lat, lon: st.sampleLon[i + 1] });
      const ll = WT.unwrap(pts); // начинается с уже «привязанной» долготы — остальное подтягивается к ней
      const a = st.sev[i], b = st.sev[i + 1];
      const sev = rank[a] >= rank[b] ? a : b;
      L.polyline(ll, { pane: 'route', color: '#000', weight: 8, opacity: 0.55, interactive: false }).addTo(segLayer);
      L.polyline(ll, { pane: 'route', color: WT.STATUS[sev], weight: 4.5, opacity: 1, dashArray: sev === 'none' ? '3 6' : null })
        .on('click', () => { setTime(S[i].t); })
        .bindTooltip(() => WT.fmtTime(S[i].t) + ' UTC · ' + shortWx(st.sums[i]), { sticky: true })
        .addTo(segLayer);
    }
  }
  function shortWx(s) {
    if (!s || s.windSpd == null) return 'нет прогноза';
    const bf = WT.beaufort(s.windSpd);
    return WT.compass(s.windDir) + ' ' + f0(s.windSpd) + ' уз (' + bf.n + ' Бф)' + (s.hs != null ? ' · волна ' + f1(s.hs) + ' м' : '');
  }

  // ======================= СУДНО И КАРТОЧКА =======================
  function placeShip() {
    if (!st.voy) return;
    const p = WT.positionAt(st.voy, st.t);
    let lon = p.lon;
    lon = near(lon, st.sampleLon.length ? st.sampleLon[nearestSample(st.t)] : planRef());
    if (!shipMarker) {
      shipMarker = L.marker([p.lat, lon], { icon: L.divIcon({ className: '', html: '<div class="ship">' + SHIP_SVG + '</div>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 1000, keyboard: false }).addTo(map);
    } else shipMarker.setLatLng([p.lat, lon]);
    const el = shipMarker.getElement() && shipMarker.getElement().querySelector('.ship');
    if (el) el.style.transform = 'rotate(' + p.course + 'deg)';
    return p;
  }
  function nearestSample(t) {
    const S = st.samples;
    let best = 0;
    for (let i = 0; i < S.length; i++) if (Math.abs(S[i].t - t) < Math.abs(S[best].t - t)) best = i;
    return best;
  }
  function sumAt(t) {
    const S = st.samples;
    if (!st.sums.length) return null;
    if (t <= S[0].t) return st.sums[0];
    for (let i = 0; i < S.length - 1; i++) {
      if (t <= S[i + 1].t) {
        const a = st.sums[i], b = st.sums[i + 1];
        const f = (t - S[i].t) / (S[i + 1].t - S[i].t);
        if (a.windSpd == null || b.windSpd == null) return f < 0.5 ? a : b;
        return WT.lerpSummary(a, b, f);
      }
    }
    return st.sums[st.sums.length - 1];
  }

  const AGREE = { good: '✓ модели согласны', warning: '! модели расходятся', critical: '‼ сильно расходятся', none: 'одна модель' };
  const arrowTo = (deg) => '<span class="arrow" style="transform:rotate(' + deg + 'deg)">↑</span>'; // стрелка «куда»

  function renderCard(p) {
    const s = sumAt(st.t);
    const card = $('card');
    if (!st.sums.length) { card.hidden = true; return; }
    card.hidden = false;
    const v = st.voy;
    const togo = v.dist - p.gone;
    $('cardHead').innerHTML =
      '<div class="t"><span class="tg"></span>' + WT.fmtTime(st.t) + ' UTC <span class="muted" style="font-weight:400;font-size:12px">· судовое ' + WT.fmtTime(st.t, st.tz) + '</span></div>' +
      '<div class="sum"><span class="tg"></span>' + shortWx(s) + '</div>' +
      '<div class="pos">' + WT.fmtLat(p.lat) + ' ' + WT.fmtLon(p.lon) + ' · КК ' + WT.deg3(p.course) + ' · ' + f1(p.sog) + ' уз</div>' +
      '<div class="pos">пройдено ' + f0(p.gone) + "' · осталось " + f0(togo) + "' · ETA " + WT.fmtTime(v.eta) + ' UTC</div>';
    if (!s || (s.windSpd == null && s.hs == null)) { $('cardBody').innerHTML = '<div class="nodata">Нет прогноза на это время (дальше горизонта: ветер ~16 сут, волна ~10 сут).</div>'; return; }
    let h = '';
    if (s.windSpd != null) {
      const bf = WT.beaufort(s.windSpd);
      h += '<div class="row"><div class="k">Ветер<span class="agree ' + s.windAgree + '">' + AGREE[s.windAgree] + '</span></div>' +
        '<div class="v">' + arrowTo(s.windDir + 180) + ' ' + WT.compass(s.windDir) + ' ' + WT.deg3(s.windDir) + ' · ' + f0(s.windSpd) + ' уз · ' + bf.n + ' Бф</div>' +
        '<div class="s">' + bf.name + ' · разброс ' + f0(s.windMin) + '–' + f0(s.windMax) + ' уз · порывы ' + f0(s.gust) + ' уз · ' + WT.relFrom(s.windDir, p.course) + '</div>' +
        chips(WT.WIND_MODELS, s.models.wind, (x) => f0(x) + ' уз') + '</div>';
    }
    if (s.hs != null) {
      const d = WT.douglasSea(s.hs);
      h += '<div class="row"><div class="k">Волна (общая)<span class="agree ' + s.waveAgree + '">' + AGREE[s.waveAgree] + '</span></div>' +
        '<div class="v">' + arrowTo(s.waveDir + 180) + ' ' + f1(s.hs) + ' м · Дуглас ' + d.n + '</div>' +
        '<div class="s">' + d.name + ' (' + d.en + ') · из ' + WT.compass(s.waveDir) + ' · период ' + f1(s.tp) + ' с · ' + WT.relFrom(s.waveDir, p.course) + '</div>' +
        chips(WT.WAVE_MODELS, s.models.wave, (x) => f1(x) + ' м') + '</div>';
    }
    if (s.wwH != null) {
      const d = WT.douglasSea(s.wwH);
      h += '<div class="row"><div class="k">Ветровая волна</div><div class="v">' + arrowTo(s.wwDir + 180) + ' ' + f1(s.wwH) + ' м · Дуглас ' + d.n + '</div>' +
        '<div class="s">' + d.name + ' · из ' + WT.compass(s.wwDir) + ' · ' + f1(s.wwT) + ' с</div></div>';
    }
    if (s.swH != null) {
      const d = WT.douglasSwell(s.swH, s.swT);
      h += '<div class="row"><div class="k">Зыбь</div><div class="v">' + arrowTo(s.swDir + 180) + ' ' + f1(s.swH) + ' м · ' + f1(s.swT) + ' с · Дуглас ' + d.n + '</div>' +
        '<div class="s">' + d.name + (d.length ? ' · длина ≈' + f0(d.length) + ' м' : '') + ' · из ' + WT.compass(s.swDir) + ' ' + WT.deg3(s.swDir) + ' · ' + WT.relFrom(s.swDir, p.course) + '</div></div>';
    }
    if (s.curSpd != null) {
      h += '<div class="row"><div class="k">Течение</div><div class="v">' + arrowTo(s.curDir) + ' ' + WT.deg3(s.curDir) + ' · ' + f1(s.curSpd) + ' уз</div>' +
        '<div class="s">' + WT.currentEffect(s.curDir, s.curSpd, p.course) + '</div></div>';
    }
    if (s.pres != null) h += '<div class="row"><div class="k">Давление</div><div class="v">' + f0(s.pres) + ' гПа</div></div>';
    h += WT.variantsCardHtml(st.t);
    $('cardBody').innerHTML = h;
  }
  function chips(models, vals, fmt) {
    return '<div class="chips">' + models.filter((m) => vals[m.id] != null).map((m) => '<span class="chip" title="' + esc(m.full) + '"><i style="background:' + m.color + '"></i>' + m.name + ' ' + fmt(vals[m.id]) + '</span>').join('') + '</div>';
  }

  // ======================= СЛОИ КАРТЫ =======================
  const mercY = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const invMerc = (y) => (Math.atan(Math.sinh(y)) * 180) / Math.PI;
  const LAYER = {
    wind: { field: (G) => G.wind.spd, scale: 'wind', title: 'Ветер, уз' },
    waves: { field: (G) => G.hs, scale: 'waves', title: 'Волна (общая), м' },
    swell: { field: (G) => G.sw, scale: 'waves', title: 'Зыбь, м' },
    windwave: { field: (G) => G.ww, scale: 'waves', title: 'Ветровая волна, м' },
    currents: { field: (G) => G.cur.spd, scale: 'currents', title: 'Течение, уз' },
    gust: { field: (G) => G.gust, scale: 'wind', title: 'Порывы ветра, уз' },
    rain: { field: (G) => G.rain, scale: 'rain', title: 'Осадки, мм/ч' },
    clouds: { field: (G) => G.cloud, scale: 'clouds', title: 'Облачность, %' },
    pressure: { field: (G) => G.pres, scale: 'pressure', title: 'Давление, гПа' },
    vis: { field: (G) => G.vis, scale: 'vis', title: 'Видимость, км' },
  };
  const LIVE = { radar: 'Радар осадков — сейчас', satellite: 'Спутник — облака сейчас' }; // не прогноз: последние снимки
  const ovCanvas = document.createElement('canvas');
  let lastOv = '', lastVel = '', lastVelAt = 0;

  function timeIdx(t) {
    const T = st.grid.times, x = (t - T[0]) / H;
    const i0 = Math.max(0, Math.min(T.length - 1, Math.floor(x))), i1 = Math.min(T.length - 1, i0 + 1);
    return { i0, i1, f: Math.max(0, Math.min(1, x - i0)) };
  }

  function renderMapWx(force) {
    renderLegend();
    const isLive = !!LIVE[st.layer];
    document.body.classList.toggle('live', isLive);
    if (isLive) WT.live.show(st.layer); else WT.live.hide();
    if (overlay) overlay.setOpacity(isLive ? 0 : 0.72);
    const G = st.grid;
    if (!G) return;
    if (st.t > G.times[G.times.length - 1] + H) { // дальше горизонта прогноза карта не «застывает» на последнем часе
      if (overlay) overlay.setOpacity(0);
      if (vel) { map.removeLayer(vel); vel = null; lastVel = ''; }
      isoLayer.clearLayers(); lastIso = ''; lastOv = '';
      return;
    }
    drawIsobars(force);
    // заливка
    const { i0, i1, f } = timeIdx(st.t);
    const key = st.layer + '|' + i0 + '|' + Math.round(f * 4);
    if (!isLive && (force || key !== lastOv)) {
      lastOv = key;
      const L0 = LAYER[st.layer], A = L0.field(G)[i0], B = L0.field(G)[i1];
      const mix = new Array(A.length);
      for (let k = 0; k < A.length; k++) { const a = A[k], b = B[k]; mix[k] = a == null ? b : b == null ? a : a + (b - a) * f; }
      const W = Math.min(720, G.nx * 12), yN = mercY(G.n), yS = mercY(G.s);
      const Hh = Math.max(16, Math.min(900, Math.round((W * (yN - yS)) / (((G.e - G.w) * Math.PI) / 180))));
      ovCanvas.width = W; ovCanvas.height = Hh;
      const ctx = ovCanvas.getContext('2d'), img = ctx.createImageData(W, Hh), d = img.data;
      for (let r = 0; r < Hh; r++) {
        const lat = invMerc(yN - ((r + 0.5) / Hh) * (yN - yS));
        for (let c = 0; c < W; c++) {
          const v = WT.gridSample(G, mix, lat, G.w + ((c + 0.5) / W) * (G.e - G.w));
          const o = (r * W + c) * 4;
          if (v == null) { d[o + 3] = 0; continue; }
          const col = WT.colorAt(L0.scale, v);
          if (!col) { d[o + 3] = 0; continue; }
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const url = ovCanvas.toDataURL('image/png'), b = [[G.s, G.w], [G.n, G.e]];
      if (!overlay) overlay = L.imageOverlay(url, b, { pane: 'wx', opacity: 0.72, interactive: false }).addTo(map);
      else { overlay.setUrl(url); overlay.setBounds(L.latLngBounds(b)); }
    }
    // частицы (ветер или течение)
    // поверх спутника частицы не рисуем — сливаются с облаками
    if (!st.particles || !L.velocityLayer || st.layer === 'satellite') { if (vel) { map.removeLayer(vel); vel = null; lastVel = ''; } return; }
    const isCur = st.layer === 'currents';
    const ti = f > 0.5 ? i1 : i0, vkey = (isCur ? 'c' : 'w') + ti;
    if (!force && vkey === lastVel) return;
    if (!force && st.playing && vel && performance.now() - lastVelAt < 1200) return; // при анимации реже, чтобы частицы не дёргались
    lastVel = vkey; lastVelAt = performance.now();
    const src = isCur ? G.cur : G.wind;
    const hdr = (n) => ({ parameterCategory: 2, parameterNumber: n, lo1: G.w, la1: G.n, lo2: G.e, la2: G.s, dx: G.step, dy: G.step, nx: G.nx, ny: G.ny, refTime: new Date(G.times[ti]).toISOString() });
    const z = (a) => a.map((x) => (x == null ? 0 : x));
    const data = [{ header: hdr(2), data: z(src.u[ti]) }, { header: hdr(3), data: z(src.v[ti]) }];
    if (vel && vel._wtCur === isCur) { vel.setData(data); return; }
    if (vel) map.removeLayer(vel);
    vel = L.velocityLayer(Object.assign({
      displayValues: false, data, frameRate: 20, particleAge: 70, opacity: 0.85,
      colorScale: ['rgba(255,255,255,0.45)', 'rgba(255,255,255,0.6)', 'rgba(255,255,255,0.75)', 'rgba(255,255,255,0.9)'],
    }, isCur ? { maxVelocity: 1.2, velocityScale: 0.2, particleMultiplier: 1 / 90, lineWidth: 1.6 } : { maxVelocity: 22, velocityScale: 0.009, particleMultiplier: 1 / 220, lineWidth: 1.3 }));
    vel._wtCur = isCur;
    vel.addTo(map);
  }

  // изобары через 4 гПа (жирнее — кратные 20), с подписями — линиями поверх карты, чтобы были чёткими при любом приближении
  const isoLayer = L.layerGroup().addTo(map);
  let lastIso = '';
  function drawIsobars(force) {
    const G = st.grid;
    if (!st.isobars || !G || !G.pres) { isoLayer.clearLayers(); lastIso = ''; return; }
    const { i0, i1, f } = timeIdx(st.t);
    const key = i0 + '|' + Math.round(f * 4);
    if (!force && key === lastIso) return;
    lastIso = key;
    isoLayer.clearLayers();
    const A = G.pres[i0], B = G.pres[i1];
    const mix = A.map((a, j) => (a == null ? B[j] : B[j] == null ? a : a + (B[j] - a) * f));
    const k = 3, U = WT.upsample(mix, G.nx, G.ny, k);
    const vals = U.vals.filter((v) => v != null);
    if (!vals.length) return;
    const lo = Math.ceil(Math.min(...vals) / 4) * 4, hi = Math.floor(Math.max(...vals) / 4) * 4;
    const levels = [];
    for (let lv = lo; lv <= hi; lv += 4) levels.push(lv);
    const segs = WT.contours(U.vals, U.nx, U.ny, levels);
    const ll = (gx, gy) => [G.n - (gy / k) * G.step, G.w + (gx / k) * G.step];
    for (const lv of levels) {
      const S = segs[lv];
      if (!S.length) continue;
      const bold = lv % 20 === 0;
      L.polyline(S.map(([x1, y1, x2, y2]) => [ll(x1, y1), ll(x2, y2)]), {
        pane: 'wx', color: '#ffffff', opacity: bold ? 0.85 : 0.55, weight: bold ? 1.6 : 1, interactive: false, smoothFactor: 0.5,
      }).addTo(isoLayer);
      for (const q of S.length > 30 ? [0.25, 0.75] : [0.5]) {
        const [x1, y1] = S[Math.floor(S.length * q)];
        L.marker(ll(x1, y1), { pane: 'wx', interactive: false, keyboard: false,
          icon: L.divIcon({ className: 'iso-lbl', html: String(lv), iconSize: [30, 14], iconAnchor: [15, 7] }) }).addTo(isoLayer);
      }
    }
  }

  function renderLiveLegend() { const h = WT.live.legendHtml(st.layer); if ($('legend').innerHTML !== h) $('legend').innerHTML = h; }
  WT.onLiveChange = () => { if (LIVE[st.layer]) renderLiveLegend(); };
  $('legend').addEventListener('pointerdown', (e) => {
    if (e.target.id !== 'liveLoop') return;
    if (WT.live.playing()) WT.live.stop(); else WT.live.play();
  });

  function renderLegend() {
    if (LIVE[st.layer]) return renderLiveLegend();
    const L0 = LAYER[st.layer], sc = WT.SCALES[L0.scale];
    const stops = sc.stops, min = stops[0][0], max = stops[stops.length - 1][0];
    const grad = stops.map(([v, c]) => c + ' ' + (((v - min) / (max - min)) * 100).toFixed(1) + '%').join(',');
    // подписи стоят там, где это значение на полосе (шкала линейная)
    const at = (v, txt) => { const x = ((v - min) / (max - min)) * 100; return '<span style="left:' + x.toFixed(1) + '%;transform:translateX(' + (x < 5 ? '0' : x > 95 ? '-100%' : '-50%') + ')">' + txt + '</span>'; };
    const marks = L0.scale === 'wind' ? [0, 17, 34, 64] : L0.scale === 'waves' ? [0, 2.5, 6, 14] : L0.scale === 'rain' ? [0.1, 8, 30] : L0.scale === 'vis' ? [0, 10, 40] : [stops[0][0], stops[Math.floor(stops.length / 2)][0], max];
    const gm = st.grid ? st.grid.windModel : st.mapModel, gname = (WT.WIND_MODELS.find((m) => m.id === gm) || {}).name;
    const FC_LAYERS = ['wind', 'gust', 'rain', 'clouds', 'pressure'];
    const src = st.layer === 'vis' ? (st.grid && st.grid.visSource) || gname : FC_LAYERS.includes(st.layer) ? gname : '';
    $('legend').innerHTML = '<div>' + L0.title + (src ? ' · ' + src : '') + '</div>' +
      '<div class="bar" style="background:linear-gradient(90deg,' + grad + ')"></div>' +
      '<div class="lbl abs">' + marks.map((v) => at(v, v)).join('') + '</div>' +
      (L0.scale === 'wind' ? '<div class="lbl abs">' + [[0, '0 Бф'], [5, '5'], [8, '8'], [12, '12']].map(([n, t]) => at(Math.min(max, WT.bfEdge(n)), t)).join('') + '</div>'
        : L0.scale === 'waves' ? '<div class="lbl abs">' + [[0, 'Дуглас 0'], [2.5, '4'], [6, '6'], [14, '9']].map(([v, t]) => at(v, t)).join('') + '</div>' : '') +
      (st.grid && st.t > st.grid.times[st.grid.times.length - 1] + H ? '<div style="color:var(--warning);margin-top:2px">Нет прогноза на это время</div>' : '');
  }

  // клик по карте — значения в точке (из сетки) и ссылка на Windy
  map.on('click', (e) => {
    const G = st.grid;
    if (!G) return;
    let lon = e.latlng.lng;
    const mid = (G.w + G.e) / 2;
    while (lon - mid > 180) lon -= 360; while (lon - mid < -180) lon += 360;
    const { i0 } = timeIdx(st.t), lat = e.latlng.lat;
    const g = (arr) => WT.gridSample(G, arr[i0], lat, lon);
    const ws = g(G.wind.spd), u = g(G.wind.u), v = g(G.wind.v);
    const wdir = u != null ? ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360 : null;
    const hs = g(G.hs), sw = g(G.sw), cs = g(G.cur.spd), cu = g(G.cur.u), cv = g(G.cur.v);
    const cdir = cu != null ? ((Math.atan2(cu, cv) * 180) / Math.PI + 360) % 360 : null;
    let h = '<div class="popup"><b>' + WT.fmtLat(lat) + ' ' + WT.fmtLon(lon) + '</b><br><span class="muted">' + WT.fmtTime(G.times[i0]) + ' UTC · сетка ' + G.step + '°</span><br>';
    if (ws != null) h += 'Ветер ' + WT.compass(wdir) + ' ' + f0(ws) + ' уз · ' + WT.beaufort(ws).n + ' Бф (' + (WT.WIND_MODELS.find((m) => m.id === G.windModel) || {}).name + ')<br>';
    const gu = g(G.gust), pr = g(G.pres), ra = g(G.rain), cl = g(G.cloud), vi = g(G.vis);
    if (gu != null) h += 'Порывы ' + f0(gu) + ' уз<br>';
    if (pr != null) h += 'Давление ' + f0(pr) + ' гПа<br>';
    if (ra != null || cl != null) h += 'Осадки ' + f1(ra) + ' мм/ч · облачность ' + f0(cl) + ' %<br>';
    if (vi != null) h += 'Видимость ' + (vi < 10 ? f1(vi) : f0(vi)) + ' км<br>';
    if (hs != null) h += 'Волна ' + f1(hs) + ' м · Дуглас ' + WT.douglasSea(hs).n + '<br>';
    if (sw != null) h += 'Зыбь ' + f1(sw) + ' м<br>';
    if (cs != null) h += 'Течение → ' + WT.deg3(cdir) + ' ' + f1(cs) + ' уз<br>';
    if (hs == null && ws != null) h += '<span class="muted">суша / нет данных о волне</span><br>';
    h += '<a href="' + windyLink(lat, lon) + '" target="_blank" rel="noopener">Открыть эту точку в Windy ↗</a></div>';
    L.popup().setLatLng(e.latlng).setContent(h).openOn(map);
  });

  // ======================= ЛЕНТА ВРЕМЕНИ =======================
  function setupTimeline() {
    const v = st.voy, sl = $('slider');
    sl.min = v.dep; sl.max = v.eta; sl.step = 10 * 60e3; sl.disabled = false; $('play').disabled = false;
    // отметки суток (по судовому времени) и точки маршрута
    const span = v.eta - v.dep, tz = st.tz * H;
    const fit = Math.max(2, Math.floor(($('ticks').clientWidth || 600) / 62)); // сколько подписей влезает
    const stepT = [2, 6, 12, 24, 48, 72, 96, 168].map((h) => h * H).find((s) => span / s <= fit) || 168 * H;
    let html = '';
    let t = Math.ceil((v.dep + tz) / stepT) * stepT - tz;
    for (; t < v.eta; t += stepT) {
      const pct = ((t - v.dep) / span) * 100;
      html += '<span style="left:' + pct + '%">' + (stepT >= 24 * H ? WT.fmtDay(t, st.tz) : WT.fmtTime(t, st.tz).slice(6)) + '</span>';
    }
    $('ticks').innerHTML = html;
  }
  $('slider').addEventListener('input', (e) => { stop(); setTime(+e.target.value); });

  function setTime(t) {
    if (!st.voy) return;
    st.t = Math.max(st.voy.dep, Math.min(st.voy.eta, t));
    $('slider').value = st.t;
    $('tLabel').innerHTML = '<b>' + WT.fmtTime(st.t) + ' UTC</b><span class="muted">судовое ' + WT.fmtTime(st.t, st.tz) + ' · ' + (st.t >= st.voy.eta ? 'прибытие' : 'в пути ' + WT.fmtDur((st.t - st.voy.dep) / H)) + '</span>';
    const p = placeShip();
    if (st.route && st.voy) WT.placeVariantShips(map, st.t, planRef());
    renderCard(p);
    renderMapWx(false);
    moveCursors();
  }

  let raf = null, lastFrame = 0;
  function play() {
    if (!st.voy) return;
    if (st.t >= st.voy.eta) st.t = st.voy.dep;
    st.playing = true; $('play').textContent = '❚❚';
    lastFrame = performance.now();
    const step = (now) => {
      if (!st.playing) return;
      const dt = Math.min(100, now - lastFrame); lastFrame = now;
      const nt = st.t + (dt / 1000) * st.rate * H;
      setTime(nt);
      if (nt >= st.voy.eta) { stop(); renderMapWx(true); return; }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }
  function stop() {
    if (!st.playing) return;
    st.playing = false; $('play').textContent = '▶';
    cancelAnimationFrame(raf);
    if (st.grid) renderMapWx(true);
  }
  $('play').addEventListener('click', () => (st.playing ? stop() : play()));
  $('rate').value = st.rate;
  $('rate').addEventListener('change', (e) => { st.rate = +e.target.value; LS.set('rate', st.rate); });

  // ======================= ГРАФИКИ =======================
  // Два графика (у них разные единицы — отдельно, без второй оси): ветер в узлах с линиями баллов Бофорта, волна в метрах с линиями шкалы Дугласа.
  function drawCharts() {
    if ($('charts').hidden || !st.sums.length) return;
    const S = st.samples, wx = st.wx;
    const windSeries = WT.WIND_MODELS.map((m) => ({ ...m, pts: S.map((s, i) => [s.t, wx[i].wind[m.id] ? wx[i].wind[m.id].spd : null]) }));
    const waveSeries = WT.WAVE_MODELS.map((m) => ({ ...m, pts: S.map((s, i) => [s.t, wx[i].wave[m.id] ? wx[i].wave[m.id].hs : null]) }));
    const maxW = Math.max(15, ...windSeries.flatMap((s) => s.pts.map((p) => p[1] || 0)));
    const maxH = Math.max(1.5, ...waveSeries.flatMap((s) => s.pts.map((p) => p[1] || 0)));
    const yW = Math.max(BFceil(maxW * 1.1), WT.bfEdge(st.lim.bf) + 3);
    lineChart($('chWind'), { title: 'Ветер, уз', series: windSeries, yMax: yW, fmt: (v) => f0(v) + ' уз',
      guides: WT.BF_KN.map((v, n) => ({ v: WT.bfEdge(n), label: n + ' Бф' })).filter((g) => g.v > 0 && g.v < yW && g.v >= 6),
      limit: { v: WT.bfEdge(st.lim.bf), label: 'предел ' + st.lim.bf + ' Бф' } });
    const yH = Math.max(Math.ceil(maxH * 1.15 * 2) / 2, st.lim.hs + 0.5);
    lineChart($('chWave'), { title: 'Волна (общая), м', series: waveSeries, yMax: yH, fmt: (v) => f1(v) + ' м',
      guides: [[0.5, 2], [1.25, 3], [2.5, 4], [4, 5], [6, 6], [9, 7], [14, 8]].map(([v, n]) => ({ v, label: 'Д ' + (n + 1) })).filter((g) => g.v < yH),
      limit: { v: st.lim.hs, label: 'предел ' + st.lim.hs + ' м' } });
  }
  function BFceil(kn) { return WT.BF_KN.find((v) => v >= kn) || Math.ceil(kn / 5) * 5; }

  const charts = [];
  function lineChart(el, cfg) {
    const v = st.voy;
    el.innerHTML = '<div class="ch-head"><b>' + cfg.title + '</b>' + cfg.series.map((s) => '<span class="lg"><i style="background:' + s.color + '"></i>' + s.name + '</span>').join('') + '</div>';
    const W = Math.max(200, el.clientWidth - 8), Hc = Math.max(90, el.clientHeight - 26);
    const m = { l: 30, r: 54, t: 6, b: 16 };
    const x = (t) => m.l + ((t - v.dep) / (v.eta - v.dep || 1)) * (W - m.l - m.r);
    const y = (val) => Hc - m.b - (val / cfg.yMax) * (Hc - m.t - m.b);
    let svg = '<svg viewBox="0 0 ' + W + ' ' + Hc + '" preserveAspectRatio="none">';
    // сетка: шкалы Бофорта / Дугласа
    for (const g of cfg.guides) {
      svg += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(g.v) + '" y2="' + y(g.v) + '" stroke="#383835" stroke-width="1"/>' +
        '<text x="' + (W - m.r + 4) + '" y="' + (y(g.v) + 3) + '" fill="#8f8e86" font-size="9.5">' + g.label + '</text>';
    }
    // ось Y: 0 и максимум
    svg += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(0) + '" y2="' + y(0) + '" stroke="#52514e"/>';
    for (const val of [0, cfg.yMax / 2, cfg.yMax]) svg += '<text x="' + (m.l - 4) + '" y="' + (y(val) + 3) + '" fill="#8f8e86" font-size="9.5" text-anchor="end">' + (cfg.yMax < 10 ? val.toFixed(1).replace('.0', '') : Math.round(val)) + '</text>';
    // сутки
    const tz = st.tz * H;
    for (let t = Math.ceil((v.dep + tz) / (24 * H)) * 24 * H - tz; t < v.eta; t += 24 * H) {
      svg += '<line x1="' + x(t) + '" x2="' + x(t) + '" y1="' + m.t + '" y2="' + y(0) + '" stroke="#2c2c2a" stroke-dasharray="2 3"/>' +
        '<text x="' + (x(t) + 3) + '" y="' + (Hc - 3) + '" fill="#8f8e86" font-size="9.5">' + WT.fmtDay(t, st.tz) + '</text>';
    }
    // предел судна
    if (cfg.limit.v < cfg.yMax) svg += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(cfg.limit.v) + '" y2="' + y(cfg.limit.v) + '" stroke="#d03b3b" stroke-width="1.5" stroke-dasharray="5 4"/>' +
      '<text x="' + (m.l + 4) + '" y="' + (y(cfg.limit.v) - 3) + '" fill="#e66767" font-size="9.5">' + cfg.limit.label + '</text>';
    // линии моделей
    for (const s of cfg.series) {
      let d = '', pen = false;
      for (const [t, val] of s.pts) {
        if (val == null) { pen = false; continue; }
        d += (pen ? 'L' : 'M') + x(t).toFixed(1) + ' ' + y(val).toFixed(1) + ' '; pen = true;
      }
      if (d) svg += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>';
    }
    svg += '<line class="cur" x1="0" x2="0" y1="' + m.t + '" y2="' + y(0) + '" stroke="#f0efec" stroke-width="1.2"/>';
    svg += '<rect class="hit" x="' + m.l + '" y="0" width="' + (W - m.l - m.r) + '" height="' + Hc + '" fill="transparent" style="cursor:crosshair"/></svg>';
    el.insertAdjacentHTML('beforeend', svg + '<div class="ch-tip" hidden></div>');
    const svgEl = el.querySelector('svg'), tip = el.querySelector('.ch-tip');
    const tAt = (ev) => { const r = svgEl.getBoundingClientRect(); const px = ((ev.clientX - r.left) / r.width) * W; return v.dep + ((px - m.l) / (W - m.l - m.r)) * (v.eta - v.dep); };
    el.querySelector('.hit').addEventListener('mousemove', (ev) => {
      const i = nearestSample(tAt(ev));
      tip.hidden = false;
      tip.innerHTML = '<b>' + WT.fmtTime(st.samples[i].t) + ' UTC</b><br>' + cfg.series.map((s) => '<span class="lg"><i style="background:' + s.color + '"></i>' + s.name + ': ' + (s.pts[i][1] == null ? '—' : cfg.fmt(s.pts[i][1])) + '</span>').join('<br>');
      const r = el.getBoundingClientRect();
      const left = ev.clientX - r.left + 12;
      tip.style.left = Math.min(left, r.width - tip.offsetWidth - 4) + 'px'; tip.style.top = '24px';
    });
    el.querySelector('.hit').addEventListener('mouseleave', () => (tip.hidden = true));
    el.querySelector('.hit').addEventListener('click', (ev) => { stop(); setTime(tAt(ev)); });
    const idx = charts.findIndex((c) => c.el === el);
    const c = { el, x, line: el.querySelector('.cur') };
    if (idx >= 0) charts[idx] = c; else charts.push(c);
    moveCursors();
  }
  function moveCursors() {
    for (const c of charts) if (c.line && c.el.contains(c.line)) { const X = c.x(st.t); c.line.setAttribute('x1', X); c.line.setAttribute('x2', X); }
  }
  $('btnCharts').addEventListener('click', () => {
    const show = $('charts').hidden;
    $('charts').hidden = !show; document.body.classList.toggle('charts', show); $('btnCharts').classList.toggle('on', show);
    LS.set('charts', show);
    if (show) drawCharts();
  });
  let rz = null;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (st.voy) setupTimeline(); if (!$('charts').hidden && st.sums.length) drawCharts(); }, 200); });
  // карточку можно свернуть до строки «время · ветер · волна»: смахнуть вниз (или нажать на шапку), развернуть — вверх или нажатием
  const setCardMini = (on) => { $('card').classList.toggle('collapsed', on); LS.set('cardMini', on); };
  setCardMini(LS.get('cardMini', false));
  let cardDrag = null;
  for (const el of [$('cardGrip'), $('cardHead')]) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      cardDrag = { y: e.clientY, dy: 0 };
      $('card').classList.add('drag');
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!cardDrag) return;
      cardDrag.dy = e.clientY - cardDrag.y;
      const mini = $('card').classList.contains('collapsed');
      const d = mini ? Math.min(0, cardDrag.dy) / 3 : Math.max(0, cardDrag.dy); // окно идёт за пальцем
      $('card').style.transform = d ? 'translateY(' + d + 'px)' : '';
    });
    const end = (e) => {
      if (!cardDrag) return;
      const dy = cardDrag.dy, mini = $('card').classList.contains('collapsed');
      cardDrag = null;
      $('card').classList.remove('drag'); $('card').style.transform = '';
      if (e.type === 'pointercancel') return;
      if (Math.abs(dy) < 8) setCardMini(!mini); // нажатие
      else if (dy > 40) setCardMini(true);
      else if (dy < -30) setCardMini(false);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  // ======================= ТАБЛИЦА =======================
  function tableRows() {
    return st.samples.map((s, i) => {
      const S = st.sums[i];
      const bf = S.windSpd != null ? WT.beaufort(S.windSpd) : null;
      const ds = S.hs != null ? WT.douglasSea(S.hs) : null, dw = S.swH != null ? WT.douglasSwell(S.swH, S.swT) : null;
      return {
        sev: st.sev[i], t: s.t,
        cells: [
          WT.fmtTime(s.t), WT.fmtTime(s.t, st.tz), WT.fmtLat(s.lat) + ' ' + WT.fmtLon(s.lon), WT.deg3(s.course), f0(s.gone),
          S.windSpd != null ? WT.compass(S.windDir) + ' ' + WT.deg3(S.windDir) : '—', f0(S.windSpd), S.windSpd != null ? f0(S.windMin) + '–' + f0(S.windMax) : '—', bf ? bf.n : '—', f0(S.gust),
          f1(S.hs), S.hs != null ? f1(S.hsMin) + '–' + f1(S.hsMax) : '—', ds ? ds.n : '—',
          f1(S.wwH), S.swH != null ? f1(S.swH) + ' м ' + f1(S.swT) + ' с ' + WT.compass(S.swDir) : '—', dw ? dw.n : '—',
          S.curSpd != null ? WT.deg3(S.curDir) + ' ' + f1(S.curSpd) : '—', f0(S.pres),
          S.windAgree ? AGREE[S.windAgree] : '—', S.waveAgree ? AGREE[S.waveAgree] : '—',
        ],
      };
    });
  }
  const HEAD = ['Время UTC', 'Судовое', 'Позиция', 'КК', 'Пройдено', 'Ветер откуда', 'Ветер уз', 'Разброс', 'Бф', 'Порывы', 'Волна м', 'Разброс', 'Дуглас', 'Ветр. волна м', 'Зыбь', 'Дуглас зыбь', 'Течение', 'гПа', 'Ветер: модели', 'Волна: модели'];
  $('btnTable').addEventListener('click', () => {
    const rows = tableRows(), ni = nearestSample(st.t);
    $('bigTable').innerHTML = '<thead><tr>' + HEAD.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' +
      rows.map((r, i) => '<tr data-t="' + r.t + '" class="' + (i === ni ? 'cur' : '') + '"><td><span class="sev" style="background:' + WT.STATUS[r.sev] + '"></span>' + r.cells[0] + '</td>' + r.cells.slice(1).map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    $('modal').hidden = false;
  });
  $('bigTable').addEventListener('click', (e) => { const tr = e.target.closest('tr[data-t]'); if (tr) { setTime(+tr.dataset.t); $('modal').hidden = true; } });
  $('modalClose').addEventListener('click', () => ($('modal').hidden = true));
  $('modal').addEventListener('click', (e) => { if (e.target.id === 'modal') $('modal').hidden = true; });
  $('csv').addEventListener('click', () => {
    const q = (c) => '"' + String(c).replace(/"/g, '""') + '"';
    const dc = (c) => (/^-?\d+(\.\d+)?(–-?\d+(\.\d+)?)?$/.test(String(c)) ? String(c).replace(/\./g, ',') : c); // числа: 2,5 вместо 2.5
    const csv = '\uFEFF' + [HEAD.map(q).join(';')].concat(tableRows().map((r) => r.cells.map((c) => q(dc(c))).join(';'))).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'weather_' + (st.route ? st.route.name.replace(/[^\w\-]+/g, '_') : 'route') + '.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });

  // ======================= ВЕРСИЯ ПРОГРАММЫ =======================
  (async () => {
    let v;
    try { const r = await fetch('version.json', { cache: 'no-store' }); if (!r.ok) return; v = await r.json(); } catch (e) { return; }
    if (!v || !v.version) return;
    const when = (d) => { const t = Date.parse(d); return isNaN(t) ? '' : WT.fmtTime(t) + ' UTC'; };
    const b = $('verBadge');
    b.innerHTML = '<b>v' + esc(v.version) + '</b><span>' + esc(v.by || '') + (v.date ? ' · ' + esc(when(v.date).slice(0, 5)) : '') + '</span>';
    b.hidden = false;
    $('verPop').innerHTML = '<h4>Weather Tracker v' + esc(v.version) + '</h4>' +
      (v.history || []).map((h) => '<div class="it"><b>v' + esc(h.version) + '</b> · ' + esc(when(h.date)) +
        '<div>' + esc(h.what || '') + '</div><div class="who">внёс: ' + esc(h.by || '—') + '</div></div>').join('');
    b.addEventListener('click', (e) => { e.stopPropagation(); $('verPop').hidden = !$('verPop').hidden; });
    document.addEventListener('click', (e) => { if (!$('verPop').contains(e.target)) $('verPop').hidden = true; });
  })();

  // ======================= СРАВНЕНИЕ МАРШРУТОВ =======================
  function openCompare() {
    if (!WT.variantsList().length || !st.sums.length) return;
    $('cmpModal').hidden = false;
    WT.renderCompare($('cmpBody'), { name: st.route.name, voy: st.voy, samples: st.samples, sums: st.sums }, st.lim, st.stepH, makeMain);
  }
  // вариант k становится основным, бывший основной — вариантом (только на этом экране, рейс в Telegram не меняется)
  function makeMain(k) {
    const raw = st.voyageRaw, list = (raw && raw.variants) || [];
    const chosen = WT.variantsList()[k];
    if (!raw || !chosen) return;
    const iso = (ms) => new Date(ms).toISOString().slice(0, 16) + 'Z';
    const oldMain = { id: 'A', name: 'Был основным: ' + st.route.name, route: { name: st.route.name, wps: st.route.wps },
      dep: iso(st.voy.dep), speed: st.speed, speeds: st.speeds, startIdx: +$('startWp').value || 0, pos: $('pos').value.trim() };
    const others = list.filter((x, i) => i !== k);
    const v2 = Object.assign({}, raw, {
      updated: (raw.updated || '') + '#' + chosen.id, note: 'Основным выбран «' + chosen.name + '» на этом экране.',
      route: { name: chosen.name, wps: chosen.route.wps }, dep: iso(chosen.voy.dep), speed: chosen.speed || st.speed,
      speeds: chosen.speeds, startIdx: chosen.startIdx, pos: chosen.pos, variants: [oldMain].concat(others),
    });
    $('cmpModal').hidden = true;
    useVoyage(v2);
  }
  $('btnCompare').addEventListener('click', openCompare);
  $('cmpClose').addEventListener('click', () => ($('cmpModal').hidden = true));
  $('cmpModal').addEventListener('click', (e) => { if (e.target.id === 'cmpModal') $('cmpModal').hidden = true; });

  // ======================= WINDY ДЛЯ СРАВНЕНИЯ =======================
  const WINDY_OVERLAY = { wind: 'wind', gust: 'gust', rain: 'rain', clouds: 'clouds', pressure: 'pressure', vis: 'visibility', waves: 'waves', swell: 'swell1', windwave: 'wwaves', currents: 'currents', radar: 'radar', satellite: 'satellite' };
  const WINDY_PRODUCT = { ecmwf_ifs025: 'ecmwf', gfs_seamless: 'gfs', icon_seamless: 'icon' };
  function shipLatLon() {
    if (st.voy) { const p = WT.positionAt(st.voy, st.t); return [p.lat, p.lon]; }
    const c = map.getCenter(); return [c.lat, WT.wrap180(c.lng)];
  }
  function windyLink(lat, lon) {
    return 'https://www.windy.com/' + lat.toFixed(3) + '/' + WT.wrap180(lon).toFixed(3) + '?' + (WINDY_OVERLAY[st.layer] || 'wind') + ',' + lat.toFixed(3) + ',' + WT.wrap180(lon).toFixed(3) + ',7';
  }
  function windyEmbed() {
    const [lat, lon] = shipLatLon();
    const ov = WINDY_OVERLAY[st.layer] || 'wind', prod = ['wind', 'gust', 'rain', 'clouds', 'pressure', 'vis'].includes(st.layer) ? WINDY_PRODUCT[st.mapModel] || 'ecmwf' : 'ecmwf';
    const la = lat.toFixed(3), lo = WT.wrap180(lon).toFixed(3);
    const url = 'https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=default&metricTemp=default&metricWind=kt' +
      '&zoom=6&overlay=' + ov + '&product=' + prod + '&level=surface&lat=' + la + '&lon=' + lo +
      '&detailLat=' + la + '&detailLon=' + lo + '&detail=true&marker=true&message=true';
    $('windyFrame').src = url;
    $('windyOpen').href = windyLink(lat, lon);
    $('windyInfo').textContent = 'точка судна ' + WT.fmtLat(lat) + ' ' + WT.fmtLon(lon) + ' · у нас: ' + WT.fmtTime(st.t) + ' UTC — во Windy выберите это же время внизу';
  }
  $('btnWindy').addEventListener('click', () => {
    const on = !document.body.classList.contains('split');
    document.body.classList.toggle('split', on); $('windyPane').hidden = !on; $('btnWindy').classList.toggle('on', on);
    if (on) windyEmbed();
    setTimeout(() => { map.invalidateSize(); if (!$('charts').hidden && st.sums.length) drawCharts(); }, 50);
  });
  $('windySync').addEventListener('click', windyEmbed);
  $('windyClose').addEventListener('click', () => $('btnWindy').click());

  // ======================= ЭЛЕМЕНТЫ УПРАВЛЕНИЯ =======================
  $('btnPanel').addEventListener('click', () => { $('panel').classList.toggle('closed'); $('btnPanel').classList.toggle('on', !$('panel').classList.contains('closed')); });
  $('panelClose').addEventListener('click', () => $('btnPanel').click());
  $('routeSel').addEventListener('change', (e) => openRouteByName(e.target.value));
  $('fileIn').addEventListener('change', (e) => { if (e.target.files[0]) openFile(e.target.files[0]); e.target.value = ''; });
  $('build').addEventListener('click', build);
  $('pos').addEventListener('change', buildSoon);
  $('publish').addEventListener('click', async () => {
    if (!st.route || !st.voy || !st.sums.length) return toast('Сначала постройте рейс', true);
    const posNow = $('pos').value.trim();
    if (posNow && !WT.findLatLon(posNow)) return toast('Позиция не распознана — рейс не сохранён', true);
    if (posNow !== (st.builtPos || '')) return toast('Позиция изменилась — сначала нажмите «Построить погоду по маршруту»', true);
    const v = {
      updated: new Date().toISOString().slice(0, 19) + 'Z', source: 'Weather Tracker',
      route: { name: st.route.name, vessel: st.route.vessel || '', wps: st.route.wps.map((w) => ({ name: w.name, lat: +w.lat.toFixed(5), lon: +w.lon.toFixed(5), geom: w.geom, speed: w.speed || undefined })) },
      dep: new Date(st.voy.dep).toISOString().slice(0, 16) + 'Z', startIdx: +$('startWp').value || 0, speed: st.speed, speeds: st.speeds,
      pos: $('pos').value.trim(), limits: st.lim, tz: st.tz, note: st.route.note || '',
    };
    try {
      const r = await fetch('/api/voyage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v, null, 1) });
      if (!r.ok) throw new Error((await r.json()).error || r.status);
      toast('Рейс сохранён для ссылки (voyage.json). На странице по ссылке он появится после выкладки.', false, 6000);
      const cur = st.route.file; await loadRouteList(); $('routeSel').value = cur;
    } catch (e) { toast('Не сохранилось: ' + e.message, true); }
  });
  $('startWp').addEventListener('change', () => { saveRouteSettings(); buildSoon(); });
  for (const id of ['dep', 'speed', 'step']) $(id).addEventListener('change', buildSoon);
  // пределы судна меняют только раскраску — прогноз заново не грузим
  for (const id of ['limBf', 'limHs']) $(id).addEventListener('change', () => {
    st.lim = { bf: +$('limBf').value || 7, hs: +$('limHs').value || 4 }; LS.set('lim', st.lim);
    saveRouteSettings();
    if (!st.sums.length) return;
    st.sev = st.sums.map((x) => WT.severity(x, st.lim));
    WT.resevVariants(st.lim); if (WT.variantsList().length) WT.drawVariants(map, planRef());
    drawSegments(); drawCharts(); setTime(st.t);
  });
  $('tz').addEventListener('change', (e) => { st.tz = +e.target.value || 0; LS.set('tz', st.tz); saveRouteSettings(); if (st.voy) { setupTimeline(); setTime(st.t); if (st.sums.length) drawCharts(); } });
  $('wpTable').addEventListener('change', (e) => {
    const i = e.target.dataset.i;
    if (i == null) return;
    const v = parseFloat(e.target.value);
    if (v > 0) st.speeds[i] = v; else delete st.speeds[i];
    saveRouteSettings(); buildSoon();
  });
  // перетаскивание файла в окно
  let dragN = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; document.body.classList.add('dragging'); $('panel').classList.remove('closed'); });
  window.addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault(); dragN = 0; document.body.classList.remove('dragging');
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
  });

  // слои
  async function ensureLayerData(l) {
    const G = st.grid;
    if (l !== 'vis' || !G || G.visSource || WT.gridHasData(G.vis)) return;
    try { await WT.fetchGridVis(G, (m) => toast(m, false, 0)); toast('Видимость: модель GFS (у ECMWF её нет)', false, 3000); }
    catch (e) { toast('Видимость не загрузилась: ' + e.message, true); }
    if (st.grid === G) { lastOv = ''; renderMapWx(true); }
  }

  function setLayer(l) {
    st.layer = l; LS.set('layer', l);
    ensureLayerData(l);
    document.querySelectorAll('.lay').forEach((b) => b.classList.toggle('on', b.dataset.layer === l));
    lastOv = ''; renderMapWx(true);
    if (document.body.classList.contains('split')) windyEmbed();
  }
  document.querySelectorAll('.lay').forEach((b) => b.addEventListener('click', () => setLayer(b.dataset.layer)));
  $('mapModel').innerHTML = WT.WIND_MODELS.map((m) => '<option value="' + m.id + '">' + m.name + '</option>').join('');
  $('mapModel').value = st.mapModel;
  $('mapModel').addEventListener('change', async (e) => {
    st.mapModel = e.target.value; LS.set('mapModel', st.mapModel);
    if (st.voy && st.sums.length) await loadGrid(buildId);
    if (document.body.classList.contains('split')) windyEmbed();
  });
  $('chkParticles').checked = st.particles;
  $('chkParticles').addEventListener('change', (e) => { st.particles = e.target.checked; LS.set('particles', st.particles); renderMapWx(true); });
  $('chkIsobars').checked = st.isobars;
  $('chkIsobars').addEventListener('change', (e) => { st.isobars = e.target.checked; LS.set('isobars', st.isobars); drawIsobars(true); });
  $('chkSeamarks').checked = st.seamarks;
  const applySeamarks = () => (st.seamarks ? seamarks.addTo(map) : map.removeLayer(seamarks));
  $('chkSeamarks').addEventListener('change', (e) => { st.seamarks = e.target.checked; LS.set('seamarks', st.seamarks); applySeamarks(); });
  applySeamarks();

  // ======================= СТАРТ =======================
  $('step').value = st.stepH; $('tz').value = st.tz; $('limBf').value = st.lim.bf; $('limHs').value = st.lim.hs; $('speed').value = st.speed;
  setLayer(st.layer);
  if (window.innerWidth <= 760) $('panel').classList.add('closed'); else $('btnPanel').classList.add('on');
  if (LS.get('charts', window.innerWidth > 760)) { $('charts').hidden = false; document.body.classList.add('charts'); $('btnCharts').classList.add('on'); }
  (async () => {
    const names = await loadRouteList();
    const last = LS.get('route', null);
    const pick = st.viewer ? '__voyage__' : names.includes(last) ? last : names[0];
    if (pick) openRouteByName(pick);
    else { $('panel').classList.remove('closed'); toast('Откройте файл маршрута (RTZ, GPX или текст)', false, 6000); }
  })();
})();
