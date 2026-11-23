import { money, round2 } from './money';

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Parses YYYY-MM-DD or M/D/YYYY (also M/D/YY) to UTC midnight milliseconds. Returns null if not a real calendar date. */
export function parseDate(s: string | undefined | null): number | null {
  if (!s) return null;
  const t = s.trim();
  let y: number, mo: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(t);
  if (iso) {
    y = Number(iso[1]);
    mo = Number(iso[2]);
    d = Number(iso[3]);
  } else {
    const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(t);
    if (!us) return null;
    mo = Number(us[1]);
    d = Number(us[2]);
    y = Number(us[3]);
    if ((us[3] ?? '').length === 2) y += 2000;
  }
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return ms;
}

export function toISO(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function fmtDate(ms: number): string {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** Whole days from a to b (b minus a). */
export function daysBetween(a: number, b: number): number {
  return Math.round((b - a) / DAY);
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function calendarYearOf(closingISO: string): { start: string; end: string } | null {
  const c = parseDate(closingISO);
  if (c === null) return null;
  const y = new Date(c).getUTCFullYear();
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

export function monthOf(closingISO: string): { start: string; end: string } | null {
  const c = parseDate(closingISO);
  if (c === null) return null;
  const d = new Date(c);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  return { start: toISO(Date.UTC(y, m, 1)), end: toISO(Date.UTC(y, m + 1, 0)) };
}

export interface ProrationInput {
  amount: number;
  periodStart: string;
  periodEnd: string;
  closing: string;
  /** unpaid: the bill for the period is still to be paid, so the seller owes their share. paid: already paid, so the buyer reimburses the seller for the buyer share. */
  status: 'unpaid' | 'paid';
  closingDayOwner: 'buyer' | 'seller';
}

export interface Proration {
  ok: boolean;
  error?: string;
  note?: string;
  periodDays: number;
  sellerDays: number;
  buyerDays: number;
  dailyRate: number;
  sellerShare: number;
  buyerShare: number;
  /** Signed effect on the seller net: negative = seller owes, positive = seller is credited. */
  effect: number;
  formula: string;
}

const bad = (error: string): Proration => ({
  ok: false, error, periodDays: 0, sellerDays: 0, buyerDays: 0, dailyRate: 0, sellerShare: 0, buyerShare: 0, effect: 0, formula: error,
});

/**
 * Actual-day proration. Days in the period come from the real calendar (a leap-year period is 366 days).
 * The seller owns every day from the period start up to the day before closing; the closing day belongs to the buyer unless set otherwise.
 */
export function prorate(i: ProrationInput): Proration {
  const start = parseDate(i.periodStart);
  const end = parseDate(i.periodEnd);
  const closing = parseDate(i.closing);
  if (start === null || end === null) return bad('Enter a valid period start and end date.');
  if (closing === null) return bad('Enter a valid closing date.');
  if (end < start) return bad('Period end is before period start.');
  const periodDays = daysBetween(start, end) + 1;
  const raw = daysBetween(start, closing) + (i.closingDayOwner === 'seller' ? 1 : 0);
  const sellerDays = Math.min(periodDays, Math.max(0, raw));
  const buyerDays = periodDays - sellerDays;
  const sellerShare = round2((i.amount * sellerDays) / periodDays);
  const buyerShare = round2(i.amount - sellerShare);
  const effect = i.status === 'unpaid' ? -sellerShare : buyerShare;
  const dailyRate = i.amount / periodDays;
  let note: string | undefined;
  if (raw < 0) note = 'Closing is before the period starts, so the seller owns 0 days.';
  else if (raw > periodDays) note = 'Closing is after the period ends, so the seller owns the whole period.';
  const through = sellerDays > 0 ? `${fmtDate(start)} through ${fmtDate(start + (sellerDays - 1) * DAY)}` : 'no days';
  const calc = `${money(i.amount)} / ${periodDays} days = ${dailyRate.toFixed(4)} per day. Seller owns ${sellerDays} days (${through}): ${money(i.amount)} x ${sellerDays} / ${periodDays} = ${money(sellerShare)}.`;
  const who =
    i.status === 'unpaid'
      ? ` Not yet paid, so the seller owes ${money(sellerShare)} (a deduction).`
      : ` Already paid, so the buyer reimburses ${money(buyerShare)} for ${buyerDays} buyer days (a credit).`;
  return { ok: true, note, periodDays, sellerDays, buyerDays, dailyRate, sellerShare, buyerShare, effect, formula: calc + who };
}
