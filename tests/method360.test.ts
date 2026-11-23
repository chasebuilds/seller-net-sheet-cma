import { describe, expect, it } from 'vitest';
import { buyerCase } from './buyer-fixture';
import { computeBuyer } from '../src/buyer';
import { computeNet } from '../src/netsheet';
import { days360, parseDate, prorate, type ProrationInput } from '../src/dates';

const base: ProrationInput = { amount: 3600, periodStart: '2027-01-01', periodEnd: '2027-12-31', closing: '2027-07-01', status: 'unpaid', closingDayOwner: 'buyer', method: '360' };
const d = (s: string) => parseDate(s)!;

describe('days360 (30E/360: a 31st counts as the 30th)', () => {
  it('counts months as 30 days', () => {
    expect(days360(d('2027-01-01'), d('2027-07-01'))).toBe(180);
    expect(days360(d('2027-01-01'), d('2028-01-01'))).toBe(360);
    expect(days360(d('2027-01-31'), d('2027-03-01'))).toBe(31);
    expect(days360(d('2027-03-01'), d('2027-03-31'))).toBe(29);
    expect(days360(d('2027-02-01'), d('2027-03-01'))).toBe(30);
  });
});

describe('prorate with the 360-day method, hand-checked', () => {
  it('$3,600 a year, closing Jul 1: 180 of 360 days = $1,800 (actual days would give 181 of 365)', () => {
    const p = prorate(base);
    expect(p.method).toBe('360');
    expect(p.periodDays).toBe(360);
    expect(p.sellerDays).toBe(180);
    expect(p.dailyRate).toBe(10);
    expect(p.sellerShare).toBe(1800);
    expect(p.effect).toBe(-1800);
    expect(prorate({ ...base, method: 'actual' }).sellerDays).toBe(181);
  });
  it('closing Mar 15: 2 months x 30 + 14 = 74 days = $740.00', () => {
    const p = prorate({ ...base, closing: '2027-03-15' });
    expect(p.sellerDays).toBe(74);
    expect(p.sellerShare).toBe(740);
  });
  it('closing Dec 31 counts as Dec 30: 359 days = $3,590.00', () => {
    const p = prorate({ ...base, closing: '2027-12-31' });
    expect(p.sellerDays).toBe(359);
    expect(p.sellerShare).toBe(3590);
  });
  it('leap year makes no difference: the same $3,600 and Jul 1 closing in 2028 is still 180 days', () => {
    const p = prorate({ ...base, periodStart: '2028-01-01', periodEnd: '2028-12-31', closing: '2028-07-01' });
    expect(p.periodDays).toBe(360);
    expect(p.sellerDays).toBe(180);
  });
  it('monthly HOA: any February is 30 days. $300, closing Feb 15 = 14 days = $140.00, paid so buyer credit $160.00', () => {
    for (const y of ['2027', '2028']) {
      const feb = { ...base, amount: 300, periodStart: `${y}-02-01`, periodEnd: y === '2028' ? '2028-02-29' : '2027-02-28', closing: `${y}-02-15`, status: 'paid' as const };
      const p = prorate(feb);
      expect(p.periodDays).toBe(30);
      expect(p.sellerDays).toBe(14);
      expect(p.sellerShare).toBe(140);
      expect(p.effect).toBe(160);
    }
  });
  it('a 31-day month still has 30 days: $200, closing Jul 11 = 10 days = $66.67, buyer share $133.33', () => {
    const p = prorate({ ...base, amount: 200, periodStart: '2027-07-01', periodEnd: '2027-07-31', closing: '2027-07-11', status: 'paid' });
    expect(p.periodDays).toBe(30);
    expect(p.sellerShare).toBe(66.67);
    expect(p.buyerShare).toBe(133.33);
  });
  it('fiscal year Jul 1 2027 to Jun 30 2028, $7,200, closing Oct 1 = 90 of 360 days = $1,800', () => {
    const p = prorate({ ...base, amount: 7200, periodStart: '2027-07-01', periodEnd: '2028-06-30', closing: '2027-10-01' });
    expect(p.periodDays).toBe(360);
    expect(p.sellerDays).toBe(90);
    expect(p.sellerShare).toBe(1800);
  });
  it('closing day owned by the seller adds one day: 181 days = $1,810', () => {
    expect(prorate({ ...base, closingDayOwner: 'seller' }).sellerShare).toBe(1810);
  });
  it('shows the method in the formula', () => {
    expect(prorate(base).formula).toContain('30/360');
    expect(prorate({ ...base, method: 'actual' }).formula).not.toContain('30/360');
  });
  it('net sheet follows the method switch: $3,600 tax, Jul 1 closing, unpaid', () => {
    const n = buyerCase();
    const act = computeNet({ ...n.net, closingDate: '2027-07-01', prorationMethod: 'actual', prorations: [{ id: 'x', enabled: true, label: 'Tax', amount: 3650, periodStart: '2027-01-01', periodEnd: '2027-12-31', status: 'unpaid' }] });
    const b360 = computeNet({ ...n.net, closingDate: '2027-07-01', prorationMethod: '360', prorations: [{ id: 'x', enabled: true, label: 'Tax', amount: 3600, periodStart: '2027-01-01', periodEnd: '2027-12-31', status: 'unpaid' }] });
    expect(act.scenarios[0]!.prorationNet).toBe(-1810);
    expect(b360.scenarios[0]!.prorationNet).toBe(-1800);
  });
});

describe('buyer estimated cash to close, hand-checked', () => {
  const n = buyerCase();
  const r = computeNet(n.net);
  const b = computeBuyer(n.buyer, n.net, r);
  it('$400,000: down 10% = 40,000, cash to close 35,525.48', () => {
    // charges: down 40,000 + origination 0.5% 2,000 + appraisal 600 + prepaids 1,200 + reserves 2,400 + title 1,100 = 47,300
    // seller side: tax owed 1,910.00 (the buyer is credited), HOA reimbursed 135.48 (the buyer pays), seller proration effect -1,774.52
    // credits: earnest money 5,000 + seller concession 5,000 + 1,774.52 net proration credit = 11,774.52
    // cash to close = 47,300 - 11,774.52 = 35,525.48
    expect(b[0]!.downPayment).toBe(40000);
    expect(b[0]!.loanAmount).toBe(360000);
    expect(b[0]!.charges).toBe(47300);
    expect(b[0]!.credits).toBe(11774.52);
    expect(b[0]!.cashToClose).toBe(35525.48);
  });
  it('$380,000: down 38,000, origination 1,900, others 5,300, cash to close 33,425.48', () => {
    // charges 38,000 + 1,900 + 5,300 = 45,200; credits 11,774.52; 45,200 - 11,774.52 = 33,425.48
    expect(b[2]!.downPayment).toBe(38000);
    expect(b[2]!.loanAmount).toBe(342000);
    expect(b[2]!.cashToClose).toBe(33425.48);
  });
});

describe('half a cent rounds up (found by the benchmark: float math gave one cent less)', () => {
  it('$30,684.85 over a 30-day month, closing Dec 10 under 360-day = 9 days, 30,684.85 x 9 / 30 = 9,205.455, so $9,205.46', () => {
    const p = prorate({ amount: 30684.85, periodStart: '2028-12-01', periodEnd: '2028-12-31', closing: '2028-12-10', status: 'unpaid', closingDayOwner: 'buyer', method: '360' });
    expect(p.sellerDays).toBe(9);
    expect(p.sellerShare).toBe(9205.46);
  });
  it('line amounts: flat $1.005 is $1.01, $1.005 per $1,000 on $1,000 is $1.01, 0.0125% of $40,000 is $5.00 exactly', async () => {
    const { lineAmount } = await import('../src/netsheet');
    expect(lineAmount({ mode: 'flat', value: 1.005 }, 0)).toBe(1.01);
    expect(lineAmount({ mode: 'perThousand', value: 1.005 }, 1000)).toBe(1.01);
    expect(lineAmount({ mode: 'percent', value: 0.0125 }, 40000)).toBe(5);
    expect(lineAmount({ mode: 'percent', value: 2.4 }, 374000)).toBe(8976);
  });
});
