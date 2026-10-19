// Limits the browser checks first and the server checks again.

/** The biggest video the site takes, in MB (NEXT_PUBLIC_MAX_VIDEO_MB, 2 GB by default). */
export const MAX_VIDEO_MB = (() => {
  const value = Number.parseInt(process.env.NEXT_PUBLIC_MAX_VIDEO_MB ?? "", 10);
  return Number.isFinite(value) && value > 0 ? value : 2048;
})();

/** "2 ГБ", "1,5 ГБ", "500 МБ". */
export function sizeText(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0).replace(".", ",")} ГБ` : `${Math.round(mb)} МБ`;
}
