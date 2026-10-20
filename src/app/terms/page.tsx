import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LegalPage } from "@/components/LegalPage";
import { hasBudgets, legalInfo, providersText, publicPrices } from "@/lib/server/legal";

export const metadata = { title: "Условия использования — MARYX Ai" };

const money = (amount: number, currency: string) =>
  currency === "RUB" ? `${new Intl.NumberFormat("ru-RU").format(amount)} ₽` : currency === "USD" ? `$${amount.toFixed(2)}` : `${amount.toFixed(2)} ${currency}`;

/** The right form of a Russian noun for `n`: `forms` are for 1, 2–4 and 5+. */
function plural(n: number, forms: [string, string, string]): string {
  const m = Math.abs(n) % 100;
  return m % 10 === 1 && m !== 11 ? forms[0] : m % 10 >= 2 && m % 10 <= 4 && (m < 12 || m > 14) ? forms[1] : forms[2];
}
/** "3 сообщения в сутки", or "без ограничения по числу сообщений". */
const perDay = (v: number | null, forms: [string, string, string]) =>
  v === null ? `без ограничения по числу ${forms[2]}` : `${v} ${plural(v, forms)} в сутки`;
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
const IMAGES: [string, string, string] = ["изображение", "изображения", "изображений"];
const VIDEOS: [string, string, string] = ["видео", "видео", "видео"];
const CREDITS: [string, string, string] = ["кредит", "кредита", "кредитов"];

// Read when the page is opened, so the owner's details and prices follow the current settings.
export default function TermsPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const info = legalInfo();
  const prices = await publicPrices();
  const price = (p: (typeof prices.plans)[number]) =>
    [p.price && money(p.price.amount, p.price.currency), p.rub !== undefined && money(p.rub, "RUB")].filter(Boolean).join(" или ");
  const englishPlans = prices.plans.filter((p) => p.price);
  const once = prices.oneOff.length ? prices.oneOff.join(" или ") : null;
  const packPrice = (p: { usd: number; rub: number }) => [p.usd > 0 && money(p.usd, "USD"), p.rub > 0 && money(p.rub, "RUB")].filter(Boolean).join(" или ");
  const englishPacks = prices.packs.filter((p) => p.usd > 0);
  return (
    <LegalPage title="Условия использования" updated="20 октября 2026" info={info}>
      <p>
        Эти условия регулируют использование сервиса MARYX Ai (далее — «Сервис»), который предоставляет {info.name}. Регистрируясь или
        оплачивая Сервис, вы соглашаетесь с ними.
      </p>

      <h2>1. Что такое Сервис</h2>
      <p>
        MARYX Ai — сервис с искусственным интеллектом: ответы на вопросы, работа с текстами и документами, создание изображений и видео.
        Ответы и материалы создаёт ИИ: они могут быть неточными или неполными, поэтому важные сведения нужно проверять. Сервис не заменяет
        консультацию врача, юриста, финансового или другого специалиста.
      </p>

      <h2>2. Аккаунт</h2>
      <ul>
        <li>Для работы нужен аккаунт. Пользоваться платными функциями могут лица, достигшие 18 лет.</li>
        <li>Вы отвечаете за сохранность пароля и за действия в своём аккаунте.</li>
        <li>Аккаунт можно удалить в любой момент в настройках: вместе с ним удаляются чаты, файлы и созданные материалы.</li>
      </ul>

      <h2>3. Тарифы и цены</h2>
      <ul>
        <li>
          <b>Free</b> — бесплатно: {perDay(prices.free.chat, MESSAGES)}, {perDay(prices.free.image, IMAGES)}.
        </li>
        {prices.plans.map((p) => (
          <li key={p.id}>
            <b>{p.name}</b> — подписка с ежемесячным продлением{price(p) ? ` (${price(p)} в месяц)` : ""}: {perDay(p.chat, MESSAGES)},{" "}
            {perDay(p.image, IMAGES)}, {perDay(p.video, VIDEOS)}. Точная цена всегда показана перед оплатой.
          </li>
        ))}
        <li>
          Тариф можно сменить в любой момент: при переходе на другой платный тариф разница за оставшиеся дни пересчитывается в следующем
          счёте.
        </li>
        {once && (
          <li>
            Месяц тарифа можно также оплатить разово через {once}{" "}
            {prices.plans.some((p) => p.once) &&
              `(${prices.plans
                .filter((p) => p.once)
                .map((p) => `${p.name} — ${money(p.once!, "USD")}`)
                .join(", ")})`}
            , без автопродления. Следующий месяц оплачивается так же; при переходе на другой тариф оставшиеся дни пересчитываются по его цене.
          </li>
        )}
        {prices.packs.length > 0 && (
          <li>
            <b>Кредиты</b> — разовая покупка для запросов сверх дневных лимитов:{" "}
            {prices.packs.map((p) => `${p.credits} ${plural(p.credits, CREDITS)} — ${packPrice(p)}`).join("; ")}. Кредиты не сгорают, их нельзя
            передать другому аккаунту или обменять на деньги, кроме возврата по правилам <Link href="/refund">«Отмена и возврат»</Link>.
          </li>
        )}
      </ul>
      {hasBudgets() && (
        <p>
          Помимо числа запросов у каждого тарифа есть дневной объём использования ИИ: сложные задачи, «Думать глубже» и большие файлы
          расходуют его быстрее. Сверх него можно продолжать за кредиты.
        </p>
      )}

      <h2>4. Подписка и автопродление</h2>
      <ul>
        <li>Подписка Pro продлевается автоматически каждый месяц, и её стоимость списывается с выбранной карты, пока вы её не отмените.</li>
        <li>
          Перед первой оплатой вы явно соглашаетесь на автопродление. Отменить его можно в любой момент в разделе <b>Настройки → Подписка</b>:
          доступ к Pro сохраняется до конца оплаченного месяца, дальше списаний не будет.
        </li>
        <li>
          Отмена и возврат денег описаны в правилах <Link href="/refund">«Отмена и возврат»</Link>.
        </li>
        <li>
          Платежи принимает {providersText(prices.providers, "платёжная система")}; данные карты Сервис не получает и не хранит.
        </li>
        {prices.paddle && (
          <li>
            При оплате через Paddle заказ оформляет наш онлайн-реселлер Paddle.com: он выступает продавцом (Merchant of Record), рассчитывает
            налоги и принимает запросы на возврат по своим правилам и нашим правилам «Отмена и возврат».
          </li>
        )}
        {prices.ton && (
          <li>
            Оплата в криптовалюте TON — разовый перевод на кошелёк Сервиса с кодом в комментарии. Сумма в TON рассчитывается по курсу к
            доллару США в момент оплаты и держится 30 минут. Переводы в блокчейне необратимы: проверяйте адрес, сумму и комментарий.
          </li>
        )}
      </ul>

      <h2>5. Правила использования</h2>
      <p>Запрещено использовать Сервис, чтобы:</p>
      <ul>
        <li>нарушать закон, создавать или распространять незаконные материалы, в том числе материалы с участием несовершеннолетних;</li>
        <li>нарушать чужие права: авторские, на изображение, на частную жизнь; выдавать себя за других людей;</li>
        <li>обрабатывать фото других людей без их согласия или создавать с ними откровенные, унижающие или вводящие в заблуждение изображения;</li>
        <li>рассылать спам, мошенничать, создавать вредоносные программы;</li>
        <li>обходить лимиты и меры защиты Сервиса, перепродавать доступ, автоматически выгружать данные.</li>
      </ul>
      <p>При нарушении правил доступ к Сервису может быть ограничен или аккаунт заблокирован.</p>

      <h2>6. Ваши материалы</h2>
      <p>
        Права на ваши запросы и файлы остаются за вами. Созданные Сервисом тексты, изображения и видео вы можете использовать в любых
        законных целях, в том числе коммерческих, если это не нарушает права третьих лиц. Вы отвечаете за то, что загружаете и как
        используете результат.
      </p>

      <h2>7. Ответственность</h2>
      <p>
        Сервис предоставляется «как есть». Мы стараемся, чтобы он работал без перерывов, но не гарантируем этого и не отвечаем за решения,
        принятые на основе ответов ИИ. Ответственность Сервиса в любом случае ограничена суммой, которую вы заплатили за последние три
        месяца.
      </p>

      <h2>8. Изменения</h2>
      <p>
        Условия и цены могут меняться. О существенных изменениях мы сообщаем заранее; новая цена подписки применяется только со следующего
        периода. Продолжая пользоваться Сервисом, вы соглашаетесь с новой редакцией.
      </p>

      <h2>Terms of Service (summary in English)</h2>
      <p>
        MARYX Ai is an AI assistant service (text answers, documents, image and video generation) provided by {info.name}. AI output may be
        inaccurate and is not professional advice. Paid features are for users aged 18+. Free plan: free with daily limits. Plus, Pro and Ultra:
        monthly subscriptions
        {englishPlans.length ? ` (${englishPlans.map((p) => `${p.name} ${money(p.price!.amount, p.price!.currency)}`).join(", ")} per month)` : ""} that
        renew automatically until cancelled; you can switch plans (the difference is prorated) or cancel any time in Settings → Subscription
        and keep the plan until the end of the paid month.
        {englishPacks.length > 0 &&
          ` Credits are one-time purchases (${englishPacks.map((p) => `${p.credits} credits for ${money(p.usd, "USD")}`).join(", ")}) for usage beyond daily limits; they don't expire and aren't redeemable for cash except as described in Cancellation & refunds.`}{" "}
        {once && ` A month of a plan can also be paid once through ${prices.oneOff.join(" or ")}, without automatic renewal.`}{" "}
        {prices.providers.length > 0 && `Payments are processed by ${prices.providers.join(", ")}; we never see or store card details. `}
        {prices.paddle && "Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders made through Paddle, and handles returns and tax for them. "}
        {prices.ton && "TON (cryptocurrency) payments are one-time transfers to our wallet at the TON/USD rate at the time of payment; blockchain transfers are irreversible. "}
        Illegal content, abuse, spam, malware and attempts to bypass limits are prohibited. You keep the rights to your input and may use
        generated content lawfully. The service is provided “as is”; liability is limited to the amount you paid in the last three months.
        See also <Link href="/refund">Cancellation &amp; refunds</Link> and <Link href="/privacy">Privacy</Link>.
      </p>
    </LegalPage>
  );
}
