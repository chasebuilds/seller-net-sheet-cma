import { prorate, type Proration } from './dates';
import { round2 } from './money';

export type Mode = 'flat' | 'percent' | 'perThousand';
export type Group = 'commission' | 'concession' | 'settlement' | 'transfer' | 'warranty' | 'repairs' | 'other';

export const GROUPS: { id: Group; label: string }[] = [
  { id: 'commission', label: 'Commissions' },
  { id: 'concession', label: 'Seller concessions' },
  { id: 'settlement', label: 'Title, escrow and settlement' },
  { id: 'transfer', label: 'Transfer or deed tax' },
  { id: 'warranty', label: 'Home warranty' },
  { id: 'repairs', label: 'Repairs' },
  { id: 'other', label: 'Other' },
];

export interface Scenario { name: string; price: number }
export interface Payoff { id: string; label: string; amount: number }
export interface CostLine { id: string; group: Group; label: string; mode: Mode; value: number; placeholder: boolean }
export interface ProrationSetup {
  id: string;
  enabled: boolean;
  label: string;
  amount: number;
  periodStart: string;
  periodEnd: string;
  status: 'unpaid' | 'paid';
}
export interface NetInputs {
  scenarios: Scenario[];
  closingDate: string;
  closingDayOwner: 'buyer' | 'seller';
  payoffs: Payoff[];
  lines: CostLine[];
  prorations: ProrationSetup[];
}

export function lineAmount(l: CostLine, price: number): number {
  if (l.mode === 'flat') return round2(l.value);
  if (l.mode === 'percent') return round2((price * l.value) / 100);
  return round2((price / 1000) * l.value);
}

export function basisText(l: CostLine): string {
  if (l.mode === 'flat') return 'flat amount';
  if (l.mode === 'percent') return `${l.value}% of price`;
  return `$${l.value} per $1,000`;
}

export interface LineResult { id: string; label: string; basis: string; amount: number; placeholder: boolean }
export interface GroupResult { group: Group; label: string; lines: LineResult[]; subtotal: number }
export interface ScenarioResult {
  name: string;
  price: number;
  payoffs: { id: string; label: string; amount: number }[];
  payoffTotal: number;
  groups: GroupResult[];
  costTotal: number;
  prorationNet: number;
  totalDeductions: number;
  net: number;
  netPct: number;
}
export interface NetResult {
  scenarios: ScenarioResult[];
  prorations: { setup: ProrationSetup; result: Proration }[];
  placeholderCount: number;
}

export function computeNet(n: NetInputs): NetResult {
  const prorations = n.prorations
    .filter((p) => p.enabled)
    .map((setup) => ({
      setup,
      result: prorate({ amount: setup.amount, periodStart: setup.periodStart, periodEnd: setup.periodEnd, closing: n.closingDate, status: setup.status, closingDayOwner: n.closingDayOwner }),
    }));
  const prorationNet = round2(prorations.reduce((s, p) => s + p.result.effect, 0));
  const payoffTotal = round2(n.payoffs.reduce((s, p) => s + p.amount, 0));
  const scenarios = n.scenarios.map((sc): ScenarioResult => {
    const groups: GroupResult[] = [];
    for (const g of GROUPS) {
      const lines = n.lines
        .filter((l) => l.group === g.id)
        .map((l) => ({ id: l.id, label: l.label, basis: basisText(l), amount: lineAmount(l, sc.price), placeholder: l.placeholder }));
      if (lines.length) groups.push({ group: g.id, label: g.label, lines, subtotal: round2(lines.reduce((s, l) => s + l.amount, 0)) });
    }
    const costTotal = round2(groups.reduce((s, g) => s + g.subtotal, 0));
    const totalDeductions = round2(payoffTotal + costTotal - prorationNet);
    const net = round2(sc.price - totalDeductions);
    return {
      name: sc.name,
      price: sc.price,
      payoffs: n.payoffs.map((p) => ({ id: p.id, label: p.label, amount: p.amount })),
      payoffTotal,
      groups,
      costTotal,
      prorationNet,
      totalDeductions,
      net,
      netPct: sc.price > 0 ? (net / sc.price) * 100 : 0,
    };
  });
  return { scenarios, prorations, placeholderCount: n.lines.filter((l) => l.placeholder).length };
}
