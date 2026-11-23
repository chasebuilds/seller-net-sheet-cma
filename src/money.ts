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
