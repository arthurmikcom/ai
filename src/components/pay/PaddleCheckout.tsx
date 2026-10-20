"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CreditCard, LoaderCircle, TriangleAlert } from "@/components/MaryxIcons";
import { api } from "@/lib/client/api";

/** The part of Paddle.js (v2) this page uses. */
interface PaddleJs {
  Environment: { set(environment: "sandbox"): void };
  Initialize(options: {
    token: string;
    pwCustomer?: { id: string };
    eventCallback?: (event: { name?: string }) => void;
  }): void;
  Checkout: {
    open(options: {
      transactionId: string;
      settings?: { displayMode?: "overlay"; theme?: "dark" | "light"; locale?: string; successUrl?: string };
    }): void;
  };
}

declare global {
  interface Window {
    Paddle?: PaddleJs;
  }
}

interface Config {
  token: string;
  sandbox: boolean;
  script: string;
  /** The user's Paddle customer id, for Paddle Retain. */
  customer: string | null;
}

/** Paddle.Initialize may run once per page. */
let initialized = false;

/**
 * /pay/paddle?txn=… — opens Paddle's checkout for a transaction our server
 * made. Paid: back to the settings, which confirm the payment.
 */
export function PaddleCheckout() {
  const [state, setState] = useState<"loading" | "open" | "closed" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const reopen = useRef<() => void>(() => {});
  const router = useRouter();
  // Paddle calls back from outside React: the router as of the latest render.
  const navigate = useRef(router);
  useEffect(() => {
    navigate.current = router;
  }, [router]);

  useEffect(() => {
    const txn = new URLSearchParams(window.location.search).get("txn") ?? "";
    let alive = true;
    const back = `/settings?billing=paddle&txn=${encodeURIComponent(txn)}`;
    const done = `${window.location.origin}${back}`;
    const open = () => {
      window.Paddle?.Checkout.open({
        transactionId: txn,
        settings: {
          displayMode: "overlay",
          theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
          locale: "ru",
          successUrl: done,
        },
      });
      setState("open");
    };
    reopen.current = open;
    const start = (config: Config) => {
      const paddle = window.Paddle;
      if (!alive || !paddle) return;
      if (!initialized) {
        initialized = true;
        if (config.sandbox) paddle.Environment.set("sandbox");
        paddle.Initialize({
          token: config.token,
          // Paddle Retain recognizes the customer by their Paddle id (never our own id or email).
          ...(config.customer ? { pwCustomer: { id: config.customer } } : {}),
          eventCallback: (event) => {
            if (event.name === "checkout.completed") navigate.current.push(back);
            else if (event.name === "checkout.closed") setState((s) => (s === "open" ? "closed" : s));
          },
        });
      }
      open();
    };
    (/^txn_\w{10,60}$/.test(txn)
      ? api<Config>("/api/billing/paddle/config")
      : Promise.reject(new Error("Ссылка на оплату неполная — начните оплату заново на странице тарифов."))
    ).then(
      (config) => {
        if (window.Paddle) return start(config);
        const script = document.createElement("script");
        script.src = config.script;
        script.async = true;
        script.onload = () => start(config);
        script.onerror = () => {
          if (!alive) return;
          setError("Не удалось загрузить оплату Paddle. Проверьте интернет или отключите блокировщик рекламы и попробуйте ещё раз.");
          setState("error");
        };
        document.head.appendChild(script);
      },
      (e: Error) => {
        if (!alive) return;
        setError(e.message);
        setState("error");
      },
    );
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="pay-page">
      <div className="pay-card surface-card">
        {state === "error" ? (
          <>
            <TriangleAlert className="size-7 text-amber-300" />
            <h1>Оплата не открылась</h1>
            <p role="alert">{error}</p>
          </>
        ) : state === "closed" ? (
          <>
            <CreditCard className="size-7 text-violet-300" />
            <h1>Оплата закрыта</h1>
            <p>Деньги не списаны. Можно открыть оплату ещё раз или вернуться к тарифам.</p>
            <button type="button" className="maryx-button pay-button" onClick={() => reopen.current()}>
              Открыть оплату
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="size-7 animate-spin text-violet-300" />
            <h1>Открываем оплату…</h1>
            <p>Платёж принимает Paddle — наш партнёр по приёму платежей. Данные карты сайт не получает.</p>
          </>
        )}
        <Link href="/pricing" className="pay-back">
          ← К тарифам
        </Link>
      </div>
    </div>
  );
}
