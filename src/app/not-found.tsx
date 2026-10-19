import Link from "next/link";

export const metadata = { title: "Страница не найдена — MARYX Ai" };

/** Any address the site doesn't have (an unknown plugin, an old link). */
export default function NotFound() {
  return (
    <div className="grid h-full place-items-center p-8 text-center">
      <div>
        <p className="text-5xl font-semibold tracking-tight text-zinc-100">404</p>
        <p className="mt-3 text-sm text-zinc-400">Такой страницы нет — возможно, ссылка устарела.</p>
        <Link href="/" className="maryx-button mt-6 inline-flex rounded-xl px-4 py-2 text-sm">
          На главную
        </Link>
      </div>
    </div>
  );
}
