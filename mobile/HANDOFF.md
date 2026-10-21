# Передача работы: приложение MARYX Ai для Android и iPhone

Этот файл — для следующей сессии Claude. Прочитай его целиком, потом продолжай.

## Правила проекта (обязательно)

- Отвечать пользователю **по-русски, просто**, без лишних терминов.
- **Никогда не просить ключи и пароли в чат.** Ключи — только в Vercel → Settings → Environment Variables (для сайта) или в секретах окружения.
- **Не создавать Pull Request.** Работать в ветке, пушить так: `git push origin HEAD:claude/busy-franklin-g1rexn` (с неё собирается живой сайт ai-six-gules-52.vercel.app).
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

## Что осталось сделать

1. **Экраны (expo-router, `mobile/src/app/`).** Сейчас `_layout.tsx` и `index.tsx` — ещё шаблон Expo, они ссылаются на удалённые файлы. Их надо переписать:
   - `_layout.tsx`: Stack без заголовков, тёмная тема, StatusBar light, провайдеры `SessionProvider` → `ChatsProvider` → `SignInAskProvider`, скрыть заставку после загрузки сессии (`expo-splash-screen`); экраны `menu`, `login` — как модальные (`presentation: "modal"`).
   - `index.tsx` — чат: шапка (☰ меню, логотип MARYX, справа «Войти» для гостя или «новый чат»), пустой экран «Чем помочь?» с 3–4 подсказками, список сообщений (ScrollView, прокрутка вниз), `Composer` снизу в KeyboardAvoidingView, SafeArea. Если `error` у сессии — экран «Нет связи» с «Повторить».
   - `menu.tsx`: «Новый чат», «Изображения» (гостю — окно «Нужен аккаунт»), список чатов (нажать — открыть; долгое нажатие — удалить через `confirm`), внизу профиль (имя, тариф) или карточка «Войти / Зарегистрироваться» для гостя.
   - `login.tsx`: режимы `signin`/`signup`/`forgot` (параметр `mode`), тексты как на сайте (`src/components/LoginView.tsx`), «Забыли пароль?» → `authClient.requestPasswordReset({ email, redirectTo: "/reset-password" })`, после входа — `session.reload()` и назад. Гостевые чаты переносятся сервером сами.
   - `images.tsx`: описание + «Создать» → `POST /api/generate` `{ kind: "image", provider: "maryx", model: "maryx-image", prompt, aspectRatio: "1:1" }` → MediaItem; если `pending` — опрашивать `GET /api/media/:id`; галерея `GET /api/media?kind=image`; открыть картинку на весь экран, «Сохранить в галерею» (`File.downloadFileAsync(url, Paths.cache, { headers: { cookie } })` + `MediaLibrary.Asset.create(file.uri)` после `requestPermissionsAsync(true)`).
   - `profile.tsx`: имя, почта, тариф (`PLAN_NAMES`), кредиты, сообщений сегодня; «Сменить пароль» (`authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true })`); «Выйти»; **«Удалить аккаунт»** (`authClient.deleteUser({ password })`) — без этого Apple не пропустит; ссылки «Условия» и «Конфиденциальность» (`siteUrl("/terms")`, `/privacy`) через expo-web-browser.
   - **Оплаты в приложении не делать** (Apple/Google требуют свою оплату). Тариф, купленный на сайте, работает. Кнопок «Купить» и ссылок на оплату в приложении не должно быть.
2. Проверки: `cd mobile && npx tsc --noEmit && npx expo lint`. В `app.json` `typedRoutes: true`; если типы маршрутов мешают tsc — выключить.
3. **Тест**: веб-сборка `cd mobile && EXPO_PUBLIC_API_URL= npx expo export -p web` (папка `dist/`), маленький сервер на Node: статика `dist/` + прокси `/api/*` на локальный сайт (`next start` на :3000) — тогда всё на одном адресе и cookie работают. Playwright (Chromium в `/opt/pw-browsers`, `PLAYWRIGHT_BROWSERS_PATH` уже задан) с размером экрана телефона: гость пишет и получает ответ, «Картинка»/фото гостю → «Нужен аккаунт», регистрация → чаты остались, профиль, выход. Для ИИ на тестах нужна заглушка OpenRouter (`OPENROUTER_BASE_URL` на локальный мок). Заметка: в веб-сборке `Alert` ничего не делает, поэтому подтверждения — через `confirm()` из `ui.tsx`.
4. **Сборка Android (.apk)** — через GitHub Actions: в облаке Claude закрыт `dl.google.com`, поэтому Android SDK скачать нельзя, а на машинах GitHub он уже есть. Workflow `.github/workflows/android.yml`: Node 22, Java 17, `cd mobile && npm ci && npx expo prebuild -p android --no-install && cd android && ./gradlew assembleRelease`, файл `.apk` выложить как artifact (или в Release). Подпись — debug-ключ для теста; для Google Play нужен свой ключ (в секретах GitHub) и `.aab` (`bundleRelease`). Если пуш файла workflow отклонят из-за прав — сказать пользователю, как добавить его через GitHub.
5. **iPhone**: здесь собрать нельзя (нужен Mac или облачная сборка Expo). Подготовить `mobile/eas.json` (профили development/preview/production) и инструкцию в `mobile/README.md`: проверить бесплатно через Expo Go; для App Store — аккаунт Apple Developer ($99/год) и аккаунт Expo, `npx eas-cli build -p ios`, `npx eas-cli submit -p ios`. Для Google Play — аккаунт разработчика ($25 один раз), `npx eas-cli build -p android`.
6. Сайт docs.expo.dev из облака Claude тоже закрыт — сверяться с `.d.ts` в `mobile/node_modules` (так уже сделано: `expo/fetch`, `File.downloadFileAsync`, `MediaLibrary.Asset.create`, `ImageManipulator.manipulate(...).renderAsync()`).
7. В конце: коммит (с трейлерами из инструкций сессии), пуш в `claude/busy-franklin-g1rexn`, отчёт пользователю по-русски: что умеет приложение, где скачать `.apk`, что нужно для iPhone и магазинов.
