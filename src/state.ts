import sampleCsv from '../samples/comps-sample.csv?raw';
import { type CompRow, type Subject, type AdjRates } from './cma';
import { parseComps, type ParsedComp } from './csv';
import { type CostLine, type Group, type Mode, type NetInputs, type Payoff, type ProrationSetup, GROUPS } from './netsheet';

export interface State {
  version: 1;
  agent: { name: string; brokerage: string; preparedDate: string };
  subject: Subject;
  cma: { source: string; comps: CompRow[]; rates: AdjRates };
  net: NetInputs;
}

export const SAMPLE_CSV = sampleCsv;

export function toRows(comps: ParsedComp[]): CompRow[] {
  return comps.map((c) => ({ ...c, include: c.status === 'sold', otherAdj: 0, otherNote: '' }));
}

let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

export function sampleState(): State {
  const comps = toRows(parseComps(sampleCsv).comps);
  const line = (id: string, group: Group, label: string, mode: Mode, value: number): CostLine => ({ id, group, label, mode, value, placeholder: true });
  return {
    version: 1,
    agent: { name: 'Sample Agent', brokerage: 'Example Realty (invented)', preparedDate: '2026-11-23' },
    subject: { address: '412 Sample Orchard Ln (invented)', sqft: 1850, beds: 3, baths: 2, yearBuilt: 1994, lat: 0, lng: 0, notes: 'Invented sample property. Replace every field with the real subject.' },
    cma: {
      source: 'Invented sample comps (samples/comps-sample.csv)',
      comps,
      rates: { perSqft: 55, perBed: 4000, perBath: 5000, perYear: 300, monthlyTrendPct: 0, asOf: '2026-11-23', placeholder: ['perSqft', 'perBed', 'perBath', 'perYear', 'monthlyTrendPct'] },
    },
    net: {
      scenarios: [
        { name: 'List price', price: 379900 },
        { name: 'Likely sale', price: 374000 },
        { name: 'Low sale', price: 367000 },
      ],
      closingDate: '2027-03-15',
      closingDayOwner: 'buyer',
      payoffs: [
        { id: 'po1', label: 'First mortgage payoff (sample)', amount: 248310.55 },
        { id: 'po2', label: 'HELOC payoff (sample)', amount: 12400 },
      ],
      lines: [
        line('l1', 'commission', 'Listing side commission', 'percent', 2.4),
        line('l2', 'commission', 'Buyer side commission', 'percent', 2.2),
        line('l3', 'concession', 'Seller concession toward buyer costs', 'flat', 3000),
        line('l4', 'settlement', 'Owner title policy', 'flat', 1150),
        line('l5', 'settlement', 'Escrow and settlement fee', 'flat', 650),
        line('l6', 'settlement', 'Recording, courier and release fees', 'flat', 125),
        line('l7', 'transfer', 'Transfer or deed tax', 'perThousand', 1.1),
        line('l8', 'warranty', 'Home warranty', 'flat', 575),
        line('l9', 'repairs', 'Repairs from inspection', 'flat', 1800),
        line('l10', 'other', 'Other (describe)', 'flat', 0),
      ],
      prorations: [
        { id: 'pr1', enabled: true, label: 'Property tax', amount: 3285, periodStart: '2027-01-01', periodEnd: '2027-12-31', status: 'unpaid' },
        { id: 'pr2', enabled: true, label: 'HOA dues', amount: 120, periodStart: '2027-03-01', periodEnd: '2027-03-31', status: 'paid' },
      ],
    },
  };
}

const fill = <T>(defaults: Partial<T>, v: T): T => ({ ...defaults, ...v });
const MODES: Mode[] = ['flat', 'percent', 'perThousand'];
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';

/** Checks a parsed JSON file against the shape this app writes. Returns the state or a plain error message. */
export function normalizeState(raw: unknown): { state: State } | { error: string } {
  if (!isObj(raw)) return { error: 'This file is not a saved net sheet (not a JSON object).' };
  if (raw.version !== 1) return { error: 'Unsupported file version. Expected version 1.' };
  const { agent, subject, cma, net } = raw;
  if (!isObj(agent) || !isObj(subject) || !isObj(cma) || !isObj(net)) return { error: 'The file is missing the agent, subject, cma or net section.' };
  const n = net;
  if (!Array.isArray(n.scenarios) || n.scenarios.length !== 3 || !n.scenarios.every((s) => isObj(s) && isStr(s.name) && isNum(s.price))) return { error: 'net.scenarios must be 3 entries with a name and a price.' };
  if (!Array.isArray(n.lines) || !n.lines.every((l) => isObj(l) && isStr(l.label) && isNum(l.value) && MODES.includes(l.mode as Mode) && GROUPS.some((g) => g.id === l.group))) return { error: 'net.lines has an entry with a bad label, value, mode or group.' };
  if (!Array.isArray(n.payoffs) || !n.payoffs.every((p) => isObj(p) && isStr(p.label) && isNum(p.amount))) return { error: 'net.payoffs has a bad entry.' };
  if (!Array.isArray(n.prorations) || !n.prorations.every((p) => isObj(p) && isNum(p.amount) && isStr(p.periodStart) && isStr(p.periodEnd))) return { error: 'net.prorations has a bad entry.' };
  if (!isStr(n.closingDate)) return { error: 'net.closingDate is missing.' };
  if (!Array.isArray(cma.comps) || !cma.comps.every((c) => isObj(c) && isStr(c.address) && isNum(c.sqft) && isStr(c.status))) return { error: 'cma.comps has a bad entry.' };
  if (!isObj(cma.rates) || !isNum(cma.rates.perSqft)) return { error: 'cma.rates is missing.' };
  if (!isNum(subject.sqft) || !isStr(subject.address)) return { error: 'subject needs an address and square footage.' };
  const base = sampleState();
  const s = raw as unknown as State;
  return {
    state: {
      version: 1,
      agent: { ...base.agent, ...s.agent },
      subject: { ...base.subject, ...s.subject },
      cma: { source: isStr(cma.source) ? cma.source : 'Loaded file', comps: s.cma.comps.map((c) => fill<CompRow>({ include: false, otherAdj: 0, otherNote: '' }, c)), rates: { ...base.cma.rates, ...s.cma.rates } },
      net: {
        ...s.net,
        closingDayOwner: n.closingDayOwner === 'seller' ? 'seller' : 'buyer',
        lines: s.net.lines.map((l, i) => fill<CostLine>({ id: `l${i}`, placeholder: false }, l)),
        payoffs: s.net.payoffs.map((p, i) => fill<Payoff>({ id: `po${i}` }, p)),
        prorations: s.net.prorations.map((p, i) => fill<ProrationSetup>({ id: `pr${i}`, enabled: true, label: 'Proration', status: 'unpaid' }, p)),
      },
    },
  };
}
