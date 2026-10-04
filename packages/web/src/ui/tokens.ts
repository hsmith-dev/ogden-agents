/**
 * Reads a numeric token (a px length or ms duration) from tokens.css, for
 * props that take plain numbers, such as Radix's `sideOffset` or `delayDuration`.
 */
export function tokenNumber(name: string, fallback = 0): number {
  if (typeof document === 'undefined') return fallback;
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}
