// Резервные источники прогноза — когда Open-Meteo недоступен (лимит запросов или нет связи).
// Те же модели, что у Windy, напрямую от государственных метеослужб — бесплатно, без ключа и подписки:
//  • ECMWF (Европа) — через MET Norway (метеослужба Норвегии; вне Скандинавии её прогноз — это ECMWF): ветер, порывы, давление;
//  • NOAA GFS (США) — официальный сервер данных ERDDAP (NOAA / PacIOOS): ветер, давление, осадки; и для цветной карты;
//  • NOAA WaveWatch III (США) — там же: волна, зыбь, ветровая волна.
// Течений, облачности и видимости в резерве нет. Прогноз в резерве: ECMWF ~9 суток, GFS ~7, волна ~5.
(function () {
  const WT = (window.WT = window.WT || {});
  const H = 3600e3, KN = 1.943844;
  const MET = 'https://api.met.no/weatherapi/locationforecast/2.0/complete';
  const ERD = 'https://pae-paha.pacioos.hawaii.edu/erddap/griddap/';

  WT.WIND_MODELS.push(
    { id: 'bk_ecmwf', name: 'ECMWF', full: 'ECMWF через MET Norway (резерв)', color: '#3987e5', backup: true },
    { id: 'bk_gfs', name: 'GFS', full: 'NOAA GFS напрямую от NOAA (резерв)', color: '#d95926', backup: true });
  WT.WAVE_MODELS.push({ id: 'bk_ww3', name: 'NOAA WW3', full: 'NOAA WaveWatch III напрямую от NOAA (резерв)', color: '#d95926', split: true, backup: true });

  const lon360 = (l) => ((l % 360) + 360) % 360;
  const iso = (t) => new Date(t).toISOString().slice(0, 19) + 'Z';
  const sel = (...a) => a.map((x) => '%5B(' + x + ')%5D').join('');
  // запрос с ограничением времени: сервер не ответил за 25 с — считаем, что он недоступен (не ждём бесконечно)
  async function getJson(url, ms) {
    const ac = new AbortController(), tm = setTimeout(() => ac.abort(), ms || 25e3);
    let r;
    try { r = await fetch(url, { signal: ac.signal }); }
    catch (e) { throw new Error(e.name === 'AbortError' ? 'сервер не ответил вовремя' : 'нет связи с сервером'); }
    finally { clearTimeout(tm); }
    if (!r.ok) throw new Error('сервер ответил ошибкой ' + r.status);
    return r.json();
  }
  const pause = (ms) => new Promise((res) => setTimeout(res, ms));
  // NOAA: один сервер на весь мир, иногда перегружен. Не ответил вовремя — 5 минут его не трогаем (не ждём зря и не добиваем),
  // ошибся по-другому — одна повторная попытка через 3 с.
  let noaaDownUntil = 0;
  const noaaDown = () => Date.now() < noaaDownUntil;
  async function getJson2(url, ms) {
    if (noaaDown()) throw new Error('сервер NOAA перегружен, повторю через несколько минут');
    try { return await getJson(url, ms); }
    catch (e) {
      if (/вовремя|нет связи/.test(e.message)) { noaaDownUntil = Date.now() + 5 * 60e3; throw e; }
      await pause(3000); return getJson(url, ms);
    }
  }
  // таблица ERDDAP → массив объектов {time, latitude, …}
  const rowsOf = (j) => { const t = j.table, n = t.columnNames; return t.rows.map((r) => Object.fromEntries(n.map((k, i) => [k, r[i]]))); };
  // последний срок прогноза у набора данных (спрашиваем раз в час) — дальше не запрашиваем
  const hz = {};
  function horizon(ds) {
    const x = hz[ds];
    if (x && Date.now() - x.at < H) return x.p;
    const p = getJson2(ERD + ds + '.json?time%5Blast%5D', 15e3).then((j) => Date.parse(j.table.rows[0][0])); // крошечный запрос: 15 с хватит
    hz[ds] = { p, at: Date.now() };
    p.catch(() => delete hz[ds]);
    return p;
  }
  // по n запросов одновременно — быстро, но бережно к чужим серверам
  async function pool(items, n, fn, alive) {
    let i = 0;
    await Promise.all(Array.from({ length: n }, async () => {
      while (i < items.length && alive()) { const k = i++; try { await fn(items[k], k); } catch (e) { /* точка без данных */ } }
    }));
  }

  // ---------- точка маршрута ----------
  const metCache = new Map(); // одна точка = весь прогноз на ~9 суток
  async function metSeries(p) {
    const key = p.lat.toFixed(2) + ',' + WT.wrap180(p.lon).toFixed(2);
    if (!metCache.has(key)) {
      const pr = getJson(MET + '?lat=' + key.replace(',', '&lon='))
        .then((j) => j.properties.timeseries.map((e) => ({ t: Date.parse(e.time), d: e.data.instant.details })));
      pr.catch(() => metCache.delete(key));
      metCache.set(key, pr);
      if (metCache.size > 400) metCache.delete(metCache.keys().next().value);
    }
    return metCache.get(key);
  }
  function metAt(ts, t) {
    let b = null;
    for (const x of ts) if (!b || Math.abs(x.t - t) < Math.abs(b.t - t)) b = x;
    if (!b || Math.abs(b.t - t) > 3.5 * H || b.d.wind_speed == null) return null; // дальше горизонта
    const d = b.d;
    return { spd: d.wind_speed * KN, dir: d.wind_from_direction, gust: d.wind_speed_of_gust != null ? d.wind_speed_of_gust * KN : null, pres: d.air_pressure_at_sea_level };
  }
  // NOAA: точки маршрута кусками по 8 подряд — один небольшой запрос (сетка 0.5°) на кусок, а не на каждую точку
  const WV = ['Thgt', 'Tdir', 'Tper', 'shgt', 'sdir', 'sper', 'whgt', 'wdir', 'wper'];
  async function chunkRows(ds, vars, latDesc, chunk, hzT, extra) {
    const l0 = chunk[0].lon, lons = chunk.map((s) => l0 + ((((s.lon - l0 + 540) % 360) + 360) % 360) - 180);
    const lats = chunk.map((s) => s.lat), lim = ds === 'ww3_global' ? 77.5 : 90;
    const g = { s: Math.max(-lim, Math.min(...lats) - 0.75), n: Math.min(lim, Math.max(...lats) + 0.75), w: Math.min(...lons) - 0.75, e: Math.max(...lons) + 0.75 };
    const t0 = Math.min(...chunk.map((s) => s.t)) - 1.5 * H, t1 = Math.min(hzT, Math.max(...chunk.map((s) => s.t)) + 1.5 * H);
    if (t1 < t0) return [];
    g.s = Math.floor(g.s * 2) / 2; g.n = Math.ceil(g.n * 2) / 2; g.w = Math.floor(g.w * 2) / 2; g.e = Math.ceil(g.e * 2) / 2;
    return boxRows(ds, vars, latDesc, g, t0, t1, 1, extra);
  }
  // ближайший срок, затем ближайшая клетка с данными (у берега клетки суши пустые), не дальше ~1°
  function nearestRow(rows, s, field) {
    let bt = Infinity;
    for (const r of rows) bt = Math.min(bt, Math.abs((r._t || (r._t = Date.parse(r.time))) - s.t));
    if (bt > 2 * H) return null;
    const lo = lon360(s.lon), k = Math.cos((s.lat * Math.PI) / 180);
    let best = null, bd = 1.0;
    for (const r of rows) {
      if (Math.abs(r._t - s.t) !== bt || r[field] == null) continue;
      const d = Math.hypot(r.latitude - s.lat, Math.abs(((r.longitude - lo + 540) % 360) - 180) * k);
      if (d <= bd) { bd = d; best = r; }
    }
    return best;
  }

  // тот же формат, что у WT.fetchRouteWeather: [{ wind:{модель:{spd,dir,gust,pres}}, wave:{модель:{…}}, cur }]
  WT.fetchRouteWeatherBackup = async function (samples, ctx) {
    ctx = ctx || {};
    const alive = () => !ctx.alive || ctx.alive();
    const out = samples.map(() => ({ wind: {}, wave: {}, cur: null }));
    const n = { met: [0, 0], gfs: [0, 0], ww3: [0, 0], gfsPts: 0, ww3Pts: 0 }; // [удачных запросов, ошибок], точек с данными
    const chunks = [];
    for (let i = 0; i < samples.length; i += 8) chunks.push(samples.slice(i, i + 8).map((_, j) => i + j));
    let done = 0;
    const total = samples.length * 2;
    const say = () => ctx.status && ctx.status('Резерв: ECMWF (MET Norway), GFS и волна (NOAA)… ' + Math.round((100 * done) / total) + '%');
    say();
    const now = Date.now();
    let hG = 0, hW = 0;
    const noaaDeadline = now + 45e3; // NOAA тормозит — дольше не ждём, берём что успело прийти
    const run = async (src, ok, fn) => {
      if (!ok) return;
      try { const x = await fn(); if (x) { n[src][0]++; return x; } } catch (e) { n[src][1]++; n[src].err = e.message; }
    };
    await Promise.all([
      // MET Norway — свой сервер, 4 запроса одновременно
      pool(samples, 4, async (s, k) => {
        const x = await run('met', s.t > now - 2 * H && s.t < now + 10 * 24 * H, async () => metAt(await metSeries(s), s.t));
        if (x) out[k].wind.bk_ecmwf = x;
        done++; say();
      }, alive),
      // NOAA — кусками по 8 точек, по 2 запроса одновременно (бережно: у NOAA один сервер на весь мир)
      Promise.all([horizon('ncep_global').catch((e) => { n.gfs[1]++; n.gfs.err = e.message; return 0; }), horizon('ww3_global').catch(() => 0)])
        .then(([a, b]) => { hG = a; hW = b; if (!a && !b) { done += samples.length; say(); return; } return pool(chunks, 2, async (c) => {
        const ok = (h) => h && !noaaDown() && Date.now() < noaaDeadline && c.some((k) => samples[k].t <= h + 1.5 * H);
        const gr = await run('gfs', ok(hG), () => chunkRows('ncep_global', ['ugrd10m', 'vgrd10m', 'prmslmsl'], true, c.map((k) => samples[k]), hG));
        const wr = await run('ww3', ok(hW), () => chunkRows('ww3_global', WV, false, c.map((k) => samples[k]), hW, '%5B(0.0)%5D'));
        for (const k of c) {
          const s = samples[k];
          const g = gr && nearestRow(gr, s, 'ugrd10m');
          if (g && g.vgrd10m != null) {
            const u = g.ugrd10m, v = g.vgrd10m; // вектор «куда», м/с
            out[k].wind.bk_gfs = { spd: Math.hypot(u, v) * KN, dir: ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360, gust: null, pres: g.prmslmsl != null ? g.prmslmsl / 100 : null };
            n.gfsPts++;
          }
          const w = wr && nearestRow(wr, s, 'Thgt');
          if (w) { out[k].wave.bk_ww3 = { hs: w.Thgt, dir: w.Tdir, tp: w.Tper, swH: w.shgt, swDir: w.sdir, swT: w.sper, wwH: w.whgt, wwDir: w.wdir, wwT: w.wper }; n.ww3Pts++; }
          done++; say();
        }
      }, alive); }),
    ]);
    if (!alive()) throw new Error('cancelled');
    const pts = samples.length;
    if (WT.src) {
      WT.src('bkEcmwf', n.met[0] ? 'okv' : n.met[1] ? 'down' : 'partial', { note: n.met[0] ? 'работает — ветер в ' + n.met[0] + ' из ' + pts + ' точек' : n.met[1] ? n.met.err : 'нет данных на эти даты' });
      WT.src('bkNoaa', n.gfsPts || n.ww3Pts ? 'okv' : n.gfs[1] + n.ww3[1] ? 'down' : 'partial', { note: n.gfsPts || n.ww3Pts ? 'работает — ветер в ' + n.gfsPts + ', волна в ' + n.ww3Pts + ' из ' + pts + ' точек' : n.gfs[1] + n.ww3[1] ? (n.gfs.err || n.ww3.err) : 'нет данных на эти даты' });
    }
    if (!n.met[0] && !n.gfsPts && !n.ww3Pts) throw new Error('резервные источники (ECMWF через MET Norway и NOAA) тоже не дали данных');
    return out;
  };

  // ---------- цветная карта: GFS и WaveWatch III одним запросом на область ----------
  // ERDDAP отдаёт сетку 0.5° с шагом-прореживанием; область через 0° долготы — двумя кусками.
  function lonRanges(w, e) {
    const a = lon360(w), b = a + (e - w);
    return b <= 359.5 ? [[a, b]] : [[a, 359.5], [0, Math.min(359.5, b - 360)]];
  }
  async function boxRows(ds, vars, latDesc, g, t0, t1, stride, extra, ms) {
    const latSel = latDesc ? '(' + g.n + '):' + stride + ':(' + g.s + ')' : '(' + g.s + '):' + stride + ':(' + g.n + ')';
    const rows = [];
    for (const [a, b] of lonRanges(g.w, g.e)) {
      const q = '%5B(' + iso(t0) + '):1:(' + iso(t1) + ')%5D' + (extra || '') + '%5B' + latSel + '%5D%5B(' + a + '):' + stride + ':(' + b + ')%5D';
      rows.push(...rowsOf(await getJson2(ERD + ds + '.json?' + vars.map((v) => v + q).join(','), ms || 20e3)));
    }
    return rows;
  }
  // строки ERDDAP → для каждой точки сетки карты ближайшая клетка, сроки через 3 ч
  function index(rows, g) {
    const times = [...new Set(rows.map((r) => r.time))].map(Date.parse).sort((a, b) => a - b);
    const lats = [...new Set(rows.map((r) => r.latitude))], lons = [...new Set(rows.map((r) => r.longitude))];
    const nearest = (arr, x, circ) => arr.reduce((b, v) => { const d = circ ? Math.abs(((v - x + 540) % 360) - 180) : Math.abs(v - x); return d < b[1] ? [v, d] : b; }, [null, 1e9])[0];
    const cell = g.pts.map((p) => nearest(lats, p.lat) + ',' + nearest(lons, lon360(p.lon), true));
    const byT = new Map(times.map((t, i) => [t, i]));
    const map = times.map(() => new Map());
    for (const r of rows) map[byT.get(Date.parse(r.time))].set(r.latitude + ',' + r.longitude, r);
    return { times, get: (ti, k) => map[ti].get(cell[k]) };
  }

  WT.fetchGridBackup = async function (g, t0, t1, ctx) {
    ctx = ctx || {};
    const alive = () => !ctx.alive || ctx.alive();
    ctx.status && ctx.status('Резервная карта: NOAA GFS и WaveWatch III…');
    const [hG, hW] = await Promise.all([horizon('ncep_global'), horizon('ww3_global').catch(() => 0)]);
    const a = Math.max(t0 - 3 * H, Date.now() - 20 * 24 * H), b = Math.min(t1 + 3 * H, hG);
    if (b <= a) throw new Error('даты рейса вне резервного прогноза NOAA');
    const stride = Math.max(1, Math.round(g.step / 0.5));
    const gfs = index(await boxRows('ncep_global', ['ugrd10m', 'vgrd10m', 'prmslmsl', 'pratesfc'], true, g, a, b, stride, '', 45e3), g);
    if (!alive()) throw new Error('cancelled');
    let ww = null;
    if (hW && Math.min(b, hW) > a) {
      try { ww = index(await boxRows('ww3_global', ['Thgt', 'shgt', 'whgt'], false, g, a, Math.min(b, hW), stride, '%5B(0.0)%5D', 45e3), g); }
      catch (e) { /* без волн */ }
    }
    if (!alive()) throw new Error('cancelled');
    WT.src && WT.src('bkMap', 'okv', { note: 'работает — ветер, давление, осадки' + (ww ? ', волна и зыбь' : '') + ' (порывов, облачности, видимости и течений в резерве нет)' });
    // сроки через 3 ч → по часам (линейно), как у основной карты
    const T = gfs.times, times = [];
    for (let t = T[0]; t <= T[T.length - 1]; t += H) times.push(t);
    const nt = times.length, np = g.pts.length;
    const mk = () => Array.from({ length: nt }, () => new Array(np).fill(null));
    const G = { ...g, times, windModel: 'bk_gfs', backup: true, visSource: 'нет в резерве', wind: { spd: mk(), u: mk(), v: mk() }, gust: mk(), pres: mk(), rain: mk(), cloud: mk(), vis: mk(), hs: mk(), sw: mk(), ww: mk(), cur: { spd: mk(), u: mk(), v: mk() } };
    const lerp = (src, t, k, f) => {
      const x = (t - src.times[0]) / (3 * H), i = Math.floor(x);
      if (i < 0 || i >= src.times.length || Math.abs(src.times[i] - (src.times[0] + i * 3 * H)) > 1) return null;
      const r0 = src.get(i, k), r1 = i + 1 < src.times.length ? src.get(i + 1, k) : r0;
      const v0 = r0 && r0[f], v1 = r1 && r1[f];
      if (v0 == null) return x - i < 0.5 ? null : v1 == null ? null : v1;
      return v1 == null ? v0 : v0 + (v1 - v0) * (x - i);
    };
    for (let ti = 0; ti < nt; ti++) {
      const t = times[ti];
      for (let k = 0; k < np; k++) {
        const u = lerp(gfs, t, k, 'ugrd10m'), v = lerp(gfs, t, k, 'vgrd10m');
        if (u != null && v != null) { G.wind.u[ti][k] = u; G.wind.v[ti][k] = v; G.wind.spd[ti][k] = Math.hypot(u, v) * KN; }
        const p = lerp(gfs, t, k, 'prmslmsl'); G.pres[ti][k] = p == null ? null : p / 100;
        const r = lerp(gfs, t, k, 'pratesfc'); G.rain[ti][k] = r == null ? null : Math.max(0, r * 3600); // кг/м²/с → мм/ч
        if (ww) { G.hs[ti][k] = lerp(ww, t, k, 'Thgt'); G.sw[ti][k] = lerp(ww, t, k, 'shgt'); G.ww[ti][k] = lerp(ww, t, k, 'whgt'); }
      }
    }
    return G;
  };

  // ---------- основной источник, а если он недоступен — резерв ----------
  // (пока действует лимит, основной не стучится в сеть, а берёт сохранённый прогноз, если он есть — см. weather.js)
  WT.fetchRouteWeatherAny = async function (samples, ctx) {
    let err;
    try {
      const r = await WT.fetchRouteWeather(samples, ctx);
      WT.srcDrop && (WT.srcDrop('bkEcmwf'), WT.srcDrop('bkNoaa'));
      return r;
    } catch (e) { if (WT.isCancelled(e)) throw e; err = e; }
    try {
      const r = await WT.fetchRouteWeatherBackup(samples, ctx);
      r.backup = true; r.mainErr = err;
      return r;
    } catch (e) {
      if (WT.isCancelled(e)) throw e;
      throw new Error(err.message + '. Резерв: ' + e.message);
    }
  };
  WT.fetchGridAny = async function (g, t0, t1, model, ctx) {
    let err;
    try { const G = await WT.fetchGrid(g, t0, t1, model, ctx); WT.srcDrop && WT.srcDrop('bkMap'); return G; }
    catch (e) { if (WT.isCancelled(e)) throw e; err = e; }
    try { const G = await WT.fetchGridBackup(g, t0, t1, ctx); G.mainErr = err; return G; }
    catch (e) {
      if (WT.isCancelled(e)) throw e;
      WT.src && WT.src('bkMap', 'down', { note: e.message });
      throw new Error(err.message + '. Резервная карта NOAA: ' + e.message);
    }
  };
})();
