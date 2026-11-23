import { describe, expect, it } from 'vitest';
import { calendarYearOf, daysBetween, isLeapYear, monthOf, parseDate, prorate, type ProrationInput } from '../src/dates';

const base: ProrationInput = { amount: 3650, periodStart: '2027-01-01', periodEnd: '2027-12-31', closing: '2027-07-01', status: 'unpaid', closingDayOwner: 'buyer' };

describe('parseDate', () => {
  it('reads ISO and US dates and rejects impossible ones', () => {
    expect(parseDate('2028-02-29')).not.toBeNull();
    expect(parseDate('2027-02-29')).toBeNull();
    expect(parseDate('3/1/2026')).toBe(parseDate('2026-03-01'));
    expect(parseDate('3/1/26')).toBe(parseDate('2026-03-01'));
    expect(parseDate('13/1/2026')).toBeNull();
    expect(parseDate('soon')).toBeNull();
  });
  it('counts days across a leap February', () => {
    expect(daysBetween(parseDate('2028-02-28')!, parseDate('2028-03-01')!)).toBe(2);
    expect(daysBetween(parseDate('2027-02-28')!, parseDate('2027-03-01')!)).toBe(1);
    expect(isLeapYear(2028) && !isLeapYear(2027) && !isLeapYear(2100) && isLeapYear(2000)).toBe(true);
  });
  it('builds default periods from the closing date', () => {
    expect(calendarYearOf('2028-05-05')).toEqual({ start: '2028-01-01', end: '2028-12-31' });
    expect(monthOf('2028-02-15')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});

describe('prorate, hand-checked', () => {
  it('non-leap year, close Jul 1: 181 seller days at $10.00 = $1,810 owed when unpaid', () => {
    const p = prorate(base);
    expect(p.periodDays).toBe(365);
    expect(p.sellerDays).toBe(181);
    expect(p.sellerShare).toBe(1810);
    expect(p.effect).toBe(-1810);
  });
  it('same bill already paid: buyer reimburses 184 days = $1,840 credit', () => {
    const p = prorate({ ...base, status: 'paid' });
    expect(p.buyerShare).toBe(1840);
    expect(p.effect).toBe(1840);
  });
  it('leap year has 366 days: $3,660 is $10.00 a day, closing Mar 1 2028 = 60 seller days = $600', () => {
    const p = prorate({ ...base, amount: 3660, periodStart: '2028-01-01', periodEnd: '2028-12-31', closing: '2028-03-01' });
    expect(p.periodDays).toBe(366);
    expect(p.sellerDays).toBe(60);
    expect(p.sellerShare).toBe(600);
  });
  it('non-leap year, closing Mar 1 2027 = 59 seller days = $590', () => {
    const p = prorate({ ...base, closing: '2027-03-01' });
    expect(p.sellerDays).toBe(59);
    expect(p.sellerShare).toBe(590);
  });
  it('closing on the first and last day of the period', () => {
    expect(prorate({ ...base, closing: '2027-01-01' }).sellerDays).toBe(0);
    expect(prorate({ ...base, closing: '2027-12-31' }).sellerDays).toBe(364);
    expect(prorate({ ...base, closing: '2027-12-31', closingDayOwner: 'seller' }).sellerShare).toBe(3650);
  });
  it('closing day owned by the seller adds one day', () => {
    const p = prorate({ ...base, closingDayOwner: 'seller' });
    expect(p.sellerDays).toBe(182);
    expect(p.sellerShare).toBe(1820);
  });
  it('fiscal-year tax spanning a leap day: Jul 1 2027 to Jun 30 2028 is 366 days, $7,320 = $20/day, closing Oct 1 = 92 days = $1,840', () => {
    const fiscal = { ...base, amount: 7320, periodStart: '2027-07-01', periodEnd: '2028-06-30', closing: '2027-10-01' };
    const p = prorate(fiscal);
    expect(p.periodDays).toBe(366);
    expect(p.sellerDays).toBe(92);
    expect(p.sellerShare).toBe(1840);
    expect(prorate({ ...fiscal, status: 'paid' }).effect).toBe(5480);
  });
  it('monthly HOA: Feb 2028 has 29 days, $290 is $10/day, closing Feb 15 = 14 seller days = $140; Feb 2027 $280 gives the same $140', () => {
    const leap = prorate({ ...base, amount: 290, periodStart: '2028-02-01', periodEnd: '2028-02-29', closing: '2028-02-15', status: 'paid' });
    expect(leap.periodDays).toBe(29);
    expect(leap.sellerShare).toBe(140);
    expect(leap.effect).toBe(150);
    const flat = prorate({ ...base, amount: 280, periodStart: '2027-02-01', periodEnd: '2027-02-28', closing: '2027-02-15', status: 'paid' });
    expect(flat.periodDays).toBe(28);
    expect(flat.sellerShare).toBe(140);
  });
  it('rounds to cents: $200 over 31 days, 10 seller days = $64.52, buyer share $135.48', () => {
    const p = prorate({ ...base, amount: 200, periodStart: '2027-07-01', periodEnd: '2027-07-31', closing: '2027-07-11', status: 'paid' });
    expect(p.sellerShare).toBe(64.52);
    expect(p.buyerShare).toBe(135.48);
  });
  it('shows the day count and formula', () => {
    expect(prorate(base).formula).toContain('$3,650.00 / 365 days = 10.0000 per day');
    expect(prorate(base).formula).toContain('181 days');
  });
  it('flags closing outside the period and bad input', () => {
    const early = prorate({ ...base, closing: '2026-06-01' });
    expect(early.sellerDays).toBe(0);
    expect(early.note).toMatch(/before the period/);
    expect(prorate({ ...base, closing: '2028-06-01' }).sellerDays).toBe(365);
    expect(prorate({ ...base, periodEnd: '2026-12-31' }).ok).toBe(false);
    expect(prorate({ ...base, closing: '' }).ok).toBe(false);
  });
});
