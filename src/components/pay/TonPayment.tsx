"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { renderSVG } from "uqr";
import { CircleCheck, Coins, Copy, ExternalLink, LoaderCircle, TriangleAlert } from "@/components/MaryxIcons";
import { api } from "@/lib/client/api";
import type { TonPaymentInfo } from "@/lib/types";
import { useApp } from "../AppState";

/** A value to copy, with its button. */
function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="ton-field">
      <span>{label}</span>
      <div>
        <code className={mono ? "font-mono" : undefined}>{value}</code>
        <button
          type="button"
          aria-label={`Копировать: ${label}`}
          title="Копировать"
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <CircleCheck className="size-4 text-emerald-300" /> : <Copy className="size-4" />}
        </button>
      </div>
    </div>
  );
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/**
 * /pay/ton?id=… — what to send where: the amount in TON, the site's wallet and
 * the code for the comment (also as a QR code and a wallet link). The page
 * keeps asking the server, which looks for the transfer on the blockchain.
 */
export function TonPayment() {
  const { refreshMe } = useApp();
  const [payment, setPayment] = useState<TonPaymentInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set once the payment has loaded (the page is prerendered without a clock).
  const [now, setNow] = useState(0);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? "";
    const valid = /^[\w-]{10,64}$/.test(id);
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = (): Promise<void> =>
      (valid
        ? api<TonPaymentInfo>(`/api/billing/ton/${id}`)
        : Promise.reject(new Error("Ссылка на оплату неполная — начните оплату заново на странице тарифов."))
      ).then(
        (p) => {
          if (!alive) return;
          setPayment(p);
          setNow(Date.now());
          setError(null);
          if (p.status === "pending") timer = setTimeout(load, 6000);
          else if (p.status === "paid") refreshMe();
        },
        (e: Error) => {
          if (!alive) return;
          setError(e.message);
          if (valid) timer = setTimeout(load, 15_000);
        },
      );
    void load();
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(tick);
    };
  }, [refreshMe]);

  const qr = useMemo(
    () => (payment ? renderSVG(payment.links.ton, { ecc: "M", border: 2, whiteColor: "#ffffff", blackColor: "#09080f" }) : ""),
    [payment],
  );

  if (!payment) {
    return (
      <div className="pay-page">
        <div className="pay-card surface-card">
          {error ? <TriangleAlert className="size-7 text-amber-300" /> : <LoaderCircle className="size-7 animate-spin text-violet-300" />}
          <h1>{error ? "Оплата не открылась" : "Готовим оплату…"}</h1>
          {error && <p role="alert">{error}</p>}
          <Link href="/pricing" className="pay-back">
            ← К тарифам
          </Link>
        </div>
      </div>
    );
  }

  const left = payment.expiresAt - now;
  return (
    <div className="pay-page">
      <div className="pay-card pay-card--wide surface-card" aria-live="polite">
        <div className="ton-head">
          <Coins className="size-6 text-sky-300" />
          <div>
            <h1>Оплата в TON</h1>
            <p>
              {payment.what} · ${payment.usd}
            </p>
          </div>
        </div>

        {payment.status === "paid" ? (
          <div className="ton-done">
            <CircleCheck className="size-10 text-emerald-300" />
            <h2>Оплата получена</h2>
            <p>Спасибо! {payment.what.includes("кредитов") ? "Кредиты зачислены." : "Тариф уже работает."}</p>
            <Link href="/" className="maryx-button pay-button">
              Перейти в чат
            </Link>
            <Link href="/settings" className="pay-back">
              Открыть настройки
            </Link>
          </div>
        ) : payment.status !== "pending" ? (
          <div className="ton-done">
            <TriangleAlert className="size-9 text-amber-300" />
            <h2>Перевод не найден</h2>
            <p>За сутки перевод с этим кодом не пришёл. Если вы отправили TON — напишите нам (адрес на странице условий), и мы проверим вручную.</p>
            <Link href="/pricing" className="maryx-button pay-button">
              Начать оплату заново
            </Link>
          </div>
        ) : (
          <>
            <div className="ton-body">
              <div className="ton-qr" role="img" aria-label="QR-код для оплаты в кошельке" dangerouslySetInnerHTML={{ __html: qr }} />
              <div className="ton-fields">
                <Field label="Сумма, TON" value={payment.ton} />
                <Field label="Адрес кошелька" value={payment.address} mono />
                <Field label="Комментарий (обязательно)" value={payment.code} mono />
              </div>
            </div>
            <p className="ton-warning">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <span>
                Укажите комментарий <b>{payment.code}</b> — по нему мы найдём ваш перевод. Без комментария платёж не засчитается автоматически.
              </span>
            </p>
            {payment.short && (
              <p className="ton-warning" role="alert">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                <span>
                  Пришло {payment.short} TON из {payment.ton}. Отправьте недостающую сумму с тем же комментарием.
                </span>
              </p>
            )}
            <div className="ton-actions">
              <a href={payment.links.ton} className="maryx-button pay-button">
                Открыть в кошельке
              </a>
              <a href={payment.links.tonkeeper} target="_blank" rel="noreferrer" className="pay-button pay-button--ghost">
                Tonkeeper <ExternalLink className="size-3.5" />
              </a>
            </div>
            <p className="ton-status">
              <LoaderCircle className="size-4 animate-spin" />
              Ждём перевод — проверяем блокчейн каждые несколько секунд. Обычно это занимает до минуты.
            </p>
            <p className="ton-note">
              {left > 0
                ? `Курс держим ещё ${clock(left)}. Сумма рассчитана по текущему курсу TON.`
                : "Время на оплату по этому курсу вышло. Если вы уже отправили перевод, он засчитается; если нет — начните оплату заново."}{" "}
              Переводы в TON нельзя отменить — проверьте адрес и сумму.
            </p>
          </>
        )}
        <Link href="/pricing" className="pay-back">
          ← К тарифам
        </Link>
      </div>
    </div>
  );
}
