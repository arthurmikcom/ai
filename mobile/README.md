# MARYX Ai — приложение для Android и iPhone

Настоящее приложение (React Native + Expo SDK 58), не сайт в обёртке. Работает с тем же сервером и теми же аккаунтами, что и сайт.

- **Чат как в ChatGPT:** открыл — и пишешь, без регистрации (гостем). Ответ появляется по словам, с оформлением: списки, код, таблицы.
- **Вход, регистрация, «Забыли пароль?».** Чаты гостя после регистрации остаются.
- **Изображения:** картинка по описанию, своя галерея, сохранение в галерею телефона.
- **Фото в чат:** из галереи или с камеры.
- **Профиль:** тариф, кредиты, смена пароля, выход, удаление аккаунта (его требует Apple).
- **Оплаты в приложении нет:** Apple и Google разрешают продавать подписки и кредиты только через свою оплату. Тариф, купленный на сайте, в приложении работает.

## Android: скачать .apk

Приложение собирается само на серверах GitHub при каждом изменении папки `mobile/`, и свежий файл всегда лежит по одной ссылке:

**https://github.com/arthurmikcom/ai/releases/download/android/maryx-ai.apk**

1. Откройте ссылку на Android-телефоне — скачается `maryx-ai.apk`.
2. Откройте файл. Android попросит разрешить установку из этого источника — разрешите.

Тот же файл есть в GitHub → **Actions** → **Android APK** → запуск → **Artifacts**.

Запустить сборку вручную: Actions → Android APK → **Run workflow**.

Этот `.apk` подписан тестовым ключом: годится для установки и проверки. Для **Google Play** нужен свой ключ и файл `.aab` — проще всего через облачную сборку Expo (ниже).

## iPhone

Собрать приложение для iPhone можно только на Mac или в облаке Expo.

**Посмотреть бесплатно, без сборки (Expo Go):**
1. Поставьте на iPhone приложение **Expo Go** из App Store.
2. На компьютере: `cd mobile && npm install && npx expo start --tunnel`.
3. Отсканируйте QR-код камерой iPhone — приложение откроется в Expo Go.

**В TestFlight одной кнопкой на GitHub** (ничего не ставить на компьютер). Один раз добавьте в репозиторий секреты — GitHub → **Settings → Secrets and variables → Actions → New repository secret** (ключи только туда, не в чаты и не в код):

| Секрет | Где взять |
|---|---|
| `EXPO_TOKEN` | expo.dev → аватар → **Account settings → Access tokens → Create token** |
| `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` | App Store Connect → **Users and Access → Integrations → App Store Connect API → Team Keys → +** (доступ **Admin**). Скачайте файл `.p8` (его дают один раз), откройте в Блокноте и вставьте весь текст в `ASC_KEY_P8`. **Key ID** — в таблице ключей, **Issuer ID** — над таблицей |
| `APPLE_TEAM_ID` | developer.apple.com → **Account → Membership details → Team ID** |
| `ASC_APP_ID` (можно не задавать) | App Store Connect → приложение → **App Information → Apple ID** (цифры) |
| `APPLE_TEAM_TYPE` (можно не задавать) | `COMPANY_OR_ORGANIZATION`, если аккаунт разработчика на компанию; для личного — не нужен |

Потом: **Actions → iOS TestFlight → Run workflow**. GitHub попросит Expo собрать приложение (20–40 минут), Expo сам создаст сертификат и профиль по ключу Apple (без пароля и кода с телефона) и загрузит сборку в TestFlight. Дальше — шаг 6 ниже.

**В TestFlight (свой iPhone и тестировщики) и App Store со своего компьютера** — Mac не нужен, подойдёт Windows:
1. Аккаунт **Apple Developer** — $99 в год (developer.apple.com → Account → Join the Apple Developer Program). Без него Apple не пускает приложения ни в TestFlight, ни в App Store.
2. Бесплатный аккаунт **Expo** (expo.dev).
3. Поставьте **Node.js** (nodejs.org, версия LTS).
4. Скачайте проект: на GitHub → кнопка **Code → Download ZIP**, распакуйте. Откройте папку `mobile` в терминале (в Windows: правый клик по папке → «Открыть в терминале»).
5. Выполните по очереди:
   ```
   npm install
   npx eas-cli@latest login
   npx eas-cli@latest build -p ios --profile production --auto-submit
   ```
   На вопросы отвечайте «Yes»: войти в аккаунт Apple (вход идёт напрямую в Apple), создать сертификаты, создать ключ App Store Connect для отправки. Expo соберёт приложение в своём облаке (20–40 минут) и само загрузит его в TestFlight.
6. Через 10–30 минут после загрузки: App Store Connect → ваше приложение → **TestFlight** → добавьте себя в тестировщики (Internal Testing). На iPhone поставьте приложение **TestFlight** — MARYX Ai появится там.
7. Для App Store: в App Store Connect заполните описание и скриншоты и отправьте на проверку Apple (обычно 1–3 дня).

Если Expo скажет, что идентификатор `com.maryx.ai` уже занят, поменяйте `ios.bundleIdentifier` в `app.json` на свой (например `com.ваше-имя.maryx`).

**В Google Play:** аккаунт разработчика Google Play ($25 один раз), затем `npx eas-cli@latest build -p android --profile production` и `npx eas-cli@latest submit -p android`.

Пароли и ключи от Apple, Google и Expo вводите только в их собственных окнах входа — никому их не пересылайте.

## Для разработчика

- Адрес сервера: `EXPO_PUBLIC_API_URL` (по умолчанию живой сайт). Сервер принимает вход из приложения по схеме `maryx://` (и `exp://` в Expo Go) — см. `appOrigin` в `src/lib/server/auth.ts` сайта.
- Проверки: `npx tsc --noEmit`, `npx expo lint`.
- Название, иконка, пакет (`com.maryx.ai`) и разрешения — в `app.json`. Папки `android/` и `ios/` не хранятся: их создаёт `npx expo prebuild`.
- Код: экраны — `src/app/`, части экранов — `src/components/`, связь с сервером, вход, чаты — `src/lib/`.
