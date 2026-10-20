"use client";

import { ArrowUpRight, Clapperboard, Image as ImageIcon, LockKeyhole, Paperclip, Sparkles } from "@/components/MaryxIcons";
import Link from "next/link";
import { usePathname } from "next/navigation";

// A guest chats without an account, like on ChatGPT; everything else asks to sign in or up.

/** The login page, back to `next` afterwards; `signup` opens the registration form. */
export function loginHref(mode: "signin" | "signup", next?: string): string {
  const query = new URLSearchParams();
  if (mode === "signup") query.set("mode", "signup");
  if (next && next !== "/" && next.startsWith("/") && !next.startsWith("//")) query.set("next", next);
  const q = query.toString();
  return q ? `/login?${q}` : "/login";
}

/** «Войти» and «Зарегистрироваться бесплатно» (the top bar, a refused answer). */
export function GuestButtons({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  return (
    <div className={`guest-buttons ${className}`}>
      <Link href={loginHref("signin", pathname)} className="guest-login">
        Войти
      </Link>
      <Link href={loginHref("signup", pathname)} className="guest-signup">
        Зарегистрироваться<span>&nbsp;бесплатно</span>
      </Link>
    </div>
  );
}

/** The sidebar's card in place of the profile: what an account adds. */
export function GuestCard() {
  const pathname = usePathname();
  return (
    <div className="guest-card mx-5 mb-5 shrink-0 rounded-2xl border border-violet-300/15 p-4">
      <p className="text-[13px] font-medium text-zinc-100">Сохраняйте чаты и пользуйтесь всем</p>
      <p className="mt-1.5 text-[11px] leading-5 text-zinc-400">Картинки, видео, фото и файлы — после бесплатной регистрации. Чаты отсюда останутся с вами.</p>
      <Link href={loginHref("signup", pathname)} className="maryx-button mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2 text-center text-xs">
        Зарегистрироваться
      </Link>
      <Link href={loginHref("signin", pathname)} className="mt-2 flex w-full items-center justify-center rounded-xl border border-white/10 py-2 text-xs text-zinc-200 hover:border-violet-300/30">
        Войти
      </Link>
    </div>
  );
}

/** A section a guest can't use: what it is, and the way in. */
export function GuestGate({ title }: { title: string }) {
  const pathname = usePathname();
  return (
    <div className="guest-gate">
      <div className="guest-gate-card surface-card">
        <span className="guest-gate-icon">
          <LockKeyhole className="size-5" />
        </span>
        <h1>{title} — после входа</h1>
        <p>Зарегистрируйтесь — это бесплатно и займёт минуту. Чаты, которые вы уже начали, останутся с вами.</p>
        <ul>
          <li><ImageIcon className="size-4" /> Картинки и обработка фото</li>
          <li><Clapperboard className="size-4" /> Видео по тексту и фото</li>
          <li><Paperclip className="size-4" /> Файлы и документы в чате</li>
          <li><Sparkles className="size-4" /> Больше сообщений каждый день</li>
        </ul>
        <Link href={loginHref("signup", pathname)} className="maryx-button guest-gate-main">
          Зарегистрироваться бесплатно <ArrowUpRight className="size-4" />
        </Link>
        <Link href={loginHref("signin", pathname)} className="guest-gate-second">
          У меня есть аккаунт — войти
        </Link>
        <Link href="/" className="guest-gate-back">
          ← Вернуться в чат
        </Link>
      </div>
    </div>
  );
}
