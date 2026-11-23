import { round2 } from './money';
import { lineAmount, type Mode, type NetInputs, type NetResult } from './netsheet';

export type BuyerGroup = 'down' | 'loan' | 'prepaid' | 'escrow' | 'settlement' | 'other' | 'credit';

export const BUYER_GROUPS: { id: BuyerGroup; label: string }[] = [
  { id: 'down', label: 'Down payment' },
  { id: 'loan', label: 'Loan costs' },
  { id: 'prepaid', label: 'Prepaids' },
  { id: 'escrow', label: 'Escrow and reserves' },
  { id: 'settlement', label: 'Title and settlement (buyer side)' },
  { id: 'other', label: 'Other' },
  { id: 'credit', label: 'Credits already paid or promised (reduce cash needed)' },
];

export interface BuyerLine { id: string; group: BuyerGroup; label: string; mode: Mode; value: number; placeholder: boolean }
export interface BuyerInputs { lines: BuyerLine[] }

export interface BuyerGroupResult { group: BuyerGroup; label: string; lines: { id: string; label: string; basis: string; amount: number; placeholder: boolean }[]; subtotal: number }
export interface BuyerScenario {
  name: string;
  price: number;
  downPayment: number;
  loanAmount: number;
  groups: BuyerGroupResult[];
  /** Seller concessions from the net sheet, shown as a credit to the buyer. */
  sellerConcessions: number;
  /** Prorations seen from the buyer side: the seller's signed effect, so a tax bill the seller still owes is a credit to the buyer. */
  prorations: number;
  charges: number;
  credits: number;
  cashToClose: number;
}

const basis = (l: BuyerLine) => (l.mode === 'flat' ? 'flat amount' : l.mode === 'percent' ? `${l.value}% of price` : `$${l.value} per $1,000`);

export function computeBuyer(b: BuyerInputs, net: NetInputs, r: NetResult): BuyerScenario[] {
  return net.scenarios.map((sc, si) => {
    const groups: BuyerGroupResult[] = [];
    for (const g of BUYER_GROUPS) {
      const lines = b.lines
        .filter((l) => l.group === g.id)
        .map((l) => ({ id: l.id, label: l.label, basis: basis(l), amount: lineAmount(l, sc.price), placeholder: l.placeholder }));
      if (lines.length) groups.push({ group: g.id, label: g.label, lines, subtotal: round2(lines.reduce((t, x) => t + x.amount, 0)) });
    }
    const sub = (id: BuyerGroup) => groups.find((g) => g.group === id)?.subtotal ?? 0;
    const downPayment = sub('down');
    const sellerConcessions = r.scenarios[si]?.groups.find((g) => g.group === 'concession')?.subtotal ?? 0;
    const prorations = r.scenarios[si]?.prorationNet ?? 0;
    const charges = round2(groups.filter((g) => g.group !== 'credit').reduce((t, g) => t + g.subtotal, 0));
    const credits = round2(sub('credit') + sellerConcessions - prorations);
    return { name: sc.name, price: sc.price, downPayment, loanAmount: round2(sc.price - downPayment), groups, sellerConcessions, prorations, charges, credits, cashToClose: round2(charges - credits) };
  });
}
