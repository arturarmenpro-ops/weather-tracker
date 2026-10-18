// Язык страницы: EN | RU (переключатель в верхней панели, выбор запоминается).
// Исходные надписи — русские. По-английски их переводит словарь ниже прямо на странице, в том числе всё,
// что страница дописывает потом (карточка, подсказки, окна). Названия баллов Бофорта/Дугласа, «в скулу»,
// дни недели переводятся в самих расчётах (scales.js), чтобы не путать похожие слова.
// Текст людей (заметки рейса, история версий) не переводится — у таких мест класс notr.
(function () {
  const WT = (window.WT = window.WT || {});
  let lang = 'ru';
  try { lang = localStorage.getItem('wt.lang') === 'en' ? 'en' : 'ru'; } catch (e) { /* приватный режим */ }
  const q = new URLSearchParams(location.search).get('lang'); // ссылка с ?lang=en сразу по-английски
  if (q === 'en' || q === 'ru') lang = q;
  WT.lang = lang;
  document.documentElement.lang = lang;

  const DICT = {
    // ---- верхняя панель, панель маршрута, слои ----
    '☰ Маршрут': '☰ Route', 'Маршрут и рейс': 'Route and voyage', 'Маршрут': 'Route', 'Таблица': 'Table', 'Графики': 'Charts',
    'Сравнить маршруты': 'Compare routes', 'Сравнить с Windy': 'Compare with Windy', 'Сравнение маршрутов': 'Route comparison',
    '— выбрать —': '— select —', '★ Рейс из Telegram': '★ Voyage from Telegram', 'Открыть файл': 'Open file',
    '(ECDIS Furuno, JRC…), GPX или текст с координатами — или перетащите сюда': '(ECDIS Furuno, JRC…), GPX or a text with coordinates — or drop it here',
    'Позиция судна, если уже в пути': 'Ship position, if already under way', '(необязательно)': '(optional)', 'напр.': 'e.g.',
    'Отход, UTC': 'Departure, UTC', 'Время позиции, UTC': 'Position time, UTC', 'От точки': 'From WP', 'Скорость, уз': 'Speed, kn',
    'Шаг расчёта': 'Time step', '1 час': '1 hour', '2 часа': '2 hours', '3 часа': '3 hours', '6 часов': '6 hours',
    'Судовое время, UTC±': 'Ship time, UTC±', 'Предел ветра, Бф': 'Wind limit, Bf', 'Предел волны, м': 'Wave limit, m',
    'Построить погоду по маршруту': 'Build route weather', 'Сохранить рейс для ссылки капитану': "Save voyage for the captain's link",
    'Точки маршрута': 'Route points', 'Скорость в строке — для участка, который ведёт к этой точке. Пусто — общая скорость.': 'A speed in a row is for the leg leading to that point. Empty — the general speed.',
    'Точка': 'Point', 'Широта': 'Latitude', 'Долгота': 'Longitude', 'Участок': 'Leg', 'Уз': 'Kn',
    'Откуда погода': 'Where the weather comes from', 'Ветер и давление:': 'Wind and pressure:', 'Волна и зыбь:': 'Waves and swell:', 'Течения:': 'Currents:',
    'ECMWF (Европа), GFS (NOAA, США), ICON (DWD, Германия) — те же модели, что у Windy.': 'ECMWF (Europe), GFS (NOAA, USA), ICON (DWD, Germany) — the same models as Windy.',
    'Copernicus Marine / Mercator — тот же источник, что у Windy.': 'Copernicus Marine / Mercator — the same source as Windy.',
    'Данные собирает бесплатный сервис Open-Meteo. На карте и в карточке — среднее (медиана) по моделям и разброс; значок показывает, согласны ли модели.':
      'Data comes through the free Open-Meteo service. The map and the card show the median of the models and their spread; the badge shows whether the models agree.',
    'Резерв': 'Backup',
    '(если Open-Meteo недоступен или исчерпан его лимит) — напрямую от метеослужб, бесплатно: ECMWF через MET Norway (Норвегия), GFS и волна WaveWatch III от NOAA (США). Что сейчас работает — значок ⚠ вверху.':
      '(if Open-Meteo is down or its limit is used up) — directly from weather services, free: ECMWF via MET Norway (Norway), GFS and WaveWatch III waves from NOAA (USA). What works now — the ⚠ icon at the top.',
    'Прогноз — подсказка для планирования, не замена NAVTEX, официальных прогнозов ГМССБ и решения капитана.': "The forecast is a planning aid, not a replacement for NAVTEX, official GMDSS forecasts or the master's decision.",
    'Прогноз': 'Forecast', 'Море': 'Sea', 'Сейчас': 'Now', 'Модель ветра': 'Wind model', 'Частицы': 'Particles', 'Изобары': 'Isobars', 'Знаки OpenSeaMap': 'OpenSeaMap marks',
    'Порывы': 'Gusts', 'Осадки': 'Precipitation', 'Облачность': 'Clouds', 'Давление': 'Pressure', 'Видимость': 'Visibility',
    'Волны': 'Waves', 'Зыбь': 'Swell', 'Ветр. волна': 'Wind wave', 'Течения': 'Currents', 'Радар': 'Radar', 'Спутник': 'Satellite',
    'загрузите маршрут': 'load a route', 'Скачать CSV': 'Download CSV', 'Погода по маршруту': 'Route weather',
    'открыть windy.com ↗': 'open windy.com ↗', '↻ по судну': '↻ to ship', 'Источники погоды': 'Weather sources',
    // подсказки кнопок
    'Версия и последнее изменение': 'Version and last change', 'Закрыть — значок ⚠ вверху откроет снова': 'Close — the ⚠ icon at the top opens it again',
    'Закрыть': 'Close', 'Записать этот рейс в voyage.json — его покажет страница по ссылке': 'Write this voyage to voyage.json — the link page will show it',
    'Источники погоды: что работает, что нет — нажмите': 'Weather sources: what works and what does not — tap', 'Источники погоды: что работает, что нет': 'Weather sources: what works and what does not',
    'Источники погоды снова работают': 'Weather sources work again', 'Поставить Windy в точку и время судна': "Set Windy to the ship's point and time",
    'Пуск / пауза': 'Play / pause', 'Свернуть / развернуть': 'Collapse / expand', 'Скорость анимации': 'Animation speed', 'Язык страницы': 'Page language',
    // ---- карточка судна, лента времени ----
    'судовое': 'ship time', 'Судовое': 'Ship time', 'КК': 'Co', 'пройдено': 'run', 'Пройдено': 'Run', 'осталось': 'to go', 'в пути': 'under way', 'прибытие': 'arrival',
    'Ветровая волна': 'Wind waves', 'Волна (общая)': 'Waves (total)', 'Течение': 'Current', 'Ветер': 'Wind', 'ветер': 'wind', 'Волна': 'Waves', 'волна': 'waves',
    '✓ модели согласны': '✓ models agree', '! модели расходятся': '! models differ', '‼ сильно расходятся': '‼ models disagree strongly', 'одна модель': 'one model',
    'разброс': 'spread', 'Разброс': 'Spread', 'порывы': 'gusts', 'период': 'period', 'длина ≈': 'length ≈', 'Дуглас зыбь': 'Douglas swell', 'Дуглас': 'Douglas',
    'Нет прогноза на это время (дальше горизонта: ветер ~16 сут, волна ~10 сут).': 'No forecast for this time (beyond the range: wind ~16 days, waves ~10 days).',
    'Нет прогноза на это время': 'No forecast for this time', 'нет прогноза': 'no forecast',
    'Резервный прогноз: ECMWF (MET Norway), GFS и волна WaveWatch III (NOAA). Течений нет. Полный прогноз загрузится сам, когда основной источник снова заработает.':
      'Backup forecast: ECMWF (MET Norway), GFS and WaveWatch III waves (NOAA). No currents. The full forecast will load by itself when the main source works again.',
    'Варианты в это же время': 'Variants at the same time', 'Получен': 'Received', 'внёс:': 'by:', 'Штурман': 'Shturman', 'по просьбе Артура': "at Artur's request",
    'ETD из файла': 'ETD from file', 'точек': 'points', 'точки': 'points', 'миль': 'nm', 'Миль': 'NM',
    // таблица и график
    'Время UTC': 'Time UTC', 'Позиция': 'Position', 'Ветер откуда': 'Wind from', 'Ветер: модели': 'Wind: models', 'Волна: модели': 'Waves: models',
    'Ветер, уз': 'Wind, kn', 'Ветер уз': 'Wind kn', 'Волна м': 'Waves m', 'Ветр. волна м': 'Wind wave m', 'Волна (общая), м': 'Waves (total), m', 'Волна, м': 'Waves, m',
    'Ветровая волна, м': 'Wind waves, m', 'Зыбь, м': 'Swell, m', 'Течение, уз': 'Current, kn', 'Порывы ветра, уз': 'Wind gusts, kn', 'Осадки, мм/ч': 'Precipitation, mm/h',
    'Облачность, %': 'Cloud cover, %', 'Давление, гПа': 'Pressure, hPa', 'Видимость, км': 'Visibility, km', 'предел': 'limit',
    'Радар осадков — сейчас': 'Precipitation radar — now', 'Спутник — облака сейчас': 'Satellite — clouds now', 'Течение →': 'Current →',
    // всплывающие сообщения
    'Загружаю прогноз по маршруту…': 'Loading the route forecast…', 'Погода по маршруту готова': 'Route weather ready',
    'Готово. Нет прогноза для': 'Done. No forecast for', 'точек (дальше горизонта прогноза).': 'points (beyond the forecast range).',
    'Основной прогноз сейчас недоступен — показан сохранённый': 'The main forecast is unavailable right now — showing the one saved', 'ч назад': 'h ago',
    'Основной прогноз недоступен — показан резерв: ECMWF (MET Norway), GFS и волна NOAA. Подробно — значок ⚠ вверху': 'Main forecast unavailable — showing the backup: ECMWF (MET Norway), GFS and NOAA waves. Details — the ⚠ icon at the top',
    'Основной прогноз снова работает — загружаю полный…': 'Main forecast works again — loading the full one…',
    'Варианты маршрута готовы:': 'Route variants ready:', 'Варианты маршрута не загрузились:': 'Route variants did not load:',
    'Карта погоды готова (сетка': 'Weather map ready (grid', 'Карта погоды из резерва NOAA (GFS, WaveWatch III), сетка': 'Weather map from the NOAA backup (GFS, WaveWatch III), grid',
    'Видимость: модель GFS (у ECMWF её нет)': 'Visibility: GFS model (ECMWF has none)', 'Видимость не загрузилась:': 'Visibility did not load:',
    'Не открылся маршрут': 'Could not open route', 'Не понял позицию. Пример: 45 30.5 N 010 15.2 W': 'Position not understood. Example: 45 30.5 N 010 15.2 W',
    'Не сохранилось:': 'Not saved:', 'Укажите время отхода': 'Enter the departure time', 'Сначала постройте рейс': 'Build the voyage first',
    'Откройте файл маршрута (RTZ, GPX или текст)': 'Open a route file (RTZ, GPX or text)', 'В рейсе из Telegram нет маршрута': 'The Telegram voyage has no route',
    'Позиция изменилась — сначала нажмите «Построить погоду по маршруту»': 'Position changed — first press «Build route weather»',
    'Позиция не распознана — рейс не сохранён': 'Position not recognised — voyage not saved',
    'Рейс сохранён для ссылки (voyage.json). На странице по ссылке он появится после выкладки.': 'Voyage saved for the link (voyage.json). It will appear on the link page after publishing.',
    'Позиция судна': 'Ship position', 'точка судна': 'ship point', 'к точке': 'to WP', 'файл не найден': 'file not found', 'Рейс': 'Voyage',
    'Основным выбран «': 'Main route is now «', 'Был основным:': 'Was main:', '» на этом экране.': '» on this screen.',
    'подложка не грузится, погода и маршрут видны': 'base map is not loading; weather and route are visible',
    'Открыть эту точку в Windy ↗': 'Open this point in Windy ↗', 'во Windy выберите это же время внизу': 'in Windy pick the same time at the bottom',
    'суша / нет данных о волне': 'land / no wave data', 'у нас:': 'ours:', 'облачность': 'cloud cover', 'сетка': 'grid',
    'Цветной карты погоды пока нет.': 'No colour weather map yet.', 'Прогноз по маршруту пока не загрузился (маршрут на карте показан).': 'The route forecast has not loaded yet (the route is shown on the map).',
    'Похоже, нет интернета или серверы погоды не отвечают. Страница сама повторит через несколько минут.': 'Looks like there is no internet or the weather servers are not answering. The page will retry by itself in a few minutes.',
    'У бесплатного сервиса погоды лимит запросов на один интернет-адрес (на судне через Starlink — общий для всех устройств), а резерв сейчас тоже не ответил. Когда лимит снимется, страница сама загрузит прогноз — обновлять не нужно.':
      'The free weather service limits requests per internet address (on board via Starlink it is shared by all devices), and the backup did not answer either. When the limit resets, the page will load the forecast by itself — no need to refresh.',
    // окно «Источники погоды»
    'Основной прогноз — Open-Meteo (ECMWF, GFS, ICON, 4 волновые модели, течения)': 'Main forecast — Open-Meteo (ECMWF, GFS, ICON, 4 wave models, currents)',
    'Резерв: ECMWF через MET Norway (ветер, порывы, давление)': 'Backup: ECMWF via MET Norway (wind, gusts, pressure)',
    'Резерв: NOAA напрямую (ветер GFS, волна и зыбь WaveWatch III)': 'Backup: NOAA direct (GFS wind, WaveWatch III waves and swell)',
    'Резерв для цветной карты: NOAA GFS и WaveWatch III': 'Backup for the colour map: NOAA GFS and WaveWatch III',
    'Радар (RainViewer)': 'Radar (RainViewer)', 'Спутник (NASA, EUMETSAT)': 'Satellite (NASA, EUMETSAT)', 'Подложка карты (Esri)': 'Base map (Esri)',
    ': лимит запросов в минуту — повтор через': ': per-minute request limit — retry in', ': часовой лимит исчерпан — снова заработает через': ': hourly limit used up — works again in',
    ': дневной лимит исчерпан — снова заработает через': ': daily limit used up — works again in', '(в начале часа UTC), страница повторит сама': '(at the top of the hour UTC), the page will retry by itself',
    '(в 00:00 UTC), страница повторит сама': '(at 00:00 UTC), the page will retry by itself', ': не отвечает': ': not responding', '; повтор через': '; retry in',
    ': снова работает': ': works again', ': работает — ветер в': ': works — wind at', ': работает — ветер, давление, осадки': ': works — wind, pressure, precipitation', ': работает': ': works', 'работает — ветер в': 'works — wind at', ', волна в': ', waves at',
    'работает — ветер, давление, осадки': 'works — wind, pressure, precipitation', ', волна и зыбь': ', waves and swell',
    '(порывов, облачности, видимости и течений в резерве нет)': '(no gusts, clouds, visibility or currents in the backup)', 'часть данных не загрузилась': 'some data did not load',
    'Пока основной источник недоступен, прогноз взят из резерва: моделей меньше, течений, облачности и видимости нет.': 'While the main source is unavailable, the forecast comes from the backup: fewer models, no currents, clouds or visibility.',
    'Пока источник недоступен, на странице остаётся последнее полученное.': 'While a source is unavailable, the page keeps the last data it received.',
    'Когда основной снова заработает, страница сама загрузит полный прогноз — обновлять ничего не нужно.': 'When the main source works again, the page will load the full forecast by itself — no need to refresh.',
    'Лимит Open-Meteo': 'Open-Meteo limit', 'нет данных на эти даты': 'no data for these dates', 'нет связи с сервером': 'no connection to the server',
    'сервер NOAA перегружен, повторю через несколько минут': 'NOAA server is overloaded, will retry in a few minutes', 'сервер не ответил вовремя': 'the server did not answer in time',
    'сервер ответил ошибкой': 'the server returned error', 'нет в резерве': 'not in the backup', 'даты рейса вне резервного прогноза NOAA': 'voyage dates are outside the NOAA backup forecast',
    'резервные источники (ECMWF через MET Norway и NOAA) тоже не дали данных': 'the backup sources (ECMWF via MET Norway and NOAA) gave no data either',
    '. Резервная карта NOAA:': '. NOAA backup map:', '. Резерв:': '. Backup:', '(резерв NOAA)': '(NOAA backup)',
    'Резерв: ECMWF (MET Norway), GFS и волна (NOAA)…': 'Backup: ECMWF (MET Norway), GFS and waves (NOAA)…', 'Резервная карта: NOAA GFS и WaveWatch III…': 'Backup map: NOAA GFS and WaveWatch III…',
    'ECMWF через MET Norway (резерв)': 'ECMWF via MET Norway (backup)', 'NOAA GFS напрямую от NOAA (резерв)': 'NOAA GFS direct from NOAA (backup)',
    'NOAA WaveWatch III напрямую от NOAA (резерв)': 'NOAA WaveWatch III direct from NOAA (backup)',
    // погода (weather.js)
    'Ветер: ECMWF, GFS, ICON…': 'Wind: ECMWF, GFS, ICON…', 'Волна и зыбь: 4 модели…': 'Waves and swell: 4 models…', 'Течения…': 'Currents…', 'Видимость (GFS)…': 'Visibility (GFS)…',
    'Карта ветра (': 'Wind map (', 'Карта волн и течений…': 'Waves and currents map…', 'Даты рейса вне прогноза': 'Voyage dates are outside the forecast',
    'Дневной лимит бесплатного Open-Meteo исчерпан (сброс в 00:00 UTC)': 'Free Open-Meteo daily limit used up (resets at 00:00 UTC)',
    'Часовой лимит бесплатного Open-Meteo исчерпан (сброс в начале часа UTC)': 'Free Open-Meteo hourly limit used up (resets at the top of the hour UTC)',
    'Лимит запросов Open-Meteo в минуту — жду минуту…': 'Open-Meteo per-minute limit — waiting a minute…', 'Нет интернета или Open-Meteo недоступен': 'No internet or Open-Meteo is unavailable',
    'нет интернета или сервис недоступен': 'no internet or the service is unavailable', 'Open-Meteo ответил ошибкой (': 'Open-Meteo returned an error (',
    'сервис ответил ошибкой': 'the service returned error', 'ответил:': 'answered:', 'ошибка': 'error',
    'ECMWF IFS 0.25° (Европа)': 'ECMWF IFS 0.25° (Europe)', 'NOAA GFS (США)': 'NOAA GFS (USA)', 'DWD ICON (Германия)': 'DWD ICON (Germany)',
    'ECMWF WAM (Европа) — только общая волна': 'ECMWF WAM (Europe) — total waves only', 'NOAA GFS-Wave / WaveWatch III (США)': 'NOAA GFS-Wave / WaveWatch III (USA)',
    'DWD GWAM (Германия)': 'DWD GWAM (Germany)', 'через': 'via',
    // радар и спутник (live.js)
    'Радар осадков · сейчас': 'Precipitation radar · now', 'Спутник · облака (ИК) · сейчас': 'Satellite · clouds (IR) · now', 'Радар:': 'Radar:', 'Спутник:': 'Satellite:',
    'Радары на берегу, видят ~200 км. В море — смотрите «Спутник».': 'Radars are on shore and see ~200 km. At sea — use «Satellite».',
    'Meteosat (Европа, Африка, Инд. океан) — серым: белее = выше облака. Не прогноз.': 'Meteosat (Europe, Africa, Indian Ocean) — in grey: whiter = higher clouds. Not a forecast.',
    'низкие/тёплые': 'low/warm', 'мощные облака, грозы': 'towering clouds, thunderstorms', 'слабый': 'light', 'сильный': 'heavy',
    'загрузка…': 'loading…', 'не загрузилось:': 'did not load:', 'нет снимков': 'no images', 'ответ': 'response', 'мин назад)': 'min ago)',
    'часть снимков не загрузилась (сервер спутника не ответил) — показано, что есть': 'some images did not load (the satellite server did not answer) — showing what there is',
    // маршрут (route.js)
    'RTZ-файл повреждён (ошибка XML).': 'The RTZ file is damaged (XML error).', 'В файле найдено точек:': 'Points found in the file:', '. Нужно минимум две.': '. At least two are needed.', 'текст': 'text',
    // варианты маршрута (variants.js)
    'Сделать основным': 'Make main', 'лучший': 'best', 'сверх предела': 'over the limit', 'Нет прогноза': 'No forecast', '✓ нет': '✓ none', 'нет данных на части пути': 'no data on part of the route',
    'Худший ветер': 'Worst wind', 'Худшая волна': 'Worst waves', 'Сверх пределов (': 'Over limits (', '»: погода по маршруту…': '»: route weather…',
    'Значения — медиана по моделям в точке судна на каждом маршруте. «Сверх пределов» — сколько часов ветер или волна не меньше пределов судна.':
      "Values are the model median at the ship's point on each route. «Over limits» — how many hours wind or waves are at or above the ship's limits.",
    'нет прогноза / вне рейса': 'no forecast / outside the voyage', 'Вариант': 'Variant', 'Основной': 'Main',
    // карта и единицы
    'Карта': 'Map', 'ч/с': 'h/s', 'уз': 'kn', 'Бф': 'Bf', 'гПа': 'hPa', 'мм/ч': 'mm/h', 'км': 'km', 'м': 'm', 'из': 'from',
  };
  const CY = 'А-Яа-яЁё';
  const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // границы слова — только там, где фраза начинается или кончается буквой (у «, волна…» перед запятой может стоять буква)
  const isL = (c) => /[А-Яа-яЁё]/.test(c);
  const RX = new RegExp(Object.keys(DICT).sort((a, b) => b.length - a.length)
    .map((k) => (isL(k[0]) ? '(?<![' + CY + '])' : '') + reEsc(k) + (isL(k[k.length - 1]) ? '(?![' + CY + '])' : '')).join('|'), 'g');
  // число + единица (после словаря): «11.2 с», «2 ч», «16 сут», «5 мин»; «Д 5» на графике
  const UNITS = [
    [new RegExp('(\\d)\\s?сут(?![' + CY + '])', 'g'), '$1 d'], [new RegExp('(\\d)\\s?мин(?![' + CY + '])', 'g'), '$1 min'],
    [new RegExp('(\\d)\\s?ч(?![' + CY + '])', 'g'), '$1 h'], [new RegExp('(\\d)\\s?с(?![' + CY + '])', 'g'), '$1 s'],
    [new RegExp('(?<![' + CY + '])Д(?= ?\\d)', 'g'), 'D'],
  ];
  WT.tr = function (s) {
    if (lang !== 'en' || !s || !/[А-Яа-яЁё]/.test(s)) return s;
    s = s.replace(RX, (m, off, str) => (m === 'из' && /^ \d/.test(str.slice(off + 2)) ? 'of' : DICT[m]));
    for (const [re, to] of UNITS) s = s.replace(re, to);
    return s;
  };

  // ---- перевод на странице: запоминаем русский текст каждого узла, чтобы вернуть его при переключении на RU ----
  const memo = new WeakMap(); // узел → { ru, en } или элемент → { атрибут: { ru, en } }
  const ATTRS = ['title', 'placeholder', 'aria-label'];
  const SKIP = /^(SCRIPT|STYLE|TEXTAREA|IFRAME|NOSCRIPT)$/; // у полей ввода переводим только подсказку (placeholder), не значение
  const skip = (el) => !el || SKIP.test(el.nodeName) || (el.closest && el.closest('.notr'));
  function textNode(n) {
    const m = memo.get(n), cur = n.nodeValue;
    if (lang === 'en') {
      if (m && cur === m.en) return;
      if (skip(n.parentElement)) return;
      const en = WT.tr(cur);
      if (en !== cur) { memo.set(n, { ru: cur, en }); n.nodeValue = en; } else memo.delete(n);
    } else if (m && cur === m.en) { n.nodeValue = m.ru; memo.delete(n); }
  }
  function attrs(el) {
    if (skip(el)) return;
    let m = memo.get(el);
    for (const a of ATTRS) {
      const cur = el.getAttribute(a);
      if (cur == null) continue;
      const r = m && m[a];
      if (lang === 'en') {
        if (r && cur === r.en) continue;
        const en = WT.tr(cur);
        if (en !== cur) { m = m || {}; m[a] = { ru: cur, en }; memo.set(el, m); el.setAttribute(a, en); }
      } else if (r && cur === r.en) { el.setAttribute(a, r.ru); delete m[a]; }
    }
  }
  function walk(root) {
    if (root.nodeType === 3) return textNode(root);
    if (root.nodeType !== 1 || skip(root)) return;
    attrs(root);
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (n.nodeType === 1 && skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) n.nodeType === 3 ? textNode(n) : attrs(n);
  }
  const obs = new MutationObserver((list) => {
    if (lang !== 'en') return;
    for (const r of list) {
      if (r.type === 'characterData') textNode(r.target);
      else if (r.type === 'attributes') attrs(r.target);
      else r.addedNodes.forEach(walk);
    }
  });

  WT.setLang = function (l) {
    lang = WT.lang = l === 'en' ? 'en' : 'ru';
    document.documentElement.lang = lang;
    try { localStorage.setItem('wt.lang', lang); } catch (e) { /* приватный режим */ }
    walk(document.body);
    paintSwitch();
    if (WT.onLang) WT.onLang(); // страница перерисует карточку, графики, шкалу — с новым языком
  };
  function paintSwitch() {
    document.querySelectorAll('#langSw [data-lang]').forEach((b) => b.classList.toggle('on', b.dataset.lang === lang));
  }
  function start() {
    document.getElementById('langSw').addEventListener('click', (e) => { const b = e.target.closest('[data-lang]'); if (b && b.dataset.lang !== lang) WT.setLang(b.dataset.lang); });
    paintSwitch();
    if (lang === 'en') walk(document.body);
    obs.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
