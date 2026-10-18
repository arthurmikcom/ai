import { connection } from "next/server";
import { Suspense } from "react";
import { LegalPage } from "@/components/LegalPage";
import { legalInfo } from "@/lib/server/legal";

export const metadata = { title: "Конфиденциальность — MARYX Ai" };

// Read when the page is opened, so the owner's details and prices follow the current settings.
export default function PrivacyPage() {
  return (
    <Suspense>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await connection();
  const info = legalInfo();
  return (
    <LegalPage title="Политика конфиденциальности" updated="18 октября 2026" info={info}>
      <p>Здесь описано, какие данные собирает MARYX Ai, зачем и как ими управлять. Оператор данных — {info.name}.</p>

      <h2>Какие данные мы храним</h2>
      <ul>
        <li>Аккаунт: имя, электронная почта, пароль в зашифрованном виде (или данные входа через Google или VK).</li>
        <li>Чаты, загруженные файлы, созданные изображения и видео, ассистенты, личные инструкции и то, что MARYX запомнил о вас.</li>
        <li>Тариф, история платежей и расход лимитов. Данные карт принимают и хранят платёжные системы (Stripe, ЮKassa), не мы.</li>
        <li>Технические данные: IP-адрес и сведения о браузере — для защиты от злоупотреблений и для статистики скорости сайта.</li>
      </ul>

      <h2>Зачем</h2>
      <ul>
        <li>Чтобы Сервис работал: отвечал на ваши запросы, хранил историю и настройки.</li>
        <li>Чтобы принимать оплату и учитывать лимиты.</li>
        <li>Чтобы защищать Сервис и пользователей от мошенничества и злоупотреблений.</li>
      </ul>
      <p>Мы не продаём ваши данные и не показываем рекламу.</p>

      <h2>Кому передаются данные</h2>
      <ul>
        <li>
          Поставщикам ИИ-моделей — содержимое запроса, чтобы сформировать ответ. Вместо вашей почты передаётся обезличенный идентификатор.
        </li>
        <li>Хостингу и хранилищу файлов, на которых работает Сервис.</li>
        <li>Платёжным системам — для проведения оплаты.</li>
        <li>Государственным органам — только когда этого требует закон.</li>
      </ul>

      <h2>Cookies</h2>
      <p>Сервис использует только необходимые cookies: для входа в аккаунт. Рекламных и сторонних отслеживающих cookies нет.</p>

      <h2>Сроки хранения и ваши права</h2>
      <ul>
        <li>Данные хранятся, пока существует аккаунт. Отдельные чаты, файлы и факты из памяти MARYX можно удалить в любой момент.</li>
        <li>
          Удаление аккаунта в <b>Настройках</b> удаляет его данные. Записи о платежах и сведения о расходах без привязки к вам могут
          храниться дольше, если этого требуют закон и учёт.
        </li>
        <li>Вы можете запросить копию своих данных или их исправление, написав нам.</li>
      </ul>

      <h2>Privacy (English)</h2>
      <p>
        {info.name} stores your account (name, email, hashed password), your chats, files, generated media, assistants and preferences,
        your plan and payment history (card details are handled by Stripe/ЮKassa, never by us) and technical data (IP, browser) for security
        and performance statistics. Data is used only to provide the service, take payments and prevent abuse; it is never sold and there are
        no ads. Request content is sent to AI model providers to generate answers, with a pseudonymous id instead of your email. Only
        essential sign-in cookies are used. Data is kept while your account exists; deleting the account in Settings deletes it. Contact us to
        get a copy of your data or correct it.
      </p>
    </LegalPage>
  );
}
