/** Public origin of the site, for payment return URLs. */
export function siteOrigin(request: Request): string {
  return process.env.BETTER_AUTH_URL?.replace(/\/+$/, "") || new URL(request.url).origin;
}
