// «Сейчас» (не прогноз): радар осадков и спутник — последние снимки, можно прокрутить по кругу, как у Windy.
// Радар: RainViewer (бесплатно для личного пользования; до 2 ч назад, шаг 10 мин; приближение до 7; 100 запросов/мин).
// Спутник: NASA GIBS — геостационарные GOES-East, GOES-West, Himawari (инфракрасный канал 13, шаг 10 мин, задержка ~40–60 мин)
//          + EUMETSAT Meteosat для Европы, Африки и Индийского океана (если доступен).
(function () {
  const WT = (window.WT = window.WT || {});
  const RV = 'https://api.rainviewer.com/public/weather-maps.json';
  const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/';
  // зоны раздела между спутниками (по долготе), чтобы каждый участок показывал «свой» спутник
  const SATS = [
    // границы — середины между точками стояния спутников
    { id: 'GOES-West_ABI_Band13_Clean_Infrared', bounds: [[-80, -180], [80, -106.2]] },
    { id: 'GOES-East_ABI_Band13_Clean_Infrared', bounds: [[-80, -106.2], [80, -37.6]] },
    { id: 'Himawari_AHI_Band13_Clean_Infrared', bounds: [[-80, 93.1], [80, 180]] },
  ];
  // Meteosat (EUMETSAT, WMS): 0° — Атлантика, Европа, Африка; IODC — Индийский океан. Шаг 15 мин, задержка ~20 мин.
  const EUMET = 'https://view.eumetsat.int/geoserver/wms';
  const METEOSAT = [
    { layer: 'msg_fes:ir108', bounds: [[-77, -37.6], [77, 22.75]] },
    { layer: 'msg_iodc:ir108', bounds: [[-77, 22.75], [77, 93.1]] },
  ];
  WT.EUMETSAT = (iso) => {
    const g = L.layerGroup();
    for (const m of METEOSAT) {
      L.tileLayer.wms(EUMET, {
        layers: m.layer, styles: '', format: 'image/png', transparent: true, version: '1.3.0', time: iso,
        tileSize: 512, maxNativeZoom: 8, bounds: m.bounds, pane: 'live', opacity: 1,
        attribution: 'Meteosat <a href="https://view.eumetsat.int/" target="_blank" rel="noopener">©EUMETSAT ' + new Date().getUTCFullYear() + '</a>',
      }).addTo(g);
    }
    return g;
  };
  const MIN = 60e3;
  const st = { kind: null, group: null, frames: [], idx: 0, timer: null, rv: null, rvAt: 0, msg: '', tok: 0 };

  const p2 = (n) => String(n).padStart(2, '0');
  const hhmm = (ms) => { const d = new Date(ms); return p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()); };
  const ago = (ms) => Math.max(0, Math.round((Date.now() - ms) / MIN));

  async function radarFrames() {
    if (!st.rv || Date.now() - st.rvAt > 5 * MIN) {
      const r = await fetch(RV, { cache: 'no-store' });
      if (!r.ok) throw new Error('RainViewer ' + r.status);
      st.rv = await r.json(); st.rvAt = Date.now();
    }
    const past = (st.rv.radar && st.rv.radar.past) || [];
    // каждый второй кадр (через 20 мин) — чтобы не упереться в лимит 100 запросов/мин
    const pick = past.filter((f, i) => (past.length - 1 - i) % 2 === 0);
    return pick.map((f) => ({
      t: f.time * 1000,
      make: () => L.tileLayer(st.rv.host + f.path + '/512/{z}/{x}/{y}/2/1_1.png', {
        tileSize: 512, zoomOffset: -1, maxNativeZoom: 8, maxZoom: 18, opacity: 0, pane: 'live', updateWhenIdle: true, keepBuffer: 1,
        attribution: 'Радар: <a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>',
      }),
    }));
  }

  function satFrames() {
    // последний надёжно готовый снимок ~70 мин назад (у NASA задержка ~35–45 мин, у EUMETSAT ~25), затем назад через 20 мин
    const t0 = Math.floor((Date.now() - 70 * MIN) / (10 * MIN)) * 10 * MIN;
    const out = [];
    for (let k = 5; k >= 0; k--) {
      const t = t0 - k * 20 * MIN;
      const iso = new Date(t).toISOString().slice(0, 19) + 'Z';
      out.push({
        t,
        make: () => {
          const g = L.layerGroup();
          for (const s of SATS) {
            L.tileLayer(GIBS + s.id + '/default/' + iso + '/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png', {
              maxNativeZoom: 6, maxZoom: 18, bounds: s.bounds, opacity: 1, pane: 'live',
              attribution: 'Спутник: <a href="https://earthdata.nasa.gov/gibs" target="_blank" rel="noopener">NASA GIBS / ESDIS</a> (GOES — NOAA, Himawari — JMA)',
            }).addTo(g);
          }
          WT.EUMETSAT(iso).addTo(g);
          const all = (o, grp) => grp.eachLayer((l) => (l.setOpacity ? l.setOpacity(o) : all(o, l)));
          g.setOpacity = (o) => all(o, g);
          return g;
        },
      });
    }
    return out;
  }

  function showFrame(i) {
    if (!st.group) return;
    st.idx = i;
    st.frames.forEach((f, k) => { if (f.layer) f.layer.setOpacity(k === i ? (st.kind === 'radar' ? 0.85 : 0.75) : 0); });
    const f = st.frames[i];
    if (f && !f.layer) { f.layer = f.make(); f.layer.addTo(st.group); f.layer.setOpacity(st.kind === 'radar' ? 0.85 : 0.75); }
    if (WT.onLiveChange) WT.onLiveChange();
  }

  WT.live = {
    async show(kind) {
      const map = WT.map;
      if (st.kind === kind && st.group) return;
      this.hide();
      const tok = st.tok; // если пока ждали снимки, слой переключили — результат выбрасываем
      if (!map.getPane('live')) { map.createPane('live'); map.getPane('live').style.zIndex = 260; map.getPane('live').style.pointerEvents = 'none'; }
      st.kind = kind; st.group = L.layerGroup().addTo(map); st.msg = 'загрузка…';
      if (WT.onLiveChange) WT.onLiveChange();
      try {
        const frames = kind === 'radar' ? await radarFrames() : satFrames();
        if (tok !== st.tok) return;
        if (!frames.length) throw new Error('нет снимков');
        st.frames = frames; st.msg = '';
        showFrame(st.frames.length - 1);
      } catch (e) {
        if (tok !== st.tok) return;
        st.msg = 'не загрузилось: ' + e.message;
        if (WT.onLiveChange) WT.onLiveChange();
      }
    },
    hide() {
      clearTimeout(st.timer); st.timer = null;
      st.tok++;
      if (st.group) WT.map.removeLayer(st.group);
      st.group = null; st.kind = null; st.frames = []; st.idx = 0; st.msg = '';
    },
    playing: () => !!st.timer,
    play() {
      if (!st.frames.length || st.timer) return;
      const step = () => {
        const n = st.frames.length, next = (st.idx + 1) % n;
        showFrame(next);
        st.timer = setTimeout(step, next === n - 1 ? 1800 : 700); // на последнем кадре — пауза
      };
      st.timer = setTimeout(step, 300);
      if (WT.onLiveChange) WT.onLiveChange();
    },
    stop() {
      clearTimeout(st.timer); st.timer = null;
      if (st.frames.length) {
        showFrame(st.frames.length - 1);
        // скрытые кадры убираем с карты — иначе они продолжают грузить плитки при каждом сдвиге карты (лимит RainViewer 100/мин)
        st.frames.forEach((f, k) => { if (k !== st.idx && f.layer) { if (st.group) st.group.removeLayer(f.layer); f.layer = null; } });
      } else if (WT.onLiveChange) WT.onLiveChange();
    },
    legendHtml(kind) {
      const f = st.frames[st.idx];
      const title = kind === 'radar' ? 'Радар осадков · сейчас' : 'Спутник · облака (ИК) · сейчас';
      const time = st.msg ? '<span class="muted">' + st.msg + '</span>'
        : f ? '<b>' + hhmm(f.t) + ' UTC</b> <span class="muted">(' + ago(f.t) + ' мин назад)</span>' : '';
      const btn = st.frames.length > 1 ? '<button class="btn sm" id="liveLoop">' + (st.timer ? '❚❚' : '▶ 2 ч') + '</button>' : '';
      const scale = kind === 'radar'
        ? '<div class="bar" style="background:linear-gradient(90deg,#88ddee,#0099cc,#0077aa,#005588,#ffee00,#ffaa00,#ff4400,#c10000,#ffaaff)"></div><div class="lbl"><span>слабый</span><span>сильный</span></div>' +
          '<div class="muted" style="margin-top:3px">Радары на берегу, видят ~200 км. В море — смотрите «Спутник».</div>'
        : '<div class="bar" style="background:linear-gradient(90deg,#3a3a3a,#9a9a9a,#e6e6e6,#5ab4ff,#1e5cff,#35d435,#ffff3c,#ff8c00,#e00000)"></div><div class="lbl"><span>низкие/тёплые</span><span>мощные облака, грозы</span></div>' +
          '<div class="muted" style="margin-top:3px">Meteosat (Европа, Африка, Инд. океан) — серым: белее = выше облака. Не прогноз.</div>';
      return '<div class="live-h">' + title + ' ' + btn + '</div><div>' + time + '</div>' + scale;
    },
  };
})();
