import { connection } from "next/server";
import { Suspense } from "react";
import { LegalPage } from "@/components/LegalPage";
import { legalInfo } from "@/lib/server/legal";

export const metadata = { title: "Отмена и возврат — MARYX Ai" };

// Read when the page is opened, so the owner's details and prices follow the current settings.
export default function RefundPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const info = legalInfo();
  const write = info.email ? (
    <>
      на <a href={`mailto:${info.email}`}>{info.email}</a>
    </>
  ) : (
    "нам по контактам внизу страницы"
  );
  return (
    <LegalPage title="Отмена и возврат" updated="20 октября 2026" info={info}>
      <h2>Отмена подписки</h2>
      <ul>
        <li>
          Отменить подписку (Plus, Pro или Ultra) можно в любой момент: <b>Настройки → Подписка</b> → «Отменить автопродление» (для оплаты через Stripe
          или Paddle — «Управлять подпиской»).
        </li>
        <li>После отмены новых списаний не будет, а тариф остаётся до конца уже оплаченного месяца.</li>
        <li>Месяц, оплаченный разово через PayPal или в TON, ничего не продлевает: отменять нечего, тариф просто действует до конца месяца.</li>
      </ul>

      <h2>Возврат денег</h2>
      <ul>
        <li>
          <b>Подписка.</b> Если вы передумали, напишите нам в течение 14 дней после оплаты: мы вернём деньги за этот месяц полностью,
          если за него вы почти не пользовались платным тарифом (не больше дневного лимита бесплатного тарифа в сумме), иначе — за оставшиеся дни.
        </li>
        <li>
          <b>Кредиты.</b> Неиспользованные кредиты из пакета можно вернуть в течение 14 дней после покупки; потраченные кредиты не
          возвращаются.
        </li>
        <li>
          <b>Сбои.</b> Если с вас дважды списали оплату или оплаченная функция не заработала по нашей вине, мы вернём деньги в любом случае.
        </li>
        <li>Деньги возвращаются тем же способом, которым была оплата, обычно за 5–10 рабочих дней (зависит от банка).</li>
        <li>
          Оплата через Paddle возвращается через Paddle.com — продавца по таким заказам. Оплата в TON возвращается в TON на кошелёк, с которого
          пришёл перевод: сумма в долларах по курсу TON на день возврата.
        </li>
        <li>При возврате неиспользованные кредиты списываются с баланса, а у подписки отключается автопродление.</li>
      </ul>
      <p>Чтобы попросить возврат, напишите {write} с почты вашего аккаунта и укажите дату платежа.</p>

      <h2>Cancellation &amp; refunds (English)</h2>
      <p>
        You can cancel your subscription (Plus, Pro or Ultra) at any time in Settings → Subscription (“Manage subscription” for Stripe and Paddle payments). A month paid once through PayPal or TON doesn’t renew, so there is nothing to cancel. After
        cancelling you won’t be charged again and keep the plan until the end of the paid month. Within 14 days of a payment you can ask for a
        refund: a full refund if you barely used the paid plan that month, otherwise a pro-rated one. Unused credits can be refunded within 14 days of
        purchase. Double charges and features that failed on our side are always refunded. Refunds go back to the original payment method,
        usually within 5–10 business days; orders made through Paddle are refunded by Paddle.com as the Merchant of Record, and TON payments are refunded in TON to the sending wallet (the dollar amount at the day’s TON rate). Refunded credits are removed from the balance and a refunded subscription stops renewing. To request one, email {info.email ?? "us (see contacts below)"} from your account’s email address.
      </p>
    </LegalPage>
  );
}
