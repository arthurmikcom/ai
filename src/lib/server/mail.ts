import { createTransport } from "nodemailer";

// Letters the site sends (for now, the link to reset a password) go out through
// any mail service's SMTP: SMTP_HOST, SMTP_PORT (465 by default; 587 is STARTTLS),
// SMTP_USER, SMTP_PASS, and MAIL_FROM — the sender (SMTP_USER by default).

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function mailConfigured(): boolean {
  return Boolean(env("SMTP_HOST") && env("SMTP_USER") && env("SMTP_PASS"));
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendMail(letter: { to: string; subject: string; text: string; html: string }): Promise<void> {
  const port = Number.parseInt(env("SMTP_PORT") ?? "", 10) || 465;
  const user = env("SMTP_USER")!;
  const transport = createTransport({
    host: env("SMTP_HOST"),
    port,
    secure: port === 465,
    // On 587 the password is only sent once the connection is encrypted.
    requireTLS: port === 587,
    auth: { user, pass: env("SMTP_PASS") },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  await transport.sendMail({ from: env("MAIL_FROM") ?? `MARYX Ai <${user}>`, ...letter });
}

/** The letter with the link to set a new password (valid for an hour). */
export async function sendPasswordReset(to: string, name: string, url: string): Promise<void> {
  const hello = name && name !== "Гость" ? `Здравствуйте, ${name}!` : "Здравствуйте!";
  const text = [
    hello,
    "",
    "Вы попросили сбросить пароль в MARYX Ai. Чтобы задать новый, откройте ссылку:",
    url,
    "",
    "Ссылка действует 1 час. Если вы не просили сброс — просто не обращайте внимания на это письмо: пароль останется прежним.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f1d2b;max-width:480px">
<p>${escapeHtml(hello)}</p>
<p>Вы попросили сбросить пароль в MARYX Ai. Чтобы задать новый, нажмите кнопку:</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 22px;border-radius:10px;background:#7c5cff;color:#ffffff;text-decoration:none;font-weight:bold">Задать новый пароль</a></p>
<p style="font-size:13px;color:#6b6880">Или откройте ссылку: <a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
<p style="font-size:13px;color:#6b6880">Ссылка действует 1 час. Если вы не просили сброс — просто не обращайте внимания на это письмо: пароль останется прежним.</p>
</div>`;
  await sendMail({ to, subject: "Сброс пароля MARYX Ai", text, html });
}
