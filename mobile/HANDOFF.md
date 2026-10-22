# Передача работы: приложение MARYX Ai для Android и iPhone

Этот файл — для следующей сессии Claude. Прочитай его целиком, потом продолжай.

## Правила проекта (обязательно)

- Отвечать пользователю **по-русски, просто**, без лишних терминов.
- **Никогда не просить ключи и пароли в чат.** Ключи — только в Vercel → Settings → Environment Variables (для сайта) или в секретах окружения.
- **Не создавать Pull Request.** Работать в ветке, пушить так: `git push origin HEAD:claude/busy-franklin-g1rexn`. Коммиты кончать строками `Co-Authored-By: …` и `Claude-Session: …` (их даёт среда).
- **Живой сайт (https://ai-six-gules-52.vercel.app) сам не обновляется.** Каждый пуш на Vercel — только черновая сборка (Preview). На основной сайт её переносит пользователь: Vercel → Deployments → нужная строка → **⋯ → Promote to Production**, потом ~5 минут пересборки. После любой правки сервера (всё вне `mobile/`) напоминать об этом пользователю. Ветка по умолчанию на GitHub — `claude/beautiful-cannon-np6j2u`, не наша.
- Из облака Claude сайт `*.vercel.app` не открывается (и WebFetch тоже). Что сейчас на основном сайте — видно через открытый API GitHub: `curl -s "https://api.github.com/repos/arthurmikcom/ai/deployments?environment=Production&per_page=3"` (поля `sha`, `created_at`; статусы — `/deployments/<id>/statuses`). Ошибки сервера — только в Vercel → **Logs**: попросить у пользователя скриншот (строка запроса и блок Logs под ней).
- Перед пушем проверять сайт: `npx tsc --noEmit -p .` и `npx eslint src --quiet` в корне. При `npm install` в корне всегда добавлять `--include=dev`.
- Нельзя писать, что MARYX использует чужие нейросети (GPT, Claude и т. п.): для пользователя MARYX — «наша нейросеть».

## Что за проект

Сайт MARYX Ai: Next.js 16 (App Router), better-auth 1.7.7, drizzle (Postgres/PGlite). Корень репозитория — сайт, папка `mobile/` — приложение. Сайт уже умеет:
- гостевой режим как в ChatGPT (анонимный вход better-auth, `src/lib/server/guests.ts`), гость только чатится, остальное просит вход (`code: "login"`, статус 403);
- «Забыли пароль?» по почте (SMTP, `src/lib/server/mail.ts`);
- оплаты Paddle/PayPal/TON/Stripe, кредиты, тарифы.

## Что уже сделано для приложения

1. **Сервер принимает вход из приложения** (`src/lib/server/auth.ts`): плагин `appOrigin()` берёт заголовок `expo-origin` как Origin (то же, что серверный плагин @better-auth/expo, но без пакетов Expo на сайте), `trustedOrigins: ["maryx://", "exp://"]`. Проверено: `POST /api/auth/sign-in/anonymous` с `expo-origin: maryx://` → 200. Тесты сайта прошли.
2. Папка `mobile/` исключена из сборки сайта: `tsconfig.json` (exclude), `eslint.config.mjs` (ignore), `.vercelignore`.
3. **Expo SDK 58** (`expo ~58.0.16`, React Native 0.88, expo-router, React Compiler). Зависимости стоят (`cd mobile && npm install --include=dev`). Добавлены: better-auth 1.7.7, @better-auth/expo 1.7.7, expo-secure-store, expo-network, expo-image-picker, expo-image-manipulator, expo-media-library, expo-file-system, expo-clipboard, expo-haptics, @expo/vector-icons.
4. `mobile/app.json`: имя «MARYX Ai», scheme `maryx`, bundle id и package `com.maryx.ai`, тёмная тема, иконки и заставка из логотипа (`assets/images/`), разрешения на фото и камеру по-русски.
5. Готовый код (в `mobile/src/`):
   - `lib/config.ts`: `API_URL` (`EXPO_PUBLIC_API_URL`, по умолчанию живой сайт; пустая строка = тот же адрес, для теста веб-сборки), `siteUrl()`.
   - `lib/auth.ts`: `authClient` (better-auth + expoClient со SecureStore + anonymousClient), `sessionCookie()`.
   - `lib/api.ts`: `api()`, `streamLines()` (поток NDJSON через `expo/fetch`), `ApiError` (`status`, `code`), `uid()`.
   - `lib/types.ts`: типы ответов API (Me, ChatMessage, ChatSummary, StreamEvent, MediaItem…).
   - `lib/theme.ts`: цвета MARYX и общие стили.
   - `lib/session.tsx`: `SessionProvider`/`useSession`: `/api/me`, при 401 — гостевой вход; `signOut` возвращает в гости.
   - `lib/chats.tsx`: `ChatsProvider`/`useChats`: список чатов, открытие, отправка в `/api/chat` с ответом по словам, стоп, удаление. Модель всегда `provider: "maryx", model: "maryx"`; `image: true` — нарисовать картинку.
   - `components/Markdown.tsx`: свой рендер Markdown (заголовки, списки, код с «Копировать», таблицы, ссылки).
   - `components/ui.tsx`: BrandMark, BrandName, Button, `remoteImage()` (картинки сайта с cookie), `confirm()`, `SignInAskProvider` + `useAskToSignIn()` (окно «Нужен аккаунт» для гостей).
   - `components/Message.tsx`: сообщение (вопрос справа, ответ MARYX с Markdown, картинки, ошибка, для `code: "login"` — кнопки «Войти»/«Зарегистрироваться», подсказки, копировать).
   - `components/Composer.tsx`: поле ввода, фото из галереи и камеры (сжатие до 1600 px), «Картинка», отправить/стоп. Гостю фото и картинки — окно «Нужен аккаунт».

## Состояние (22 октября 2026)

- **Android:** `.apk` собирается GitHub Actions (`.github/workflows/android.yml`) при каждом пуше в `mobile/`, лежит по постоянной ссылке https://github.com/arthurmikcom/ai/releases/download/android/maryx-ai.apk. Пользователь его получил.
- **iPhone:** пользователь сам собрал на своём Mac (`npx eas-cli build -p ios --profile production --auto-submit`), приложение стоит у него через **TestFlight**. Приложение в App Store Connect называется «MARYX Ai», версия 1.0 в статусе «Prepare for Submission». Есть и запасной путь — кнопка на GitHub (`.github/workflows/ios-testflight.yml`, секреты описаны в `mobile/README.md`), пользователь его пока не настраивал.
- **Вход из приложения на живом сайте ломался** с ответом 500: `TypeError: Cannot read private member #state` в `appOrigin` — на Vercel запрос другого класса Request, `new Request(request, …)` падает (локально и в `next start` не воспроизводится). Исправлено в коммите `737d2f9` (заголовок ставится прямо в `request.headers`, как у @better-auth/expo; запасной путь собирает запрос из URL, метода, заголовков и тела). Проверено на локальной копии с переменными как на Vercel (`VERCEL=1`, без `BETTER_AUTH_URL`, настоящий Postgres) и настоящим кодом клиента входа из приложения. **Нужно:** пользователь должен сделать Promote to Production для `737d2f9` (или более нового коммита) и проверить вход в приложении. Если опять ошибка — попросить скриншот Vercel → Logs по запросу `sign-in`.
- В коммите `d584c1a` приложение показывает код ошибки входа («Не получилось (ошибка …)») — дойдёт до iPhone со следующей сборкой TestFlight; отдельно пересобирать ради этого не нужно.
- **App Store:** пользователь заполняет страницу версии 1.0. Тексты (английский и русский) и что ещё заполнить — в `mobile/STORE.md`. Осталось у пользователя: скриншоты (нужен размер 6,9″: 1290×2796 или 1320×2868; если его iPhone даёт другой — сделать самим из веб-сборки приложения через Playwright), выбрать сборку, App Review Information (тестовый аккаунт он вписывает сам прямо в App Store Connect, не в чат), App Privacy (Privacy Policy URL — `/privacy`), возрастной рейтинг, цена Free, переменная `LEGAL_EMAIL` в Vercel (почта для связи на страницах `/terms`, `/privacy`, `/refund`).
- Замечено в журнале Vercel: после каждой новой сборки что-то на Vercel открывает её адрес и создаёт ~4 гостей (`/api/auth/sign-in/anonymous` с адресов `ai-xxxxx-arthurmikcoms-projects.vercel.app`). Вреда нет — `purgeGuests` их убирает. В черновых сборках (Preview) не задан `BETTER_AUTH_SECRET` — поэтому там 500 у гостевого входа, на основной сайт не влияет.

## Что осталось

1. Дождаться от пользователя проверки входа в приложении после Promote (см. выше).
2. Помочь с App Store: скриншоты, анкеты, отправка на проверку; ответы на замечания Apple.
3. По желанию пользователя: голосовой ввод, видео, ассистенты в приложении; Google Play (шаги в `mobile/README.md`).
4. Настройки сайта, которые пользователь ещё не сделал (напоминать по одному, без давления): `AI_DAILY_BUDGET_USD=5`, почта SMTP (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) для «Забыли пароль?», `LEGAL_NAME`/`LEGAL_EMAIL`, секрет вебхука Stripe (или убрать ключ Stripe), сделать репозиторий приватным. Проверка всего — страница `/api/health` сайта.

## Как проверять без живого сайта

- Сайт как на Vercel: `npm run build`, Postgres — `pglite-server` из пакета `@electric-sql/pglite-socket` (поставить в отдельную папку вне репозитория, `-p 55432 -m 4`), `DATABASE_URL=postgres://postgres@127.0.0.1:55432/postgres node scripts/migrate.mjs`, затем `next start -p 3100` с `VERCEL=1 VERCEL_PROJECT_PRODUCTION_URL=ai-six-gules-52.vercel.app`, без `BETTER_AUTH_URL`. Запросы слать с `Host: ai-six-gules-52.vercel.app`, `X-Forwarded-Proto: https`, `expo-origin: maryx://`.
- Клиент входа приложения в Node: собрать esbuild'ом из `mobile/node_modules` `createAuthClient` + `expoClient` + `anonymousClient`, подменив `react-native`, `expo-constants`, `expo-linking`, `expo-secure-store`, `expo-network`, `expo-web-browser` простыми заглушками, а `fetchOptions.customFetchImpl` — на `http.request` к локальному серверу.
- Веб-сборка приложения: `EXPO_PUBLIC_API_URL= npx expo export -p web`, затем маленький Node-сервер раздаёт `dist/` и пересылает `/api/*` на `next start` (:3000), подменяя Origin на адрес сайта; Playwright 390×844. В веб-сборке `Alert` не работает — подтверждения через `confirm()` из `ui.tsx`.
- На iPhone глобальный `fetch` — это `expo/fetch` (Expo SDK 58), не fetch React Native: при `credentials: "omit"` iOS не трогает cookie, при `include` — берёт общее хранилище cookie iOS.
- Сайты docs.expo.dev, expo.dev, api.expo.dev, dl.google.com и *.apple.com из облака Claude закрыты; github.com (релизы) открыт.
