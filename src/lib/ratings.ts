// 👍/👎 on MARYX's answers: what a 👎 can say was wrong (the browser offers
// these, the server keeps the id, the admin sees them counted).

export const RATING_REASONS = [
  { id: "wrong", label: "Неверно или выдумано" },
  { id: "off_topic", label: "Не о том" },
  { id: "too_long", label: "Слишком длинно" },
  { id: "too_short", label: "Слишком коротко" },
  { id: "format", label: "Неудобно оформлено" },
  { id: "other", label: "Другое" },
] as const;

export type RatingReason = (typeof RATING_REASONS)[number]["id"];

export function isRatingReason(v: unknown): v is RatingReason {
  return typeof v === "string" && RATING_REASONS.some((r) => r.id === v);
}
