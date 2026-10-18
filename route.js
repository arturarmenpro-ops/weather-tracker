// Маршрут: чтение файлов (RTZ, GPX, текст/CSV) и навигационный счёт (локсодромия / ортодромия).
(function () {
  const WT = (window.WT = window.WT || {});
  const R = 3440.065; // радиус Земли в морских милях
  const rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
  const wrap180 = (l) => ((((l + 180) % 360) + 360) % 360) - 180;
  const wrapPi = (x) => ((((x + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;

  // ================= ЧТЕНИЕ ФАЙЛОВ =================
  WT.parseRoute = function (fileName, text) {
    const t = text.replace(/^\uFEFF/, '');
    let r;
    if (/<route[\s>]/i.test(t) && /waypoint/i.test(t)) r = parseRTZ(t);
    else if (/<gpx[\s>]/i.test(t)) r = parseGPX(t);
    else r = parseText(t);
    r.file = fileName;
    if (!r.name) r.name = fileName.replace(/\.[^.]+$/, '');
    if (r.wps.length < 2) throw new Error('В файле найдено точек: ' + r.wps.length + '. Нужно минимум две.');
    r.wps.forEach((w, i) => { if (!w.name) w.name = 'WP' + (i + 1); w.lon = wrap180(w.lon); });
    return r;
  };

  function byLocal(root, name) {
    const out = [];
    const all = root.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) if (all[i].localName === name) out.push(all[i]);
    return out;
  }
  const child = (el, name) => { for (const c of el.children) if (c.localName === name) return c; return null; };

  // RTZ (IEC 61174) — формат обмена маршрутами ECDIS (Furuno, JRC, Transas …)
  function parseRTZ(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('RTZ-файл повреждён (ошибка XML).');
    const info = byLocal(doc, 'routeInfo')[0];
    const res = { format: 'RTZ', name: info ? info.getAttribute('routeName') || '' : '', vessel: info ? info.getAttribute('vesselName') || '' : '', wps: [] };
    const ids = {};
    const dwp = byLocal(doc, 'defaultWaypoint')[0], dleg = dwp ? child(dwp, 'leg') : null;
    const legAttr = (leg, a) => (leg && leg.getAttribute(a)) || (dleg && dleg.getAttribute(a)) || '';
    for (const w of byLocal(doc, 'waypoint')) {
      const pos = child(w, 'position');
      if (!pos) continue;
      const lat = parseFloat(pos.getAttribute('lat')), lon = parseFloat(pos.getAttribute('lon'));
      if (isNaN(lat) || isNaN(lon)) continue;
      const leg = child(w, 'leg');
      const g = legAttr(leg, 'geometryType');
      const wp = {
        id: w.getAttribute('id'),
        name: w.getAttribute('name') || '',
        lat, lon,
        // в RTZ данные участка (leg) записаны у точки, К которой участок ведёт
        geom: /ortho/i.test(g) ? 'GC' : 'RL',
        speed: null,
      };
      {
        const smax = parseFloat(legAttr(leg, 'speedMax')), smin = parseFloat(legAttr(leg, 'speedMin'));
        if (!isNaN(smax) && smax > 0) wp.speed = smax; else if (!isNaN(smin) && smin > 0) wp.speed = smin;
      }
      ids[wp.id] = wp;
      res.wps.push(wp);
    }
    // расписание: берём «calculated», иначе «manual»; первая точка — ETD, остальные — скорость участка
    const sch = byLocal(doc, 'schedule')[0];
    if (sch) {
      const els = byLocal(sch, 'scheduleElement');
      for (const e of els) {
        const wp = ids[e.getAttribute('waypointId')];
        if (!wp) continue;
        const sp = parseFloat(e.getAttribute('speed'));
        if (!isNaN(sp) && sp > 0) wp.speed = sp;
        const etd = e.getAttribute('etd');
        if (etd && wp === res.wps[0] && !res.etd) res.etd = Date.parse(etd.endsWith('Z') || /[+-]\d\d:?\d\d$/.test(etd) ? etd : etd + 'Z');
      }
    }
    return res;
  }

  function parseGPX(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    let pts = byLocal(doc, 'rtept');
    if (!pts.length) pts = byLocal(doc, 'trkpt');
    if (!pts.length) pts = byLocal(doc, 'wpt');
    const nameEl = byLocal(doc, 'name')[0];
    return {
      format: 'GPX', name: nameEl ? nameEl.textContent.trim() : '',
      wps: pts.map((p) => {
        const n = child(p, 'name');
        return { name: n ? n.textContent.trim() : '', lat: parseFloat(p.getAttribute('lat')), lon: parseFloat(p.getAttribute('lon')), geom: 'RL', speed: null };
      }).filter((w) => !isNaN(w.lat) && !isNaN(w.lon)),
    };
  }

  // Текст / CSV: ищем в каждой строке широту и долготу в любом привычном виде:
  // 36°12.345'N 014°30.123'E · 36 12.3 N 14 30.1 E · N36°12.3 E014°30.1 · 3612.345N · 36-12.3N · 36.2058 14.5020
  const num = (s) => parseFloat(String(s).replace(',', '.'));
  // одна строка → {lat, lon, at} (at — где начались координаты) или null
  WT.findLatLon = function (raw) {
    const line = String(raw).replace(/[\u2032\u2019`´]/g, "'").replace(/[\u2033\u201D]/g, '"');
    {
      let found = { lat: null, lon: null, at: Infinity };
      // знак градуса: °, º, ˚, d, deg, * и «�» (так выглядит ° из файла Windows в неверной кодировке)
      const D = String.raw`(?:deg|[°º˚d*\uFFFD])`, DS = String.raw`(?:(?:deg|[°º˚d:\-*\uFFFD])\s*|\s+)`, NUM = String.raw`(\d{1,2}(?:[.,]\d+)?)`;
      const R = (src) => new RegExp(src, 'gi');
      const pats = [
        // градусы-минуты-секунды со знаками: 36°12'30"N
        [R(String.raw`(\d{1,3})\s*` + D + String.raw`\s*(\d{1,2})\s*'\s*` + NUM + String.raw`\s*"?\s*([NSEW])(?![A-Z])`), (m) => num(m[1]) + num(m[2]) / 60 + num(m[3]) / 3600, 4],
        // градусы-минуты-секунды через пробелы: 45 30 30 N 010 15 15 W (нужны и широта, и долгота в таком виде)
        [R(String.raw`(?<![\d.])(\d{1,3})\s+(\d{1,2})\s+` + NUM + String.raw`\s*([NSEW])(?![A-Z])`), (m) => num(m[1]) + num(m[2]) / 60 + num(m[3]) / 3600, 4],
        // градусы-минуты + полушарие: 36°12.3'N, 36 12.3 N, 36-12.3N
        [R(String.raw`(\d{1,3})\s*` + DS + NUM + String.raw`\s*'?\s*([NSEW])(?![A-Z])`), (m) => num(m[1]) + num(m[2]) / 60, 3],
        // полушарие впереди: N36°12.3, E 014 30.1, N45°30'30", N 45 30 30
        [R(String.raw`(?<![A-Z])([NSEW])\s*(\d{1,3})\s*` + DS + NUM + String.raw`(?:\s*'\s*` + NUM + String.raw`\s*"|\s+` + NUM + String.raw`(?=\s*(?:[NSEW]|$)))?\s*'?`),
          (m) => num(m[2]) + num(m[3]) / 60 + (m[4] || m[5] ? num(m[4] || m[5]) / 3600 : 0), 1],
        // NMEA: 3612.345N, 01430.123,E
        [/(?<!\d)(\d{2,3})(\d{2}\.\d+)\s*,?\s*([NSEW])(?![A-Z])/gi, (m) => num(m[1]) + num(m[2]) / 60, 3],
        // десятичные градусы с полушарием: 36.2058N (не внутри записи «градусы-минуты»)
        [R(String.raw`(?<![\d.])(?<!\d\s*(?:[^\w\s,;]|deg)\s*)(\d{1,3}[.,]\d+)\s*°?\s*([NSEW])(?![A-Z])`), (m) => num(m[1]), 2],
      ];
      // каждый вид записи пробуем отдельно; берём первый, где нашлись и широта, и долгота
      for (const [re, val, hi] of pats) {
        const f = { lat: null, lon: null, at: Infinity };
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(line))) {
          const v = val(m), h = m[hi].toUpperCase();
          if (isNaN(v)) continue;
          if ((h === 'N' || h === 'S') && f.lat == null) f.lat = h === 'S' ? -v : v;
          else if ((h === 'E' || h === 'W') && f.lon == null) f.lon = h === 'W' ? -v : v;
          else continue;
          f.at = Math.min(f.at, m.index);
        }
        if (f.lat != null && f.lon != null) { found = f; break; }
      }
      if (found.lat == null) {
        // просто два десятичных числа: широта, долгота
        const m = line.match(/(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/);
        if (m) { found.lat = parseFloat(m[1]); found.lon = parseFloat(m[2]); found.at = m.index; }
      }
      if (found.lat == null || found.lon == null || Math.abs(found.lat) > 90 || Math.abs(found.lon) > 180) return null;
      return found;
    }
  };

  function parseText(text) {
    const wps = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/[′’`´]/g, "'").replace(/[″”]/g, '"');
      if (!line.trim() || /^\s*(#|\/\/)/.test(line)) continue;
      const found = WT.findLatLon(line);
      if (!found) continue;
      // имя — то, что стоит до координат (без кавычек и разделителей)
      let name = line.slice(0, found.at === Infinity ? 0 : found.at).replace(/[";,\t]+/g, ' ').trim();
      if (/^\d+$/.test(name)) name = 'WP' + name;
      else name = name.replace(/^\d{1,3}[.)]?\s+/, '');
      // скорость в строке, если подписана: 12.5 kn / 12 уз
      const sp = line.match(/(?<![\d.,])(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:kn|kts|knots|уз(?:л|лов|\.)?)(?![\p{L}\d])/iu);
      wps.push({ name: name.slice(0, 30), lat: found.lat, lon: found.lon, geom: 'RL', speed: sp ? num(sp[1]) : null });
    }
    return { format: 'текст', name: '', wps };
  }

  // ================= НАВИГАЦИЯ =================
  WT.rhumb = function (a, b) {
    const f1 = rad(a.lat), f2 = rad(b.lat), df = f2 - f1;
    const dl = wrapPi(rad(b.lon - a.lon));
    const dpsi = Math.log(Math.tan(Math.PI / 4 + f2 / 2) / Math.tan(Math.PI / 4 + f1 / 2));
    const q = Math.abs(dpsi) > 1e-12 ? df / dpsi : Math.cos(f1);
    return { dist: Math.sqrt(df * df + q * q * dl * dl) * R, course: (deg(Math.atan2(dl, dpsi)) + 360) % 360 };
  };
  function rhumbDest(a, course, dist) {
    const d = dist / R, th = rad(course), f1 = rad(a.lat);
    let f2 = f1 + d * Math.cos(th);
    if (Math.abs(f2) > Math.PI / 2) f2 = f2 > 0 ? Math.PI - f2 : -Math.PI - f2;
    const dpsi = Math.log(Math.tan(f2 / 2 + Math.PI / 4) / Math.tan(f1 / 2 + Math.PI / 4));
    const q = Math.abs(dpsi) > 1e-12 ? (f2 - f1) / dpsi : Math.cos(f1);
    return { lat: deg(f2), lon: wrap180(a.lon + deg((d * Math.sin(th)) / q)) };
  }
  WT.great = function (a, b) {
    const f1 = rad(a.lat), f2 = rad(b.lat), dl = rad(b.lon - a.lon);
    const h = Math.sin((f2 - f1) / 2) ** 2 + Math.cos(f1) * Math.cos(f2) * Math.sin(dl / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return { dist: c * R, course: (deg(Math.atan2(y, x)) + 360) % 360, ang: c };
  };
  function greatInter(a, b, f) {
    const g = WT.great(a, b);
    if (g.ang < 1e-9) return { lat: a.lat, lon: a.lon };
    const f1 = rad(a.lat), l1 = rad(a.lon), f2 = rad(b.lat), l2 = rad(b.lon);
    const A = Math.sin((1 - f) * g.ang) / Math.sin(g.ang), B = Math.sin(f * g.ang) / Math.sin(g.ang);
    const x = A * Math.cos(f1) * Math.cos(l1) + B * Math.cos(f2) * Math.cos(l2);
    const y = A * Math.cos(f1) * Math.sin(l1) + B * Math.cos(f2) * Math.sin(l2);
    const z = A * Math.sin(f1) + B * Math.sin(f2);
    return { lat: deg(Math.atan2(z, Math.sqrt(x * x + y * y))), lon: deg(Math.atan2(y, x)) };
  }

  // точка на участке по доле пути 0..1 + курс в этой точке
  function legPoint(leg, f) {
    if (leg.geom === 'GC') {
      const p = greatInter(leg.a, leg.b, f);
      const c = f < 0.999 ? WT.great(p, leg.b).course : leg.courseEnd;
      return { lat: p.lat, lon: p.lon, course: c };
    }
    const p = rhumbDest(leg.a, leg.course, leg.dist * f);
    return { lat: p.lat, lon: p.lon, course: leg.course };
  }

  // Рейс: участки от стартовой точки с временем начала/конца
  // opts: { startIdx, depMs, speed (по умолчанию), speeds: {i: уз} (ручные правки для участка к точке i) }
  // К какой точке маршрута идёт судно из позиции p: участок, от которого позиция отклоняется меньше всего
  WT.nextWpFor = function (route, p) {
    const w = route.wps;
    let best = 1, bestD = Infinity;
    for (let i = 0; i < w.length - 1; i++) {
      const d = WT.great(w[i], p).dist + WT.great(p, w[i + 1]).dist - WT.great(w[i], w[i + 1]).dist;
      if (d <= bestD + 1e-9) { bestD = d; best = i + 1; } // при равенстве — дальний участок
    }
    return best;
  };

  // opts.startPos = {lat, lon}: рейс от текущей позиции судна (а не от точки маршрута) — к ближайшей следующей точке
  WT.buildVoyage = function (route, opts) {
    const wps = route.wps, legs = [];
    let t = opts.depMs, gone = 0, from = Math.max(0, opts.startIdx || 0), pos = null;
    if (opts.startPos) {
      pos = { name: 'Позиция', lat: opts.startPos.lat, lon: opts.startPos.lon };
      from = WT.nextWpFor(route, pos) - 1;
      // позиция совпала со следующей точкой — идём сразу к точке после неё
      if (from + 1 < wps.length - 1 && WT.great(pos, wps[from + 1]).dist < 0.05) from += 1;
    }
    for (let i = from; i < wps.length - 1; i++) {
      const a = i === from && pos ? pos : wps[i], b = wps[i + 1];
      const geom = b.geom === 'GC' ? 'GC' : 'RL';
      const m = geom === 'GC' ? WT.great(a, b) : WT.rhumb(a, b);
      const sp = (opts.speeds && opts.speeds[i + 1]) || b.speed || opts.speed;
      const leg = { i: i + 1, a, b, geom, dist: m.dist, course: m.course, speed: sp, t0: t, d0: gone };
      if (geom === 'GC') leg.courseEnd = (WT.great(b, a).course + 180) % 360;
      leg.t1 = t + (m.dist / sp) * 3600e3;
      t = leg.t1; gone += m.dist;
      legs.push(leg);
    }
    return { legs, dep: opts.depMs, eta: t, dist: gone, startIdx: from, startPos: pos };
  };

  WT.positionAt = function (voy, ms) {
    const L = voy.legs;
    if (!L.length) return null;
    if (ms <= voy.dep) { const p = legPoint(L[0], 0); return Object.assign(p, { leg: L[0], gone: 0, sog: L[0].speed, state: 'before' }); }
    if (ms >= voy.eta) { const l = L[L.length - 1]; const p = legPoint(l, 1); return Object.assign(p, { leg: l, gone: voy.dist, sog: 0, state: 'arrived' }); }
    for (const l of L) {
      if (ms <= l.t1) {
        const f = l.t1 > l.t0 ? (ms - l.t0) / (l.t1 - l.t0) : 1;
        const p = legPoint(l, f);
        return Object.assign(p, { leg: l, gone: l.d0 + l.dist * f, sog: l.speed, state: 'underway' });
      }
    }
  };

  // точки для запроса погоды: на отходе, затем каждые stepH часов (ровные часы UTC) и на приходе
  WT.samples = function (voy, stepH) {
    const out = [], H = 3600e3, step = stepH * H;
    const push = (t) => { const p = WT.positionAt(voy, t); out.push({ t, lat: p.lat, lon: p.lon, course: p.course, gone: p.gone, leg: p.leg.i }); };
    push(voy.dep);
    let t = Math.floor(voy.dep / step) * step + step;
    for (; t < voy.eta - H / 4; t += step) push(t);
    push(voy.eta);
    return out;
  };

  // линия маршрута для карты: долготы «без разрыва» через 180°
  WT.routeLine = function (route, fromIdx) {
    const pts = [];
    const wps = route.wps;
    for (let i = fromIdx || 0; i < wps.length - 1; i++) {
      const a = wps[i], b = wps[i + 1];
      if (b.geom === 'GC') {
        const g = WT.great(a, b), n = Math.max(2, Math.ceil(g.dist / 50));
        for (let k = 0; k <= n; k++) pts.push(greatInter(a, b, k / n));
      } else {
        pts.push({ lat: a.lat, lon: a.lon }, { lat: b.lat, lon: b.lon });
      }
    }
    return WT.unwrap(pts);
  };
  WT.unwrap = function (pts) {
    const out = [];
    let prev = null;
    for (const p of pts) {
      let lon = p.lon;
      if (prev != null) { while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
      out.push([p.lat, lon]); prev = lon;
    }
    return out;
  };
  WT.wrap180 = wrap180;
})();
