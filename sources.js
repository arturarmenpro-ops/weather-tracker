// Окно «Источники погоды»: что работает, что упёрлось в лимит, когда заработает снова, что взято из резерва.
// Открывается само, когда появилась новая проблема. Крестик закрывает окно, а значок ⚠ в верхней панели
// остаётся, пока проблема есть, — нажали на него, окно открылось снова. Всё восстановилось — значок ✓ и через
// несколько секунд исчезает.
(function () {
  const WT = (window.WT = window.WT || {});
  const NAMES = {
    forecast: 'Основной прогноз — Open-Meteo (ECMWF, GFS, ICON, 4 волновые модели, течения)',
    bkEcmwf: 'Резерв: ECMWF через MET Norway (ветер, порывы, давление)',
    bkNoaa: 'Резерв: NOAA напрямую (ветер GFS, волна и зыбь WaveWatch III)',
    bkMap: 'Резерв для цветной карты: NOAA GFS и WaveWatch III',
    radar: 'Радар (RainViewer)',
    satellite: 'Спутник (NASA, EUMETSAT)',
    map: 'Подложка карты (Esri)',
  };
  const ORDER = Object.keys(NAMES);
  const st = {}; // key → { state: ok|okv|limit|hour|day|down|partial, until, note, err, recovered }
  let msg = '';            // пояснение от страницы (что не загрузилось и что делать)
  let open = false, timer = null, hideTimer = null, retryTimer = null;
  // закрытое окно помним 6 часов (и после перезагрузки страницы), чтобы та же проблема не выскакивала снова
  const memo = {
    get() { try { const x = JSON.parse(localStorage.getItem('wt.srcDismissed') || 'null'); return x && Date.now() - x.at < 6 * 36e5 ? x.sig : ''; } catch (e) { return ''; } },
    set(sig) { try { localStorage.setItem('wt.srcDismissed', JSON.stringify({ sig, at: Date.now() })); } catch (e) { /* приватный режим */ } },
  };
  let dismissed = memo.get();
  const BAD = ['limit', 'hour', 'day', 'down', 'partial'];
  const $ = (id) => document.getElementById(id);

  WT.src = function (key, state, opts) {
    const prev = st[key] && st[key].state;
    st[key] = Object.assign({ state, at: Date.now() }, opts || {});
    if (state === 'ok' && prev && BAD.includes(prev)) st[key].recovered = true;
    if (key === 'forecast' && state === 'ok') { delete st.bkEcmwf; delete st.bkNoaa; delete st.bkMap; }
    if (key === 'forecast') planRetry();
    render();
  };
  WT.srcDrop = function (key) { if (st[key]) { delete st[key]; render(); } };
  // лимит ещё действует — вернуть ошибку, чтобы не стучаться зря (ждём сброса)
  WT.srcBlocked = function (key) {
    const x = st[key];
    return x && ['hour', 'day'].includes(x.state) && x.until > Date.now() ? new Error(x.err || 'Лимит Open-Meteo') : null;
  };
  // пояснение в окне (пустая строка — убрать)
  WT.statusMsg = function (html) { msg = html || ''; render(); };
  // страница задаёт, что делать, когда пора повторить основной источник
  WT.onRetry = null;

  // основной прогноз упал — повторим сами: после сброса лимита, а без связи — через 5 минут
  function planRetry() {
    clearTimeout(retryTimer); retryTimer = null;
    const x = st.forecast;
    if (!x || !['hour', 'day', 'down'].includes(x.state)) return;
    const at = x.state === 'down' ? Date.now() + 5 * 60e3 : x.until + 20e3 + Math.random() * 40e3;
    x.retryAt = at;
    retryTimer = setTimeout(() => { retryTimer = null; if (WT.onRetry) WT.onRetry(); }, Math.min(at - Date.now(), 2 ** 31 - 1));
  }

  function left(ms) {
    const s = Math.max(0, Math.round((ms - Date.now()) / 1000));
    if (s < 90) return s + ' с';
    const m = Math.round(s / 60);
    return m < 90 ? m + ' мин' : Math.floor(m / 60) + ' ч ' + (m % 60) + ' мин';
  }
  function line(key, x) {
    const n = NAMES[key] || key;
    switch (x.state) {
      case 'limit': return ['warn', '⏳', n + ': лимит запросов в минуту — повтор через ' + left(x.until)];
      case 'hour': return ['bad', '⚠', n + ': часовой лимит исчерпан — снова заработает через ' + left(x.until) + ' (в начале часа UTC), страница повторит сама'];
      case 'day': return ['bad', '⚠', n + ': дневной лимит исчерпан — снова заработает через ' + left(x.until) + ' (в 00:00 UTC), страница повторит сама'];
      case 'down': return ['bad', '✕', n + ': не отвечает' + (x.note ? ' — ' + x.note : '') + (key === 'forecast' && x.retryAt ? '; повтор через ' + left(x.retryAt) : '')];
      case 'partial': return ['warn', '!', n + ': ' + (x.note || 'часть данных не загрузилась')];
      case 'okv': return ['ok', '✓', n + (x.note ? ': ' + x.note : ': работает')];
      case 'ok': return x.recovered ? ['ok', '✓', n + ': снова работает'] : null;
      default: return null;
    }
  }
  function render() {
    const box = $('notice'), btn = $('alertBtn');
    if (!box || !btn) return;
    const keys = ORDER.concat(Object.keys(st).filter((k) => !ORDER.includes(k))).filter((k) => st[k]);
    const rows = keys.map((k) => line(k, st[k])).filter(Boolean);
    const bad = keys.some((k) => BAD.includes(st[k].state));
    const backup = keys.some((k) => st[k].state === 'okv');
    const problem = bad || !!msg;
    // значок: красный — не работает и резерва нет, жёлтый — работаем на резерве / есть пояснение, зелёный — всё восстановилось
    const level = !problem && !backup ? (rows.length ? 'ok' : '') : bad && !backup ? 'bad' : 'warn';
    btn.hidden = !level;
    btn.className = 'alert ' + level;
    btn.textContent = level === 'ok' ? '✓' : '⚠';
    btn.title = level === 'ok' ? 'Источники погоды снова работают' : 'Источники погоды: что работает, что нет — нажмите';
    // новая проблема — окно открывается само (один раз); закрыли — ждёт, пока не появится другая
    // (резерв догрузился — это не новая проблема, окно само не выскакивает)
    const sig = msg.replace(/<[^>]*>|\d+/g, '') + '|' + keys.filter((k) => BAD.includes(st[k].state)).map((k) => k + ':' + st[k].state).join(',');
    if (problem && sig !== dismissed && !open) open = true;
    if (!level) open = false;
    $('noticeText').innerHTML = msg;
    $('noticeText').hidden = !msg;
    $('sources').innerHTML = rows.map(([cls, ic, t]) => '<div class="src ' + cls + '"><span class="ic">' + ic + '</span><span>' + t + '</span></div>').join('') +
      (bad || backup ? '<div class="src-note">' + (backup
        ? 'Пока основной источник недоступен, прогноз взят из резерва: моделей меньше, течений, облачности и видимости нет. '
        : 'Пока источник недоступен, на странице остаётся последнее полученное. ') +
        'Когда основной снова заработает, страница сама загрузит полный прогноз — обновлять ничего не нужно.</div>' : '');
    box.hidden = !open;
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    box.dataset.sig = sig;
    clearInterval(timer); timer = null;
    if (open && keys.some((k) => ['limit', 'hour', 'day', 'down'].includes(st[k].state))) timer = setInterval(render, 1000);
    clearTimeout(hideTimer);
    if (level === 'ok') hideTimer = setTimeout(() => { for (const k in st) st[k].recovered = false; render(); }, 6000);
  }
  function toggle(on) {
    open = on;
    if (!on) { dismissed = $('notice').dataset.sig || ''; memo.set(dismissed); }
    render();
  }
  document.addEventListener('DOMContentLoaded', () => {
    $('alertBtn').addEventListener('click', () => toggle(!open));
    $('noticeClose').addEventListener('click', () => toggle(false));
  });

  // время сброса лимитов Open-Meteo (окна фиксированные: минута, начало часа UTC, 00:00 UTC)
  WT.limitReset = function (kind) {
    const now = Date.now();
    if (kind === 'day') return Math.ceil(now / 864e5) * 864e5;
    if (kind === 'hour') return Math.ceil(now / 36e5) * 36e5;
    return now + 61e3;
  };
})();
