import { getShare } from "@/lib/server/shares";

type Context = { params: Promise<{ id: string }> };

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const MARK =
  '<svg viewBox="0 0 32 32" width="18" height="18" fill="none" stroke="#f3eeff"><path d="M16 3 28 16 16 29 4 16 16 3Z" stroke-width="1.6"/>' +
  '<path d="m16 8 7 8-7 8-7-8 7-8Z" stroke-width="1.6"/><path d="M16 3v26M4 16h24" stroke-width="1.2"/></svg>';

const STYLE = `html,body{margin:0;height:100%;background:#09090b;color:#f4f4f5;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
body{display:flex;flex-direction:column}
header{display:flex;align-items:center;gap:10px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.1)}
.mark{flex-shrink:0;width:28px;height:28px;border-radius:8px;display:grid;place-items:center;background:radial-gradient(circle at 30% 22%,#8b72ff,#4a23b8 45%,#1d0c4d)}
.title{min-width:0;font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.by{flex-shrink:0;font-size:12px;color:#71717a}
.cta{margin-left:auto;flex-shrink:0;padding:7px 12px;border-radius:12px;background:linear-gradient(135deg,#8b5cf6,#6d28d9);color:#fff;font-size:12px;font-weight:600;text-decoration:none}
iframe{flex:1;min-height:0;width:100%;border:0;background:#fff}
footer{padding:6px 16px;text-align:center;font-size:11px;color:#71717a}
main{flex:1;display:grid;place-items:center;text-align:center;padding:24px}
@media (max-width:520px){.by{display:none}}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${escape(title)} — MARYX Ai</title><style>${STYLE}</style></head><body>
<header><span class="mark">${MARK}</span><span class="title">${escape(title)}</span><span class="by">· сделано в MARYX Ai</span><a class="cta" href="/login">Создать своё</a></header>
${body}</body></html>`;
}

/**
 * A page someone made in the chat and shared: open to anyone with the link.
 * It runs in an isolated frame (scripts only: no access to this site, no
 * windows, navigation or forms) under a bar that says where it's from.
 */
export async function GET(_request: Request, { params }: Context) {
  const share = await getShare((await params).id);
  const headers = { "Content-Type": "text/html; charset=utf-8", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
  if (!share) {
    return new Response(page("Страница не найдена", "<main><p>Такой страницы нет — возможно, ссылка неполная.</p></main>"), {
      status: 404,
      headers,
    });
  }
  return new Response(
    page(
      share.title,
      `<iframe title="${escape(share.title)}" sandbox="allow-scripts allow-modals allow-pointer-lock" referrerpolicy="no-referrer" srcdoc="${escape(share.html)}"></iframe>
<footer>Эту страницу создал пользователь с помощью ИИ. Не вводите здесь пароли и личные данные.</footer>`,
    ),
    { headers: { ...headers, "Cache-Control": "public, max-age=300" } },
  );
}
