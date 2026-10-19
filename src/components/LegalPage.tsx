import Link from "next/link";
import type { ReactNode } from "react";
import type { LegalInfo } from "@/lib/server/legal";
import { BrandMark, BrandName } from "./Design";

const PAGES = [
  { href: "/terms", label: "Условия использования" },
  { href: "/refund", label: "Отмена и возврат" },
  { href: "/privacy", label: "Конфиденциальность" },
];

/** A public page with the service's terms: readable without signing in (payment providers check them). */
export function LegalPage({ title, updated, info, children }: { title: string; updated: string; info: LegalInfo; children: ReactNode }) {
  return (
    <div className="legal-page h-dvh overflow-y-auto bg-zinc-950 text-zinc-300">
      <div className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-3 text-lg text-zinc-100">
            <BrandMark /><BrandName />
          </Link>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {PAGES.map((p) => (
              <Link key={p.href} href={p.href} className="text-zinc-400 hover:text-violet-200">
                {p.label}
              </Link>
            ))}
          </nav>
        </div>
        <h1 className="text-[28px] font-medium tracking-[-0.03em] text-zinc-100">{title}</h1>
        <p className="mt-2 text-xs text-zinc-500">Редакция от {updated}</p>
        <div className="legal-text mt-8 space-y-4 text-sm leading-7 [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-medium [&_h2]:text-zinc-100 [&_li]:ml-5 [&_li]:list-disc [&_a]:text-violet-300">
          {children}
        </div>
        <Contacts info={info} />
      </div>
    </div>
  );
}

/** Who runs the service and how to reach them. */
export function Contacts({ info }: { info: LegalInfo }) {
  return (
    <section className="mt-10 rounded-2xl border border-white/5 bg-white/[0.02] p-5 text-sm leading-7">
      <h2 className="mb-2 font-medium text-zinc-100">Контакты / Contact</h2>
      <p>{info.name}</p>
      {info.address && <p>{info.address}</p>}
      {info.email && (
        <p>
          <a href={`mailto:${info.email}`} className="text-violet-300 hover:text-violet-200">
            {info.email}
          </a>
        </p>
      )}
    </section>
  );
}

/** Links to the legal pages, for page footers. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav className={`flex flex-wrap justify-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 ${className}`}>
      {PAGES.map((p) => (
        <Link key={p.href} href={p.href} className="hover:text-zinc-300">
          {p.label}
        </Link>
      ))}
    </nav>
  );
}
