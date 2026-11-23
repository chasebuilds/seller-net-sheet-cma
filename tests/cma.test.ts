import { describe, expect, it } from 'vitest';
import sample from '../samples/comps-sample.csv?raw';
import { adjustComp, computeCma, median, quantile, type AdjRates, type CompRow, type Subject } from '../src/cma';
import { parseComps } from '../src/csv';
import { sampleState, toRows } from '../src/state';

const subject: Subject = { address: 'Subject', sqft: 2000, beds: 3, baths: 2, yearBuilt: 2000, notes: '' };
const rates: AdjRates = { perSqft: 50, perBed: 0, perBath: 0, perYear: 0, monthlyTrendPct: 0, asOf: '2026-11-14', placeholder: [] };
const mk = (sold: number, sqft: number, list = sold, extra: Partial<CompRow> = {}): CompRow => ({
  address: 'x', status: 'sold', soldPrice: sold, listPrice: list, sqft, include: true, otherAdj: 0, otherNote: '', ...extra,
});

describe('statistics', () => {
  it('median and quartiles', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(quantile([305, 310, 315, 320], 0.25)).toBe(308.75);
    expect(quantile([305, 310, 315, 320], 0.75)).toBe(316.25);
    expect(median([])).toBeUndefined();
  });
});

describe('adjustments, hand-checked', () => {
  it('size: subject 2,000 sf vs comp 1,900 sf at $50 = +$5,000', () => {
    const a = adjustComp(mk(300000, 1900), subject, rates);
    expect(a.total).toBe(5000);
    expect(a.lines[0]?.label).toContain('100 sf');
  });
  it('other adjustment is added with its note', () => {
    const a = adjustComp(mk(300000, 2000, 300000, { otherAdj: -2500, otherNote: 'pool' }), subject, rates);
    expect(a.total).toBe(-2500);
    expect(a.lines[0]?.label).toBe('Other: pool');
  });
  it('time: $300,000 sale 92 days before as-of at 0.5% a month = $4,533.88', () => {
    const a = adjustComp(mk(300000, 2000, 300000, { saleDate: '2026-08-14' }), subject, { ...rates, monthlyTrendPct: 0.5 });
    expect(a.total).toBeCloseTo(4533.88, 1);
  });
  it('beds, baths and age use subject minus comp', () => {
    const r2 = { ...rates, perBed: 4000, perBath: 5000, perYear: 300 };
    const a = adjustComp(mk(300000, 2000, 300000, { beds: 2, baths: 1.5, yearBuilt: 1990 }), subject, r2);
    expect(a.total).toBe(4000 + 2500 + 3000);
  });
});

describe('price range, hand-checked', () => {
  it('3 sold comps: adjusted 305,000 / 310,000 / 315,000 gives low-to-high with median 310,000', () => {
    const r = computeCma([mk(300000, 1900), mk(320000, 2100), mk(310000, 2000)], subject, rates);
    expect(r.range).toMatchObject({ low: 305000, mid: 310000, high: 315000, n: 3 });
    expect(r.warnings).toEqual([]);
  });
  it('4 sold comps: quartiles 308,750 / 312,500 / 316,250', () => {
    const r = computeCma([mk(300000, 1900), mk(320000, 2100), mk(310000, 2000), mk(330000, 2200)], subject, rates);
    expect(r.range).toMatchObject({ low: 308750, mid: 312500, high: 316250, n: 4 });
  });
  it('unticked comps and non-sold rows stay out of the range', () => {
    const rows = [mk(300000, 1900), mk(320000, 2100), mk(310000, 2000), mk(900000, 2000, 900000, { include: false }), mk(0, 2000, 999999, { status: 'active', soldPrice: undefined })];
    expect(computeCma(rows, subject, rates).range).toMatchObject({ low: 305000, high: 315000, n: 3 });
  });
  it('warns on thin evidence and gives no range with no comps', () => {
    expect(computeCma([mk(300000, 2000)], subject, rates).warnings[0]).toMatch(/Only 1/);
    const none = computeCma([], subject, rates);
    expect(none.range).toBeUndefined();
    expect(none.warnings[0]).toMatch(/No sold comps/);
  });
  it('list-to-sale ratio: 300,000 on 310,000 and 320,000 on 320,000', () => {
    const r = computeCma([mk(300000, 2000, 310000), mk(320000, 2000, 320000)], subject, rates);
    expect(r.ltsrMedian).toBeCloseTo(0.98387, 4);
    expect(r.ltsrMin).toBeCloseTo(0.96774, 4);
    expect(r.ltsrMax).toBe(1);
  });
});

describe('invented sample', () => {
  const comps = toRows(parseComps(sample).comps);
  const r = computeCma(comps, sampleState().subject, sampleState().cma.rates);
  it('counts and days on market are the hand values', () => {
    expect(r.stats.map((s) => s.count)).toEqual([7, 2, 3, 2]);
    // sold DOM sorted: 28, 36, 36, 42, 43, 60, 105 (sum 350)
    expect(r.soldDomMedian).toBe(42);
    expect(r.soldDomMean).toBeCloseTo(350 / 7, 6);
    expect(r.stats[0]?.medianDom).toBe(42);
  });
  it('130 Mock Willow Dr sold at list, 77 Sample Orchard Ln at 96.1% of list', () => {
    expect(r.rows[4]?.listToSale).toBe(1);
    expect(r.rows[5]?.listToSale).toBeCloseTo(384000 / 399500, 8);
    expect(r.ltsrCount).toBe(7);
  });
  it('gives a range with all 7 sold comps', () => {
    expect(r.range?.n).toBe(7);
    expect(r.range!.low).toBeLessThan(r.range!.mid);
    expect(r.range!.mid).toBeLessThan(r.range!.high);
  });
});
