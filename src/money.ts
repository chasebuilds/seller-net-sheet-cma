export function round2(x: number): number {
  return Math.round((x + Number.EPSILON) * 100) / 100;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

export function money(x: number): string {
  return x < 0 ? `-${usd.format(-x)}` : usd.format(x);
}

export function money0(x: number): string {
  return x < 0 ? `-${usd0.format(-x)}` : usd0.format(x);
}

export function pct(x: number, digits = 1): string {
  return `${x.toFixed(digits)}%`;
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Integer division rounded half away from zero, so a half cent always rounds up in size. Inputs must be integers. */
export function divRound(num: number, den: number): number {
  const sign = num < 0 ? -1 : 1;
  return (sign * Math.floor((2 * Math.abs(num) + den) / (2 * den)));
}

/** Dollars to whole cents. */
export const toCents = (dollars: number): number => Math.round(dollars * 100);
