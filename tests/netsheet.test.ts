import { describe, expect, it } from 'vitest';
import { computeNet, lineAmount, type NetInputs } from '../src/netsheet';
import { sampleState } from '../src/state';

const net: NetInputs = {
  scenarios: [
    { name: 'List', price: 400000 },
    { name: 'Likely', price: 390000 },
    { name: 'Low', price: 380000 },
  ],
  closingDate: '2027-07-11',
  closingDayOwner: 'buyer',
  payoffs: [{ id: 'p', label: 'Mortgage', amount: 250000 }],
  lines: [
    { id: 'a', group: 'commission', label: 'Listing', mode: 'percent', value: 3, placeholder: false },
    { id: 'b', group: 'commission', label: 'Buyer', mode: 'percent', value: 2, placeholder: false },
    { id: 'c', group: 'concession', label: 'Concession', mode: 'flat', value: 5000, placeholder: false },
    { id: 'd', group: 'settlement', label: 'Title', mode: 'flat', value: 1200, placeholder: false },
    { id: 'e', group: 'settlement', label: 'Escrow', mode: 'flat', value: 800, placeholder: false },
    { id: 'f', group: 'transfer', label: 'Transfer', mode: 'perThousand', value: 2, placeholder: false },
    { id: 'g', group: 'warranty', label: 'Warranty', mode: 'flat', value: 500, placeholder: false },
    { id: 'h', group: 'repairs', label: 'Repairs', mode: 'flat', value: 2500, placeholder: true },
  ],
  prorations: [
    { id: 'x', enabled: true, label: 'Tax', amount: 3650, periodStart: '2027-01-01', periodEnd: '2027-12-31', status: 'unpaid' },
    { id: 'y', enabled: true, label: 'HOA', amount: 200, periodStart: '2027-07-01', periodEnd: '2027-07-31', status: 'paid' },
  ],
};

describe('net sheet, hand-checked', () => {
  const r = computeNet(net);
  it('line amounts', () => {
    expect(lineAmount(net.lines[0]!, 400000)).toBe(12000);
    expect(lineAmount(net.lines[5]!, 380000)).toBe(760);
    expect(lineAmount(net.lines[2]!, 1)).toBe(5000);
  });
  it('prorations: tax owed 191 days x $10 = $1,910, HOA credit $135.48, net effect -$1,774.52', () => {
    expect(r.prorations[0]!.result.effect).toBe(-1910);
    expect(r.prorations[1]!.result.effect).toBe(135.48);
    expect(r.scenarios[0]!.prorationNet).toBe(-1774.52);
  });
  it('list price: costs $30,800, net $117,425.48', () => {
    const s = r.scenarios[0]!;
    expect(s.costTotal).toBe(30800);
    expect(s.payoffTotal).toBe(250000);
    expect(s.totalDeductions).toBe(282574.52);
    expect(s.net).toBe(117425.48);
    expect(s.netPct).toBeCloseTo(29.356, 3);
  });
  it('low price: percent lines shrink, flat lines do not, net $98,465.48', () => {
    const s = r.scenarios[2]!;
    expect(s.costTotal).toBe(29760);
    expect(s.net).toBe(98465.48);
  });
  it('middle price: $390,000 costs $30,280 (11,700 + 7,800 + 5,000 + 2,000 + 780 + 500 + 2,500), net $107,945.48', () => {
    const s = r.scenarios[1]!;
    expect(s.costTotal).toBe(30280);
    expect(s.net).toBe(107945.48);
  });
  it('every group subtotal adds back to the cost total and every line is listed', () => {
    const s = r.scenarios[0]!;
    expect(s.groups.reduce((t, g) => t + g.subtotal, 0)).toBe(s.costTotal);
    expect(s.groups.flatMap((g) => g.lines)).toHaveLength(net.lines.length);
    expect(r.placeholderCount).toBe(1);
  });
  it('a disabled proration is left out and the closing day owner changes the result', () => {
    const off = computeNet({ ...net, prorations: net.prorations.map((p) => ({ ...p, enabled: false })) });
    expect(off.scenarios[0]!.net).toBe(119200);
    const seller = computeNet({ ...net, closingDayOwner: 'seller' });
    expect(seller.prorations[0]!.result.sellerDays).toBe(192);
  });
  it('the invented sample, likely sale $374,000, by hand', () => {
    // Percent lines at 374,000: 2.4% = 8,976.00; 2.2% = 8,228.00; transfer $1.10 per $1,000 = 411.40
    // Flat lines: 3,000 + 1,150 + 650 + 125 + 575 + 1,800 + 0 = 7,300
    // Costs = 8,976 + 8,228 + 411.40 + 7,300 = 24,915.40
    // Prorations: tax unpaid 73 days x $9 = -657.00, HOA paid, 14 of 31 days seller = 54.19, buyer credit 65.81, total -591.19
    // Net = 374,000 - 260,710.55 (payoffs) - 24,915.40 - 591.19 = 87,782.86
    const s = computeNet(sampleState().net).scenarios[1]!;
    expect(s.costTotal).toBe(24915.4);
    expect(s.prorationNet).toBe(-591.19);
    expect(s.net).toBe(87782.86);
  });
});
