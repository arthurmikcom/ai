import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { LegalPage } from "@/components/LegalPage";
import { hasBudgets, legalInfo, publicPrices } from "@/lib/server/legal";

export const metadata = { title: "Условия использования — MARYX Ai" };

const usd = (v: number) => `$${v.toFixed(2)}`;
const rub = (v: number) => `${new Intl.NumberFormat("ru-RU").format(v)} ₽`;
/** "3 сообщения в сутки": `forms` are for 1, 2–4 and 5+ (the last one also says "unlimited"). */
function count(v: number | null, forms: [string, string, string]): string {
  if (v === null) return `без ограничения по числу ${forms[2]}`;
  const n = Math.abs(v) % 100;
  const form = n % 10 === 1 && n !== 11 ? forms[0] : n % 10 >= 2 && n % 10 <= 4 && (n < 12 || n > 14) ? forms[1] : forms[2];
  return `${v} ${form} в сутки`;
}
const MESSAGES: [string, string, string] = ["сообщение", "сообщения", "сообщений"];
const IMAGES: [string, string, string] = ["изображение", "изображения", "изображений"];
const VIDEOS: [string, string, string] = ["видео", "видео", "видео"];

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
  const prices = publicPrices();
  const pro = [prices.proUsd !== undefined && usd(prices.proUsd), prices.proRub !== undefined && rub(prices.proRub)].filter(Boolean).join(" или ");
  return (
    <LegalPage title="Условия использования" updated="18 октября 2026" info={info}>
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
        <li>Для работы нужен аккаунт. Пользоваться платными функциями могут лица старше 18 лет.</li>
        <li>Вы отвечаете за сохранность пароля и за действия в своём аккаунте.</li>
        <li>Аккаунт можно удалить в любой момент в настройках: вместе с ним удаляются чаты, файлы и созданные материалы.</li>
      </ul>

      <h2>3. Тарифы и цены</h2>
      <ul>
        <li>
          <b>Free</b> — бесплатно: {count(prices.free.chat, MESSAGES)}, {count(prices.free.image, IMAGES)}.
        </li>
        <li>
          <b>Pro</b> — подписка на месяц{pro ? `: ${pro} в месяц` : ""}: {count(prices.pro.chat, MESSAGES)},{" "}
          {count(prices.pro.image, IMAGES)}, {count(prices.pro.video, VIDEOS)}. Точная цена всегда показана перед оплатой.
        </li>
        {prices.packs.length > 0 && (
          <li>
            <b>Кредиты</b> — разовая покупка для запросов сверх дневных лимитов:{" "}
            {prices.packs
              .map((p) => `${p.credits} кредитов — ${[p.usd > 0 && usd(p.usd), p.rub > 0 && rub(p.rub)].filter(Boolean).join(" или ")}`)
              .join("; ")}
            . Кредиты не сгорают, их нельзя обменять на деньги или передать другому аккаунту.
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
          Перед первой оплатой вы явно соглашаетесь на автопродление. Отменить его можно в любой момент в <b>Настройки → Подписка</b>: доступ к
          Pro сохраняется до конца оплаченного месяца, дальше списаний не будет.
        </li>
        <li>
          Отмена и возврат денег описаны в правилах <Link href="/refund">«Отмена и возврат»</Link>.
        </li>
        <li>Платежи принимают платёжные системы (Stripe, ЮKassa); данные карты Сервис не получает и не хранит.</li>
      </ul>

      <h2>5. Правила использования</h2>
      <p>Запрещено использовать Сервис, чтобы:</p>
      <ul>
        <li>нарушать закон, создавать или распространять незаконные материалы, в том числе материалы с участием несовершеннолетних;</li>
        <li>нарушать чужие права: авторские, на изображение, на частную жизнь; выдавать себя за других людей;</li>
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
        inaccurate and is not professional advice. Paid features are for users aged 18+. Free plan: free with daily limits. Pro: a monthly
        subscription{prices.proUsd !== undefined ? ` at ${usd(prices.proUsd)} per month` : ""} that renews automatically until cancelled; you
        can cancel any time in Settings → Subscription and keep Pro until the end of the paid month.
        {prices.packs.some((p) => p.usd > 0) &&
          ` Credits are one-time purchases (${prices.packs
            .filter((p) => p.usd > 0)
            .map((p) => `${p.credits} credits for ${usd(p.usd)}`)
            .join(", ")}) for usage beyond daily limits; they don't expire and aren't redeemable for cash.`}{" "}
        Payments are processed by Stripe; we never see or store card details. Illegal content, abuse, spam, malware and attempts to bypass
        limits are prohibited. You keep the rights to your input and may use generated content lawfully. The service is provided “as is”;
        liability is limited to the amount you paid in the last three months. See also <Link href="/refund">Cancellation &amp; refunds</Link>{" "}
        and <Link href="/privacy">Privacy</Link>.
      </p>
    </LegalPage>
  );
}
