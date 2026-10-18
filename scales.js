// Шкалы и морские форматы: Бофорт, Дуглас (волнение и зыбь), румбы, координаты.
(function () {
  const WT = (window.WT = window.WT || {});

  // ---- Бофорт, по скорости ветра в узлах (WMO) ----
  const BF = [
    [1, 'штиль'], [4, 'тихий'], [7, 'лёгкий'], [11, 'слабый'], [17, 'умеренный'],
    [22, 'свежий'], [28, 'сильный'], [34, 'крепкий'], [41, 'очень крепкий'],
    [48, 'шторм'], [56, 'сильный шторм'], [64, 'жестокий шторм'], [Infinity, 'ураган'],
  ];
  WT.beaufort = function (kn) {
    if (kn == null || isNaN(kn)) return null;
    const k = Math.round(kn); // таблица WMO — в целых узлах, и показываем мы тоже целые узлы
    for (let i = 0; i < BF.length; i++) if (k < BF[i][0]) return { n: i, name: BF[i][1] };
    return { n: 12, name: 'ураган' };
  };
  // нижняя граница балла в узлах (для линий на графике); с округлением граница — на полузле ниже
  WT.BF_KN = [0, 1, 4, 7, 11, 17, 22, 28, 34, 41, 48, 56, 64];
  WT.bfEdge = (n) => Math.max(0, WT.BF_KN[Math.min(12, n)] - 0.5);

  // ---- Дуглас: ветровое волнение / состояние моря по высоте (WMO 3700) ----
  const DS = [
    [0, 'зеркально гладкое', 'calm (glassy)'],
    [0.1, 'рябь', 'calm (rippled)'],
    [0.5, 'слабое', 'smooth'],
    [1.25, 'лёгкое', 'slight'],
    [2.5, 'умеренное', 'moderate'],
    [4, 'неспокойное', 'rough'],
    [6, 'крупное', 'very rough'],
    [9, 'сильное', 'high'],
    [14, 'очень сильное', 'very high'],
    [Infinity, 'исключительное', 'phenomenal'],
  ];
  WT.douglasSea = function (h) {
    if (h == null || isNaN(h)) return null;
    if (h <= 0) return { n: 0, name: DS[0][1], en: DS[0][2] };
    for (let i = 1; i < DS.length; i++) if (h <= DS[i][0]) return { n: i, name: DS[i][1], en: DS[i][2] };
    return { n: 9, name: DS[9][1], en: DS[9][2] };
  };

  // ---- Дуглас: зыбь по высоте и длине (длина из периода: L = 1.56·T²) ----
  const SW = {
    0: ['нет зыби', 'no swell'],
    1: ['низкая, короткая/средняя', 'low, short/average'],
    2: ['низкая, длинная', 'low, long'],
    3: ['умеренная, короткая', 'moderate, short'],
    4: ['умеренная, средняя', 'moderate, average'],
    5: ['умеренная, длинная', 'moderate, long'],
    6: ['высокая, короткая', 'heavy, short'],
    7: ['высокая, средняя', 'heavy, average'],
    8: ['высокая, длинная', 'heavy, long'],
  };
  WT.douglasSwell = function (h, period) {
    if (h == null || isNaN(h)) return null;
    const L = period ? 1.56 * period * period : null;
    const len = L == null ? 1 : L < 100 ? 0 : L <= 200 ? 1 : 2; // 0 short, 1 average, 2 long
    let n;
    if (h < 0.1) n = 0;
    else if (h < 2) n = len === 2 ? 2 : 1;
    else if (h <= 4) n = 3 + len;
    else n = 6 + len;
    return { n, name: SW[n][0], en: SW[n][1], length: L };
  };

  // ---- направления ----
  const PTS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  WT.compass = (deg) => (deg == null || isNaN(deg) ? '—' : PTS[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16]);
  WT.deg3 = (deg) => (deg == null || isNaN(deg) ? '—' : String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0') + '°');

  // откуда дует ветер / идёт волна — относительно носа судна
  WT.relFrom = function (fromDeg, course) {
    if (fromDeg == null || course == null) return '';
    let r = (((fromDeg - course) % 360) + 360) % 360; // 0 = прямо в нос
    const a = Math.round(r > 180 ? 360 - r : r);
    const side = a === 0 || a === 180 ? '' : r < 180 ? ' пр. борта' : ' лев. борта';
    let word;
    if (a <= 22.5) word = 'в нос';
    else if (a <= 67.5) word = 'в скулу';
    else if (a <= 112.5) word = 'в траверз';
    else if (a <= 157.5) word = 'в раковину';
    else word = 'в корму';
    return word + ', ' + a + '°' + side;
  };

  // течение: «куда» течёт → составляющая вдоль курса и снос
  WT.currentEffect = function (setDeg, drift, course) {
    if (setDeg == null || drift == null || course == null) return '';
    const r = ((setDeg - course) * Math.PI) / 180;
    const along = drift * Math.cos(r), cross = drift * Math.sin(r);
    const a = (along >= 0 ? '+' : '−') + Math.abs(along).toFixed(1) + ' уз ' + (along >= 0 ? 'попутное' : 'встречное');
    const c = Math.abs(cross) < 0.05 ? '' : ', сносит ' + (cross > 0 ? 'вправо ' : 'влево ') + Math.abs(cross).toFixed(1) + ' уз';
    return a + c;
  };

  // ---- координаты: 36°12.3'N 014°30.1'E ----
  WT.fmtLat = function (lat) {
    const h = lat >= 0 ? 'N' : 'S', a = Math.abs(lat);
    let d = Math.floor(a), m = (a - d) * 60;
    if (m >= 59.95) { d += 1; m = 0; }
    return String(d).padStart(2, '0') + '°' + m.toFixed(1).padStart(4, '0') + "'" + h;
  };
  WT.fmtLon = function (lon) {
    lon = ((((lon + 180) % 360) + 360) % 360) - 180;
    const h = lon >= 0 ? 'E' : 'W', a = Math.abs(lon);
    let d = Math.floor(a), m = (a - d) * 60;
    if (m >= 59.95) { d += 1; m = 0; }
    return String(d).padStart(3, '0') + '°' + m.toFixed(1).padStart(4, '0') + "'" + h;
  };

  // ---- время (всё внутри в UTC, мс) ----
  const p2 = (n) => String(n).padStart(2, '0');
  WT.fmtTime = function (ms, tzHours) {
    const d = new Date(ms + (tzHours || 0) * 3600e3);
    return p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1) + ' ' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes());
  };
  WT.fmtDay = function (ms, tzHours) {
    const d = new Date(ms + (tzHours || 0) * 3600e3);
    const wd = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'][d.getUTCDay()];
    return wd + ' ' + p2(d.getUTCDate()) + '.' + p2(d.getUTCMonth() + 1);
  };
  WT.isoDate = (ms) => new Date(ms).toISOString().slice(0, 10);
  WT.fmtDur = function (h) {
    const d = Math.floor(h / 24), r = Math.round(h - d * 24);
    return (d ? d + ' сут ' : '') + r + ' ч';
  };

  // ---- статусы и цвета (тёмная тема) ----
  WT.STATUS = { good: '#0ca30c', warning: '#fab219', serious: '#ec835a', critical: '#d03b3b', none: '#6b6b66' };

  // Цветовые шкалы слоёв карты — в духе Windy, по ступеням Бофорта / Дугласа
  WT.SCALES = {
    wind: { unit: 'уз', stops: [[0, '#3b4fa8'], [4, '#2f7dc4'], [7, '#2aa6a0'], [11, '#3fae4f'], [17, '#a5c33a'], [22, '#e5c23b'], [28, '#e8913a'], [34, '#d9532e'], [41, '#b7284f'], [48, '#8e2a87'], [64, '#5b1f6e']] },
    waves: { unit: 'м', stops: [[0, '#2c4f9e'], [0.5, '#2f7dc4'], [1.25, '#2aa6a0'], [2, '#3fae4f'], [2.5, '#a5c33a'], [3, '#e5c23b'], [4, '#e8913a'], [6, '#d9532e'], [9, '#b7284f'], [14, '#8e2a87']] },
    currents: { unit: 'уз', stops: [[0, '#1d2f5c'], [0.25, '#2f5fa8'], [0.5, '#2f7dc4'], [1, '#2aa6a0'], [1.5, '#a5c33a'], [2, '#e5c23b'], [3, '#e8913a'], [4, '#d9532e']] },
    // осадки мм/ч: меньше 0.1 — прозрачно (сухо)
    rain: { unit: 'мм/ч', min: 0.1, stops: [[0.1, '#3d6fc4'], [0.5, '#2fa4d9'], [1, '#2bb673'], [2, '#a5c33a'], [4, '#e5c23b'], [8, '#e8913a'], [16, '#d9532e'], [30, '#b7284f'], [50, '#8e2a87']] },
    // облачность %: меньше 10 % — прозрачно
    clouds: { unit: '%', min: 10, stops: [[10, '#2e3440'], [40, '#5b6470'], [70, '#9aa3ad'], [90, '#c9d0d7'], [100, '#e8ecf0']] },
    // давление гПа
    pressure: { unit: 'гПа', stops: [[960, '#5b1f6e'], [975, '#b7284f'], [990, '#d9532e'], [1000, '#e5c23b'], [1008, '#a5c33a'], [1013, '#2aa6a0'], [1020, '#2f7dc4'], [1030, '#3b4fa8'], [1045, '#2c2f7a']] },
    // видимость км: плохая — яркая
    vis: { unit: 'км', stops: [[0, '#d03b3b'], [1, '#e8913a'], [2, '#e5c23b'], [5, '#a5c33a'], [10, '#2aa6a0'], [20, '#2f5fa8'], [40, '#1d2f5c']] },
  };
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  for (const k in WT.SCALES) WT.SCALES[k].rgb = WT.SCALES[k].stops.map(([v, c]) => [v, hex(c)]);
  WT.colorAt = function (scaleKey, v) {
    const sc = WT.SCALES[scaleKey], s = sc.rgb;
    if (sc.min != null && v < sc.min) return null; // прозрачно (нет осадков / ясно)
    if (v <= s[0][0]) return s[0][1];
    for (let i = 1; i < s.length; i++) {
      if (v <= s[i][0]) {
        const f = (v - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
        const a = s[i - 1][1], b = s[i][1];
        return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
      }
    }
    return s[s.length - 1][1];
  };
})();
