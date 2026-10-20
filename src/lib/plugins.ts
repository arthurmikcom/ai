// «Плагины»: what MARYX can look up for an answer from free services with no
// keys (the browser shows this list; server/plugins.ts does the looking up).

export type PluginId =
  | "weather"
  | "currency"
  | "crypto"
  | "wikipedia"
  | "news"
  | "github"
  | "holidays"
  | "arxiv"
  | "time"
  | "travel"
  | "music"
  | "sports"
  | "stocks"
  | "binance"
  | "science"
  | "books"
  | "hackernews"
  | "packages";

export type PluginCategory = "everyday" | "travel" | "finance" | "knowledge" | "fun" | "dev";

export interface PluginInfo {
  id: PluginId;
  name: string;
  /** One line, under the name. */
  description: string;
  /** A few lines for the plugin's page. */
  about: string;
  category: PluginCategory;
  /** What to ask in the chat (the first one is «Попробовать в чате»). */
  examples: string[];
  /** What it gives MARYX, for the plugin's page. */
  features: { title: string; text: string }[];
  /** Where the data comes from (named in the answer). */
  source: { name: string; url: string; terms?: string };
}

export const PLUGIN_CATEGORIES: { id: PluginCategory; label: string }[] = [
  { id: "everyday", label: "На каждый день" },
  { id: "travel", label: "Путешествия" },
  { id: "finance", label: "Финансы" },
  { id: "knowledge", label: "Знания и наука" },
  { id: "fun", label: "Музыка и спорт" },
  { id: "dev", label: "Для разработчиков" },
];

export const PLUGINS: PluginInfo[] = [
  {
    id: "weather",
    name: "Погода",
    description: "Прогноз на сегодня и неделю в любом городе",
    about: "Спросите о погоде как человека — «нужен ли зонт», «во что одеться», «какая погода на выходных» — и MARYX ответит по свежему прогнозу для этого места: температура, ветер, осадки, по дням до недели вперёд.",
    category: "everyday",
    examples: ["Какая погода в Париже завтра?", "Нужен ли зонт в Лондоне на выходных?", "Во что одеться в Токио в эту пятницу?"],
    features: [
      { title: "Сейчас", text: "Температура, ветер, влажность и небо прямо сейчас" },
      { title: "Прогноз до 7 дней", text: "Минимум и максимум, осадки и погода на каждый день" },
      { title: "Любое место", text: "Город, район или адрес — по всему миру" },
    ],
    source: { name: "MET Norway (yr.no)", url: "https://www.yr.no/", terms: "https://api.met.no/doc/TermsOfService" },
  },
  {
    id: "news",
    name: "Новости",
    description: "Свежие новости со всего мира по любой теме",
    about: "MARYX просматривает новости мировых изданий за последние дни и пересказывает главное по вашей теме — со ссылками на сами статьи, чтобы можно было прочитать первоисточник.",
    category: "everyday",
    examples: ["Что нового в мире ИИ?", "Последние новости о космосе", "Что происходит на рынке электромобилей?"],
    features: [
      { title: "Весь мир", text: "Издания из разных стран и на разных языках" },
      { title: "Свежее", text: "Последние три дня, самое новое первым" },
      { title: "Ссылки на статьи", text: "Каждый факт — с источником" },
    ],
    source: { name: "GDELT — новости мира", url: "https://www.gdeltproject.org/", terms: "https://www.gdeltproject.org/about.html#termsofuse" },
  },
  {
    id: "time",
    name: "Мировое время",
    description: "Который час в любом городе и разница во времени",
    about: "Точное время в любой точке мира с учётом летнего времени, и разница между городами — чтобы назначить звонок или не разбудить коллегу.",
    category: "everyday",
    examples: ["Который час в Токио?", "Какая разница во времени между Дубаем и Нью-Йорком?", "Во сколько по Лондону будет 18:00 в Сингапуре?"],
    features: [
      { title: "Любой город", text: "Все часовые пояса мира" },
      { title: "Летнее время", text: "Переходы учитываются сами" },
      { title: "Без запросов наружу", text: "Считается прямо на сервере MARYX" },
    ],
    source: { name: "База часовых поясов IANA", url: "https://www.iana.org/time-zones" },
  },
  {
    id: "holidays",
    name: "Праздники",
    description: "Государственные праздники и выходные любой страны",
    about: "Официальные праздники и выходные дни более чем 100 стран — чтобы спланировать поездку, отпуск или работу с командой из другой страны.",
    category: "everyday",
    examples: ["Какие праздники в мае в Германии?", "Когда следующий выходной в ОАЭ?", "Какие праздники в США в этом году?"],
    features: [
      { title: "100+ стран", text: "Государственные праздники по коду страны" },
      { title: "Ближайший выходной", text: "MARYX подскажет, какой праздник следующий" },
      { title: "Любой год", text: "Прошлые и будущие годы" },
    ],
    source: { name: "Nager.Date", url: "https://date.nager.at/" },
  },
  {
    id: "currency",
    name: "Курсы валют",
    description: "Курсы 160+ валют мира и пересчёт сумм",
    about: "Актуальные курсы валют всего мира и пересчёт любых сумм: из евро в доллары, из иен в фунты — в одном вопросе.",
    category: "finance",
    examples: ["Какой курс евро к доллару?", "Сколько будет 500 евро в японских иенах?", "Переведи 1200 долларов в дирхамы ОАЭ"],
    features: [
      { title: "160+ валют", text: "Все валюты мира по кодам ISO" },
      { title: "Пересчёт сумм", text: "Любая сумма в любую валюту" },
      { title: "Обновление каждый день", text: "Курсы на сегодня, с датой" },
    ],
    source: { name: "ExchangeRate-API", url: "https://www.exchangerate-api.com/", terms: "https://www.exchangerate-api.com/terms" },
  },
  {
    id: "crypto",
    name: "Криптовалюты",
    description: "Цены биткоина, эфира и других монет за сутки",
    about: "Текущие цены криптовалют в долларах и других валютах и их изменение за сутки — для биткоина, эфира, TON, Solana и тысяч других монет.",
    category: "finance",
    examples: ["Сколько стоит биткоин?", "Как изменился курс TON за сутки?", "Сравни цены Ethereum и Solana"],
    features: [
      { title: "Тысячи монет", text: "Биткоин, эфир, TON, Solana и другие" },
      { title: "За сутки", text: "Изменение цены в процентах" },
      { title: "В любой валюте", text: "Доллары, евро и другие" },
    ],
    source: { name: "CoinGecko", url: "https://www.coingecko.com/", terms: "https://www.coingecko.com/en/terms" },
  },
  {
    id: "wikipedia",
    name: "Википедия",
    description: "Проверенные факты о людях, местах и событиях",
    about: "Когда нужен точный факт — дата, биография, история места — MARYX сверяется с Википедией на языке вопроса и даёт ссылку на статью.",
    category: "knowledge",
    examples: ["Кто такой Никола Тесла?", "Расскажи про историю Барселоны", "Что такое квантовая запутанность?"],
    features: [
      { title: "Факты, а не догадки", text: "Ответ сверяется со статьёй" },
      { title: "На вашем языке", text: "Статья на языке вопроса" },
      { title: "Ссылка на статью", text: "Чтобы прочитать полностью" },
    ],
    source: { name: "Wikipedia", url: "https://www.wikipedia.org/", terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use" },
  },
  {
    id: "arxiv",
    name: "Научные статьи",
    description: "Свежие исследования с arXiv",
    about: "Поиск научных статей на arXiv — физика, математика, информатика, ИИ — и короткий пересказ, о чём они, со ссылками на сами работы.",
    category: "knowledge",
    examples: ["Найди научные статьи про квантовые компьютеры", "Новые исследования о генерации видео", "Что пишут учёные о долгой памяти у ИИ?"],
    features: [
      { title: "Миллионы статей", text: "Открытый архив научных работ" },
      { title: "Кратко о главном", text: "О чём статья — в двух словах" },
      { title: "Ссылки на работы", text: "Полный текст бесплатно" },
    ],
    source: { name: "arXiv", url: "https://arxiv.org/", terms: "https://info.arxiv.org/help/api/tou.html" },
  },
  {
    id: "github",
    name: "GitHub",
    description: "Найти открытый проект, звёзды, последние версии",
    about: "Ищите бесплатные проекты с открытым кодом: MARYX найдёт самые популярные по звёздам, расскажет, что они умеют, под какой лицензией и какая у них последняя версия.",
    category: "dev",
    examples: ["Найди на GitHub бесплатный аналог Photoshop", "Какая последняя версия ComfyUI на GitHub?", "Покажи популярные open-source проекты для видеомонтажа"],
    features: [
      { title: "Поиск проектов", text: "Самые популярные по звёздам" },
      { title: "Последняя версия", text: "Номер и дата выпуска" },
      { title: "Лицензия", text: "Можно ли использовать в коммерции" },
    ],
    source: { name: "GitHub", url: "https://github.com/", terms: "https://docs.github.com/site-policy/github-terms/github-terms-of-service" },
  },
  {
    id: "travel",
    name: "Путешествия",
    description: "Отели, авиабилеты и экскурсии: Booking.com, Skyscanner, Airbnb…",
    about:
      "Скажите, куда и когда едете — MARYX подготовит готовые поиски с вашими датами и числом гостей: отели на Booking.com и Airbnb, билеты в Google Flights и Skyscanner, места и экскурсии на Tripadvisor и GetYourGuide. Цены и наличие — на сайте сервиса, бронируете вы сами.",
    category: "travel",
    examples: ["Найди отель в Барселоне на 12–15 ноября на двоих", "Билеты из Лондона в Рим на 5 декабря", "Что посмотреть и какие экскурсии в Стамбуле?"],
    features: [
      { title: "Отели и жильё", text: "Booking.com и Airbnb с вашими датами и гостями" },
      { title: "Авиабилеты", text: "Google Flights и Skyscanner по маршруту и дате" },
      { title: "Экскурсии и места", text: "Tripadvisor и GetYourGuide для города" },
    ],
    source: { name: "Booking.com, Airbnb, Google Flights, Skyscanner, Tripadvisor, GetYourGuide", url: "https://www.booking.com/" },
  },
  {
    id: "music",
    name: "Музыка",
    description: "Песни, альбомы и исполнители: Apple Music, Spotify",
    about:
      "Найдите песню, альбом или исполнителя: MARYX покажет треки с годом выхода и альбомом, даст ссылку на Apple Music с отрывком для прослушивания и готовые поиски в Spotify и YouTube Music.",
    category: "fun",
    examples: ["Найди последние песни Dua Lipa", "В каком альбоме песня Bohemian Rhapsody?", "Посоветуй альбомы Daft Punk"],
    features: [
      { title: "Песни и альбомы", text: "Название, исполнитель, альбом и год" },
      { title: "Послушать отрывок", text: "Ссылка на Apple Music" },
      { title: "Spotify и YouTube Music", text: "Готовый поиск в один клик" },
    ],
    source: { name: "Apple iTunes Search", url: "https://music.apple.com/", terms: "https://www.apple.com/legal/internet-services/itunes/" },
  },
  {
    id: "sports",
    name: "Спорт",
    description: "Счёт, расписание и результаты: футбол, NBA, NHL, NFL, MLB",
    about:
      "Результаты и расписание матчей: английская Премьер-лига, Ла Лига, Бундеслига, Серия A, Лига 1, Лига чемпионов, Лига Европы, MLS, NBA, NHL, NFL и MLB — счёт, статус матча и дата, прямо в ответе.",
    category: "fun",
    examples: ["Какой счёт в матчах АПЛ сегодня?", "Кто вчера выиграл в NBA?", "Когда следующий матч Реала в Лиге чемпионов?"],
    features: [
      { title: "Счёт и статус", text: "Идёт, закончился или ещё впереди" },
      { title: "Лучшие лиги", text: "Футбол Европы и MLS, NBA, NHL, NFL, MLB" },
      { title: "Любой день", text: "Сегодня, вчера или на неделе" },
    ],
    source: { name: "ESPN", url: "https://www.espn.com/" },
  },
  {
    id: "stocks",
    name: "Акции",
    description: "Котировки акций США, Европы и Азии и изменение за день",
    about: "Цена акций любой крупной компании мира — Apple, Tesla, Nvidia, SAP, Toyota — с открытием, максимумом, минимумом и изменением за торговый день. Не инвестиционный совет.",
    category: "finance",
    examples: ["Сколько стоят акции Apple?", "Как сегодня торгуется Nvidia?", "Сравни акции Tesla и BYD"],
    features: [
      { title: "Биржи мира", text: "США, Европа, Великобритания, Япония" },
      { title: "За день", text: "Открытие, максимум, минимум, изменение" },
      { title: "Несколько сразу", text: "До пяти компаний в одном вопросе" },
    ],
    source: { name: "Yahoo Finance, Stooq", url: "https://finance.yahoo.com/" },
  },
  {
    id: "binance",
    name: "Binance",
    description: "Цены пар и объём торгов за сутки на Binance",
    about: "Рыночные данные крупнейшей криптобиржи: цена любой пары (BTC/USDT, ETH/BTC, TON/USDT…), изменение, максимум, минимум и объём торгов за 24 часа. Без входа в аккаунт — только публичные данные.",
    category: "finance",
    examples: ["Какая цена BTC/USDT на Binance?", "Объём торгов ETH на Binance за сутки", "Как изменилась пара SOL/USDT за день?"],
    features: [
      { title: "Любая пара", text: "Тысячи торговых пар биржи" },
      { title: "За 24 часа", text: "Изменение, максимум, минимум, объём" },
      { title: "Без аккаунта", text: "Только публичные рыночные данные" },
    ],
    source: { name: "Binance Market Data", url: "https://www.binance.com/", terms: "https://www.binance.com/en/terms" },
  },
  {
    id: "science",
    name: "Научные исследования",
    description: "Что говорит наука: 250 млн работ с цитированием",
    about:
      "Как Consensus и SciSpace: MARYX ищет научные работы по вашему вопросу во всех областях — медицина, психология, экономика, физика — и опирается на самые цитируемые, называя авторов, год и журнал, со ссылками на сами работы.",
    category: "knowledge",
    examples: ["Что говорят исследования о пользе кофе?", "Помогает ли медитация от тревожности — научные данные", "Последние исследования о сне и памяти"],
    features: [
      { title: "Все науки", text: "Работы из тысяч журналов мира" },
      { title: "Самые значимые", text: "Число цитирований у каждой работы" },
      { title: "Ссылки на работы", text: "DOI и журнал — чтобы проверить" },
    ],
    source: { name: "OpenAlex", url: "https://openalex.org/", terms: "https://openalex.org/about" },
  },
  {
    id: "books",
    name: "Книги",
    description: "Поиск книг, авторов и годов издания",
    about: "Найдите книгу по названию, автору или теме: MARYX назовёт автора, год первого издания и даст ссылку на страницу книги в открытой библиотеке.",
    category: "knowledge",
    examples: ["Какие книги написал Харуки Мураками?", "Найди книги о стоицизме", "Когда вышла книга «Sapiens»?"],
    features: [
      { title: "Миллионы книг", text: "Открытая библиотека Internet Archive" },
      { title: "Автор и год", text: "Первое издание и число изданий" },
      { title: "Ссылка на книгу", text: "Описание и где прочитать" },
    ],
    source: { name: "Open Library", url: "https://openlibrary.org/" },
  },
  {
    id: "hackernews",
    name: "Hacker News",
    description: "О чём спорят разработчики и стартапы",
    about: "Самые обсуждаемые истории Hacker News по теме: новые технологии, стартапы, ИИ — с числом голосов и комментариев и ссылками на обсуждение.",
    category: "dev",
    examples: ["Что обсуждают на Hacker News про ИИ-агентов?", "Самые популярные истории о Rust", "Что пишут на Hacker News о стартапах в 2026?"],
    features: [
      { title: "Главное по теме", text: "Истории с голосами и комментариями" },
      { title: "Свежее", text: "Новые обсуждения первыми" },
      { title: "Ссылки", text: "На статью и на обсуждение" },
    ],
    source: { name: "Hacker News (Algolia)", url: "https://news.ycombinator.com/" },
  },
  {
    id: "packages",
    name: "npm и PyPI",
    description: "Последние версии библиотек JavaScript и Python",
    about: "Актуальная версия любой библиотеки из npm или PyPI, дата выпуска, лицензия и описание — чтобы код от MARYX был на свежих версиях.",
    category: "dev",
    examples: ["Какая последняя версия react на npm?", "Последняя версия pandas на PyPI", "Что нового в next?"],
    features: [
      { title: "npm и PyPI", text: "JavaScript и Python" },
      { title: "Последняя версия", text: "Номер, дата и лицензия" },
      { title: "Для кода", text: "MARYX пишет под свежие версии" },
    ],
    source: { name: "npm, PyPI", url: "https://www.npmjs.com/" },
  },
];

/** On for everyone until they change it: the most useful ones. */
export const DEFAULT_PLUGINS: PluginId[] = ["weather", "news", "time", "currency", "crypto", "wikipedia", "travel", "music", "sports", "stocks"];

export function isPluginId(id: unknown): id is PluginId {
  return typeof id === "string" && PLUGINS.some((p) => p.id === id);
}

export function pluginInfo(id: string): PluginInfo | undefined {
  return PLUGINS.find((p) => p.id === id);
}

export function pluginName(id: PluginId): string {
  return PLUGINS.find((p) => p.id === id)?.name ?? id;
}
