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

## Состояние (обновлено)

Сделано и проверено: все экраны (`src/app/`: чат, меню, вход/регистрация/«Забыли пароль?», изображения, профиль), `npx tsc --noEmit` и `npx expo lint` чистые, веб-сборка приложения прошла тест в браузере размером с телефон против локального сайта (гость пишет и получает ответ, «Картинка» гостю → «Нужен аккаунт», регистрация сохраняет чат, картинка создаётся, профиль, выход, «Забыли пароль?»). Android-разрешения урезаны (без микрофона, аудио, видео). Сборка `.apk` — `.github/workflows/android.yml` (GitHub Actions), облачная сборка Expo — `eas.json`, инструкция для людей — `mobile/README.md`.

## Что осталось

1. Убедиться, что запуск **Android APK** в GitHub Actions зелёный; если упал — прочитать лог и починить.
2. По желанию пользователя: голосовой ввод, видео, ассистенты в приложении; публикация в Google Play и App Store (делает пользователь своими аккаунтами, шаги в `mobile/README.md`).

Тест приложения (вне репозитория): `EXPO_PUBLIC_API_URL= npx expo export -p web`, затем маленький Node-сервер раздаёт `dist/` и пересылает `/api/*` на `next start` (:3000), подменяя Origin на адрес сайта; Playwright 390×844. В веб-сборке `Alert` не работает — подтверждения через `confirm()` из `ui.tsx`. Сайты docs.expo.dev и dl.google.com из облака Claude закрыты.
