import type { ParsedComp, Status } from './csv';
import { daysBetween, parseDate } from './dates';
import { round2 } from './money';

export interface CompRow extends ParsedComp {
  /** Use this sold comp in the price range. Ignored for active, pending and expired rows. */
  include: boolean;
  otherAdj: number;
  otherNote: string;
}

export interface Subject {
  address: string;
  sqft: number;
  beds: number;
  baths: number;
  yearBuilt: number;
  lat?: number;
  lng?: number;
  notes: string;
}

export type RateKey = 'perSqft' | 'perBed' | 'perBath' | 'perYear' | 'monthlyTrendPct';

export interface AdjRates {
  perSqft: number;
  perBed: number;
  perBath: number;
  perYear: number;
  monthlyTrendPct: number;
  asOf: string;
  /** Rates the agent has not touched yet. Shown as placeholders until edited. */
  placeholder: RateKey[];
}

export const STATUSES: Status[] = ['sold', 'pending', 'active', 'expired'];

export function median(xs: number[]): number | undefined {
  return quantile(xs, 0.5);
}

export function mean(xs: number[]): number | undefined {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

/** Linear interpolation between order statistics (the common "type 7" quantile). */
export function quantile(xs: number[], q: number): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return (s[lo] ?? 0) + ((s[hi] ?? 0) - (s[lo] ?? 0)) * (pos - lo);
}

export function basisPrice(c: ParsedComp): number {
  return c.status === 'sold' ? (c.soldPrice ?? 0) : (c.listPrice ?? 0);
}

export interface AdjLine { label: string; amount: number }
export interface CompResult {
  index: number;
  comp: CompRow;
  price: number;
  ppsf: number;
  lines: AdjLine[];
  adjTotal: number;
  adjusted: number;
  adjPpsf: number;
  usedInValue: boolean;
  listToSale?: number;
}

export function adjustComp(c: CompRow, s: Subject, r: AdjRates): { lines: AdjLine[]; total: number } {
  const lines: AdjLine[] = [];
  const price = basisPrice(c);
  const add = (label: string, amount: number) => {
    const a = round2(amount);
    if (a !== 0) lines.push({ label, amount: a });
  };
  const sale = parseDate(c.saleDate);
  const asOf = parseDate(r.asOf);
  if (c.status === 'sold' && sale !== null && asOf !== null && r.monthlyTrendPct !== 0) {
    const months = daysBetween(sale, asOf) / 30.4375;
    add(`Time (${months.toFixed(1)} mo at ${r.monthlyTrendPct}%/mo)`, (price * r.monthlyTrendPct * months) / 100);
  }
  add(`Size (${s.sqft - c.sqft} sf)`, (s.sqft - c.sqft) * r.perSqft);
  if (c.beds !== undefined) add(`Bedrooms (${s.beds - c.beds})`, (s.beds - c.beds) * r.perBed);
  if (c.baths !== undefined) add(`Bathrooms (${s.baths - c.baths})`, (s.baths - c.baths) * r.perBath);
  if (c.yearBuilt !== undefined) add(`Age (${s.yearBuilt - c.yearBuilt} yr)`, (s.yearBuilt - c.yearBuilt) * r.perYear);
  add(c.otherNote.trim() ? `Other: ${c.otherNote.trim()}` : 'Other', c.otherAdj);
  return { lines, total: round2(lines.reduce((t, l) => t + l.amount, 0)) };
}

export interface StatusStat {
  status: Status;
  count: number;
  medianPrice?: number;
  medianPpsf?: number;
  medianDom?: number;
}

export interface Range {
  low: number;
  mid: number;
  high: number;
  n: number;
  method: string;
}

export interface CmaResult {
  rows: CompResult[];
  stats: StatusStat[];
  soldDomMedian?: number;
  soldDomMean?: number;
  ltsrMedian?: number;
  ltsrMean?: number;
  ltsrMin?: number;
  ltsrMax?: number;
  ltsrCount: number;
  soldPpsfMedian?: number;
  competitionMedianList?: number;
  range?: Range;
  ppsfCrossCheck?: number;
  warnings: string[];
}

export function computeCma(comps: CompRow[], s: Subject, r: AdjRates): CmaResult {
  const rows: CompResult[] = comps.map((comp, index) => {
    const price = basisPrice(comp);
    const adj = adjustComp(comp, s, r);
    const adjusted = round2(price + adj.total);
    return {
      index: index + 1,
      comp,
      price,
      ppsf: price / comp.sqft,
      lines: adj.lines,
      adjTotal: adj.total,
      adjusted,
      adjPpsf: adjusted / comp.sqft,
      usedInValue: comp.status === 'sold' && comp.include,
      listToSale: comp.status === 'sold' && comp.soldPrice && comp.listPrice ? comp.soldPrice / comp.listPrice : undefined,
    };
  });
  const stats = STATUSES.map((status): StatusStat => {
    const rs = rows.filter((x) => x.comp.status === status);
    return {
      status,
      count: rs.length,
      medianPrice: median(rs.map((x) => x.price)),
      medianPpsf: median(rs.map((x) => x.ppsf)),
      medianDom: median(rs.flatMap((x) => (x.comp.dom !== undefined ? [x.comp.dom] : []))),
    };
  });
  const sold = rows.filter((x) => x.comp.status === 'sold');
  const soldDoms = sold.flatMap((x) => (x.comp.dom !== undefined ? [x.comp.dom] : []));
  const ltsr = sold.flatMap((x) => (x.listToSale !== undefined ? [x.listToSale] : []));
  const used = rows.filter((x) => x.usedInValue).map((x) => x.adjusted);
  const warnings: string[] = [];
  let range: Range | undefined;
  if (used.length === 0) warnings.push('No sold comps are selected, so there is no price range yet.');
  else {
    if (used.length < 3) warnings.push(`Only ${used.length} sold comp(s) selected. A range from fewer than 3 is thin evidence.`);
    const mid = median(used) ?? 0;
    if (used.length < 4) {
      range = { low: Math.min(...used), mid, high: Math.max(...used), n: used.length, method: 'Fewer than 4 selected sold comps: lowest to highest adjusted price, with the median as the middle.' };
    } else {
      range = { low: quantile(used, 0.25) ?? 0, mid, high: quantile(used, 0.75) ?? 0, n: used.length, method: 'Middle half of the selected sold comps: 25th to 75th percentile of adjusted prices, with the median as the middle.' };
    }
  }
  const active = rows.filter((x) => x.comp.status === 'active' || x.comp.status === 'pending');
  const soldPpsf = median(sold.map((x) => x.ppsf));
  const usedPpsf = median(rows.filter((x) => x.usedInValue).map((x) => x.ppsf));
  return {
    rows,
    stats,
    soldDomMedian: median(soldDoms),
    soldDomMean: mean(soldDoms),
    ltsrMedian: median(ltsr),
    ltsrMean: mean(ltsr),
    ltsrMin: ltsr.length ? Math.min(...ltsr) : undefined,
    ltsrMax: ltsr.length ? Math.max(...ltsr) : undefined,
    ltsrCount: ltsr.length,
    soldPpsfMedian: soldPpsf,
    competitionMedianList: median(active.map((x) => x.price)),
    range,
    ppsfCrossCheck: usedPpsf === undefined ? undefined : usedPpsf * s.sqft,
    warnings,
  };
}
