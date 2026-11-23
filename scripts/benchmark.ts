// Writes BENCHMARK.md and the measured line in README.md from a real, seeded run. Run: npm run benchmark
//
// 1. Proration and net totals are checked against a reference written separately inside this file:
//    calendar days are counted by stepping through the days one at a time, money is integer cents,
//    and rounding is half-up on integers. The product code counts by date arithmetic and rounds floats.
// 2. The comps CSV parser is run on generated messy files whose clean truth is known.
//
// What this does and does not show: it checks the code against an independent implementation of the same rules.
// The 30/360 rule (every month 30 days, a 31st counts as the 30th) and "half a cent rounds up" are definitions shared with the product code.
import { writeFileSync, readFileSync } from 'node:fs';
import { computeBuyer, type BuyerInputs } from '../src/buyer';
import { parseComps, type ParsedComp, type Status } from '../src/csv';
import { prorate } from '../src/dates';
import { computeNet, type CostLine, type NetInputs } from '../src/netsheet';

const SEED = 20261123;
let st = SEED >>> 0;
function rnd(): number {
  st = (st + 0x6d2b79f5) >>> 0;
  let t = st;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T>(xs: readonly T[]): T => xs[int(0, xs.length - 1)] as T;
const chance = (p: number) => rnd() < p;
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

// ---------- reference: calendar ----------
type YMD = { y: number; m: number; d: number };
const toDate = (x: YMD) => new Date(Date.UTC(x.y, x.m - 1, x.d));
const fromDate = (dt: Date): YMD => ({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() });
const key = (x: YMD) => x.y * 10000 + x.m * 100 + x.d;
const next = (x: YMD): YMD => {
  const dt = toDate(x);
  dt.setUTCDate(dt.getUTCDate() + 1);
  return fromDate(dt);
};
const parse = (s: string): YMD => ({ y: Number(s.slice(0, 4)), m: Number(s.slice(5, 7)), d: Number(s.slice(8, 10)) });
const halfUp = (num: number, den: number) => Math.floor((2 * num + den) / (2 * den));

interface Ref { periodDays: number; sellerDays: number; shareCents: number; effectCents: number }

function refActual(amountCents: number, start: YMD, end: YMD, closing: YMD, sellerOwnsClosingDay: boolean, paid: boolean): Ref {
  let periodDays = 0;
  let sellerDays = 0;
  for (let c = start; key(c) <= key(end); c = next(c)) {
    periodDays++;
    if (key(c) < key(closing) || (sellerOwnsClosingDay && key(c) === key(closing))) sellerDays++;
  }
  const shareCents = halfUp(amountCents * sellerDays, periodDays);
  return { periodDays, sellerDays, shareCents, effectCents: paid ? amountCents - shareCents : -shareCents };
}

// 30/360 ordinal: months are 30 days, a 31st counts as the 30th.
const ord = (x: YMD) => x.y * 360 + (x.m - 1) * 30 + (Math.min(x.d, 30) - 1);

function ref360(amountCents: number, start: YMD, end: YMD, closing: YMD, sellerOwnsClosingDay: boolean, paid: boolean): Ref {
  const periodDays = ord(next(end)) - ord(start);
  const raw = ord(closing) - ord(start) + (sellerOwnsClosingDay ? 1 : 0);
  const sellerDays = Math.min(periodDays, Math.max(0, raw));
  const shareCents = halfUp(amountCents * sellerDays, periodDays);
  return { periodDays, sellerDays, shareCents, effectCents: paid ? amountCents - shareCents : -shareCents };
}

const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

// ---------- 1. proration cases ----------
function randomPeriod(): { start: YMD; end: YMD } {
  const kind = pick(['calendar', 'calendar', 'fiscal', 'month', 'month', 'quarter'] as const);
  const y = int(2023, 2033);
  if (kind === 'calendar') return { start: { y, m: 1, d: 1 }, end: { y, m: 12, d: 31 } };
  if (kind === 'fiscal') {
    const m = int(2, 12);
    return { start: { y, m, d: 1 }, end: fromDate(new Date(Date.UTC(y + 1, m - 1, 0))) };
  }
  const m = int(1, 12);
  const len = kind === 'month' ? 1 : 3;
  return { start: { y, m, d: 1 }, end: fromDate(new Date(Date.UTC(y, m - 1 + len, 0))) };
}

const procRows = { actual: { n: 0, exact: 0, leap: 0, leapExact: 0 }, '360': { n: 0, exact: 0, leap: 0, leapExact: 0 } };
const procMismatch: string[] = [];
const PRORATION_CASES = 20000;
for (let i = 0; i < PRORATION_CASES; i++) {
  const method = i % 2 === 0 ? 'actual' : '360';
  const { start, end } = randomPeriod();
  const startMs = Date.UTC(start.y, start.m - 1, start.d);
  const endMs = Date.UTC(end.y, end.m - 1, end.d);
  const spanDays = Math.round((endMs - startMs) / 86400000);
  const closingDt = new Date(startMs + int(-20, spanDays + 20) * 86400000);
  const closing = fromDate(closingDt);
  const amountCents = int(1, 4_000_000);
  const sellerOwns = chance(0.3);
  const paid = chance(0.5);
  const ref = (method === 'actual' ? refActual : ref360)(amountCents, start, end, closing, sellerOwns, paid);
  const p = prorate({ amount: amountCents / 100, periodStart: iso(start.y, start.m, start.d), periodEnd: iso(end.y, end.m, end.d), closing: iso(closing.y, closing.m, closing.d), status: paid ? 'paid' : 'unpaid', closingDayOwner: sellerOwns ? 'seller' : 'buyer', method });
  const ok = p.ok && p.periodDays === ref.periodDays && p.sellerDays === ref.sellerDays && Math.round(p.sellerShare * 100) === ref.shareCents && Math.round(p.effect * 100) === ref.effectCents;
  const spansLeapDay = isLeap(start.y) ? key(start) <= key({ y: start.y, m: 2, d: 29 }) && key(end) >= key({ y: start.y, m: 2, d: 29 }) : isLeap(end.y) && key(end) >= key({ y: end.y, m: 2, d: 29 });
  const row = procRows[method];
  row.n++;
  if (ok) row.exact++;
  else if (procMismatch.length < 5) procMismatch.push(`${method} ${amountCents}c ${iso(start.y, start.m, start.d)}..${iso(end.y, end.m, end.d)} closing ${iso(closing.y, closing.m, closing.d)}: product ${Math.round(p.sellerShare * 100)}c ref ${ref.shareCents}c`);
  if (spansLeapDay) {
    row.leap++;
    if (ok) row.leapExact++;
  }
}

// ---------- 2. net sheet and buyer cash cases ----------
interface RefLine { cents: (priceCents: number) => number }
const NET_CASES = 5000;
let netScen = 0;
let netExact = 0;
let buyerExact = 0;
const netMismatch: string[] = [];
const GROUPS = ['commission', 'concession', 'settlement', 'transfer', 'warranty', 'repairs', 'other'] as const;
const BGROUPS = ['down', 'loan', 'prepaid', 'escrow', 'settlement', 'other', 'credit'] as const;

function mkLine<G extends string>(group: G) {
  const mode = pick(['flat', 'percent', 'perThousand'] as const);
  const hundredths = mode === 'flat' ? int(0, 900_000) : mode === 'percent' ? int(0, 1200) : int(0, 600);
  const value = mode === 'flat' ? hundredths / 100 : hundredths / 100;
  const ref: RefLine = {
    cents: (pc) => (mode === 'flat' ? hundredths : mode === 'percent' ? halfUp(pc * hundredths, 10000) : halfUp(pc * hundredths, 100000)),
  };
  return { line: { id: 'x', group, label: 'x', mode, value, placeholder: false }, ref };
}

for (let i = 0; i < NET_CASES; i++) {
  const method = chance(0.5) ? 'actual' : '360';
  const { start, end } = randomPeriod();
  const startMs = Date.UTC(start.y, start.m - 1, start.d);
  const spanDays = Math.round((Date.UTC(end.y, end.m - 1, end.d) - startMs) / 86400000);
  const closing = fromDate(new Date(startMs + int(0, spanDays) * 86400000));
  const owner = chance(0.3);
  const prorations = [0, 1].map((k) => {
    const pr = k === 0 ? { start, end } : randomPeriod();
    return { amountCents: int(0, 800_000), start: pr.start, end: pr.end, paid: chance(0.5), enabled: chance(0.85) };
  });
  const prices = [0, 1, 2].map(() => int(80_000, 1_200_000) * 100 + (chance(0.2) ? int(0, 99) : 0));
  const payoffsCents = [int(0, 60_000_000), int(0, 5_000_000)];
  const sLines = Array.from({ length: int(3, 10) }, () => mkLine(pick(GROUPS)));
  const bLines = Array.from({ length: int(3, 10) }, () => mkLine(pick(BGROUPS)));
  const net: NetInputs = {
    scenarios: prices.map((p, k) => ({ name: `S${k}`, price: p / 100 })),
    closingDate: iso(closing.y, closing.m, closing.d),
    closingDayOwner: owner ? 'seller' : 'buyer',
    prorationMethod: method,
    payoffs: payoffsCents.map((c, k) => ({ id: `p${k}`, label: 'p', amount: c / 100 })),
    lines: sLines.map((l) => l.line as CostLine),
    prorations: prorations.map((p, k) => ({ id: `r${k}`, enabled: p.enabled, label: 'r', amount: p.amountCents / 100, periodStart: iso(p.start.y, p.start.m, p.start.d), periodEnd: iso(p.end.y, p.end.m, p.end.d), status: p.paid ? 'paid' : 'unpaid' })),
  };
  const buyer: BuyerInputs = { lines: bLines.map((l) => l.line) as BuyerInputs['lines'] };
  const result = computeNet(net);
  const cash = computeBuyer(buyer, net, result);
  const refFn = method === 'actual' ? refActual : ref360;
  const prorationCents = prorations.filter((p) => p.enabled).reduce((t, p) => t + refFn(p.amountCents, p.start, p.end, closing, owner, p.paid).effectCents, 0);
  const payoffTotal = payoffsCents[0]! + payoffsCents[1]!;
  prices.forEach((pc, k) => {
    const costs = sLines.reduce((t, l) => t + l.ref.cents(pc), 0);
    const refNet = pc - payoffTotal - costs + prorationCents;
    netScen++;
    const got = Math.round(result.scenarios[k]!.net * 100);
    if (got === refNet) netExact++;
    else if (netMismatch.length < 5) netMismatch.push(`net case ${i} scenario ${k}: product ${got}c ref ${refNet}c`);
    let charges = 0;
    let credits = 0;
    let conc = 0;
    bLines.forEach((l) => (l.line.group === 'credit' ? (credits += l.ref.cents(pc)) : (charges += l.ref.cents(pc))));
    sLines.forEach((l) => (l.line.group === 'concession' ? (conc += l.ref.cents(pc)) : 0));
    const refCash = charges - (credits + conc - prorationCents);
    if (Math.round(cash[k]!.cashToClose * 100) === refCash) buyerExact++;
    else if (netMismatch.length < 5) netMismatch.push(`buyer case ${i} scenario ${k}: product ${Math.round(cash[k]!.cashToClose * 100)}c ref ${refCash}c`);
  });
}

// ---------- 3. CSV robustness ----------
const HEAD: Record<string, string[]> = {
  address: ['Address', 'Property Address', 'STREET ADDRESS', 'address', 'Full Address'],
  status: ['Status', 'List Status', 'status', 'MLS Status'],
  listPrice: ['List Price', 'LP', 'list_price', 'Asking Price', 'Final List Price'],
  soldPrice: ['Sold Price', 'Close Price', 'sale price', 'SP', 'Closed Price'],
  sqft: ['SqFt', 'Sq Ft', 'Square Feet', 'GLA', 'sq_ft', 'Living Area'],
  beds: ['Beds', 'Bedrooms', 'BR'],
  baths: ['Baths', 'Bathrooms', 'BA'],
  yearBuilt: ['Year Built', 'Built', 'yr_built'],
  listDate: ['List Date', 'Listed', 'Listing Date'],
  saleDate: ['Sale Date', 'Close Date', 'Closed', 'Sold Date'],
  dom: ['DOM', 'Days on Market', 'CDOM'],
  lat: ['Lat', 'Latitude'],
  lng: ['Lng', 'Lon', 'Longitude'],
  notes: ['Notes', 'Remarks', 'Comments'],
};
const STATUS_WORDS: Record<Status, string[]> = {
  sold: ['Sold', 'Closed', 'CLOSED', 'sold'],
  pending: ['Pending', 'Under Contract', 'Contingent', 'Active Under Contract'],
  active: ['Active', 'New', 'Coming Soon', 'ACTIVE'],
  expired: ['Expired', 'Withdrawn', 'Cancelled', 'EXPIRED'],
};
const STREETS = ['Oak', 'Maple', 'Sample', 'Fictional', 'Demo', 'Placeholder', 'Mock', 'Test'];
const SUFFIX = ['St', 'Ave', 'Ln', 'Ct', 'Rd', 'Dr'];
const NOTE_WORDS = ['updated kitchen', 'as is', 'cash only', 'corner lot', 'price cut', 'staged', 'needs roof'];
const FIELDS = ['address', 'status', 'listPrice', 'soldPrice', 'sqft', 'beds', 'baths', 'yearBuilt', 'listDate', 'saleDate', 'dom', 'lat', 'lng', 'notes'] as const;
type Field = (typeof FIELDS)[number];

function truthRow(): ParsedComp {
  const status = pick(['sold', 'sold', 'pending', 'active', 'expired'] as const);
  const ly = int(2025, 2026);
  const listDate = iso(ly, int(1, 12), int(1, 28));
  const lm = new Date(`${listDate}T00:00:00Z`);
  const dom = int(1, 300);
  const row: ParsedComp = {
    address: `${int(1, 9999)} ${pick(STREETS)} ${pick(SUFFIX)}${chance(0.2) ? `, Unit ${int(1, 40)}` : ''}`,
    status,
    sqft: int(400, 6000),
    listDate,
    dom,
  };
  if (status === 'sold') {
    row.soldPrice = int(80, 900) * 1000 + (chance(0.5) ? int(0, 999) : 0);
    row.listPrice = Math.round(row.soldPrice * (0.9 + rnd() * 0.2));
    const sd = fromDate(new Date(lm.getTime() + dom * 86400000));
    row.saleDate = iso(sd.y, sd.m, sd.d);
  } else row.listPrice = int(80, 900) * 1000 + (chance(0.5) ? int(0, 999) : 0);
  if (chance(0.8)) row.beds = int(1, 6);
  if (chance(0.8)) row.baths = int(2, 10) / 2;
  if (chance(0.8)) row.yearBuilt = int(1900, 2026);
  if (chance(0.6)) {
    row.lat = Number((rnd() * 140 - 70).toFixed(4));
    row.lng = Number((rnd() * 340 - 170).toFixed(4));
  }
  if (chance(0.5)) row.notes = Array.from({ length: int(1, 3) }, () => pick(NOTE_WORDS)).join(chance(0.5) ? ', ' : ' and ') + (chance(0.15) ? ' "quoted" text' : '');
  if (status !== 'sold' && chance(0.3)) delete row.dom;
  return row;
}

function fmtMoney(n: number): string {
  const r = rnd();
  if (r < 0.3) return String(n);
  if (r < 0.6) return `$${n.toLocaleString('en-US')}`;
  if (r < 0.75) return `${n.toLocaleString('en-US')}.00`;
  if (r < 0.9 && n % 1000 === 0) return `$${n / 1000}k`;
  return `$${n}`;
}
const fmtSqft = (n: number) => pick([String(n), n.toLocaleString('en-US'), `${n.toLocaleString('en-US')} sf`, `${n} SqFt`, `${n} sq ft`]);
function fmtDateStr(d: string): string {
  if (chance(0.5)) return d;
  const [y, m, dd] = d.split('-');
  return `${Number(m)}/${Number(dd)}/${y}`;
}
function q(s: string, forced: boolean): string {
  return forced || /[",\n\r;\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface Made { text: string; good: ParsedComp[]; bad: string[] }
function makeFile(): Made {
  const delim = pick([',', ',', ',', '\t', ';']);
  const eol = chance(0.4) ? '\r\n' : '\n';
  const rows = Array.from({ length: int(3, 40) }, truthRow);
  const used: Field[] = FIELDS.filter((f) => ['address', 'status', 'sqft'].includes(f) || chance(0.8));
  // keep both price columns so a missing column does not turn good rows into bad ones
  for (const f of ['listPrice', 'soldPrice'] as const) if (!used.includes(f)) used.push(f);
  const order = [...used].sort(() => rnd() - 0.5);
  const extra = int(0, 2);
  const lines: string[] = [];
  // unknown extra columns go at the end of each row so positions match the header
  const headerCells = [...order.map((f) => pick(HEAD[f] as string[])), ...Array.from({ length: extra }, () => pick(['MLS#', 'Agent', 'Photos']))];
  lines.push(headerCells.map((h) => q(h, false)).join(delim));
  const good: ParsedComp[] = [];
  const bad: string[] = [];
  const emit = (r: Record<string, unknown>, ownerBad?: string, statusWord?: string) => {
    const map: Partial<Record<Field, string>> = {};
    const row = r as Partial<ParsedComp>;
    map.address = row.address ?? '';
    map.status = statusWord ?? pick(STATUS_WORDS[row.status ?? 'active']);
    if (row.listPrice !== undefined) map.listPrice = fmtMoney(row.listPrice);
    if (row.soldPrice !== undefined) map.soldPrice = fmtMoney(row.soldPrice);
    if (row.sqft !== undefined) map.sqft = fmtSqft(row.sqft);
    if (row.beds !== undefined) map.beds = String(row.beds);
    if (row.baths !== undefined) map.baths = String(row.baths);
    if (row.yearBuilt !== undefined) map.yearBuilt = String(row.yearBuilt);
    if (row.listDate) map.listDate = fmtDateStr(row.listDate);
    if (row.saleDate) map.saleDate = fmtDateStr(row.saleDate);
    if (row.dom !== undefined) map.dom = String(row.dom);
    if (row.dom !== undefined && row.status === 'sold' && row.listDate && row.saleDate && used.includes('listDate') && used.includes('saleDate') && chance(0.4)) map.dom = pick(['', 'N/A', '-']);
    if (row.lat !== undefined) map.lat = String(row.lat);
    if (row.lng !== undefined) map.lng = String(row.lng);
    if (row.notes) map.notes = chance(0.3) ? `  ${row.notes}  ` : row.notes;
    for (const f of order) if (map[f] === undefined) map[f] = f === 'notes' ? '' : pick(['', '', 'N/A', '-']);
    const cellsOut = order.map((f) => q(map[f] ?? '', f === 'notes' && chance(0.3)));
    for (let e = 0; e < extra; e++) cellsOut.push(`X${int(1, 999)}`);
    lines.push(cellsOut.join(delim));
    if (chance(0.1)) lines.push(delim.repeat(headerCells.length - 1));
    if (ownerBad) bad.push(ownerBad);
  };
  for (const r of rows) {
    // fields in columns the file does not have cannot be recovered, so drop them from the truth
    const t: ParsedComp = { ...r };
    for (const f of FIELDS) if (!used.includes(f) && f !== 'address' && f !== 'status' && f !== 'sqft') delete (t as unknown as Record<string, unknown>)[f];
    if (t.status === 'sold' && t.soldPrice === undefined) continue;
    // without the dates columns a blanked DOM cannot be recovered, handled in emit by requiring both columns
    if (t.status !== 'sold' && t.listPrice === undefined) continue;
    if (t.dom !== undefined && !used.includes('dom')) delete t.dom;
    if (!used.includes('dom') && t.status === 'sold' && t.listDate && t.saleDate) t.dom = Math.round((Date.parse(`${t.saleDate}T00:00:00Z`) - Date.parse(`${t.listDate}T00:00:00Z`)) / 86400000);
    if (!used.includes('dom') && t.status !== 'sold') delete t.dom;
    if (!used.includes('dom') && t.status === 'sold' && !(t.listDate && t.saleDate)) delete t.dom;
    // lat and lng come as a pair
    if ((t.lat === undefined) !== (t.lng === undefined)) {
      delete t.lat;
      delete t.lng;
    }
    good.push(t);
    emit(t as unknown as Record<string, unknown>);
  }
  const nBad = int(0, 3);
  for (let b = 0; b < nBad; b++) {
    const base = truthRow();
    const addr = `${int(1, 9999)} Badrow Way ${b}`;
    const kind = pick(['nosold', 'typo', 'status', 'nolist', 'nosqft'] as const);
    const r: Partial<ParsedComp> & { sqftText?: string } = { ...base, address: addr };
    if (kind === 'nosold') {
      r.status = 'sold';
      delete r.soldPrice;
    } else if (kind === 'typo') r.sqft = int(1, 90);
    else if (kind === 'status') r.status = 'Mystery' as Status;
    else if (kind === 'nolist') {
      r.status = 'active';
      delete r.listPrice;
      delete r.soldPrice;
    } else r.sqft = undefined;
    const map: Record<string, unknown> = { ...r };
    emit(map, addr, kind === 'status' ? 'Mystery' : undefined);
  }
  const body = lines.join(eol) + (chance(0.5) ? eol : '');
  return { text: (chance(0.2) ? '﻿' : '') + body, good, bad };
}

const sameRow = (a: ParsedComp, b: ParsedComp): { exact: boolean; fields: number; total: number } => {
  let fields = 0;
  let total = 0;
  for (const f of FIELDS) {
    const av = (a as unknown as Record<string, unknown>)[f];
    const bv = (b as unknown as Record<string, unknown>)[f];
    total++;
    if (av === bv) fields++;
  }
  return { exact: fields === total, fields, total };
};

const CSV_FILES = 2000;
let filesExact = 0;
let rowsExpected = 0;
let rowsExact = 0;
let fieldsOk = 0;
let fieldsAll = 0;
let rowsExtra = 0;
let badInjected = 0;
let badRejected = 0;
let csvThrows = 0;
const csvMismatch: string[] = [];
for (let i = 0; i < CSV_FILES; i++) {
  const f = makeFile();
  try {
    const r = parseComps(f.text);
    rowsExpected += f.good.length;
    let fileOk = r.comps.length === f.good.length;
    if (r.comps.length > f.good.length) rowsExtra += r.comps.length - f.good.length;
    f.good.forEach((g, k) => {
      const p = r.comps[k];
      if (!p) {
        fileOk = false;
        fieldsAll += FIELDS.length;
        return;
      }
      const c = sameRow(p, g);
      fieldsOk += c.fields;
      fieldsAll += c.total;
      if (c.exact) rowsExact++;
      else {
        fileOk = false;
        if (csvMismatch.length < 5) csvMismatch.push(`file ${i} row ${k}: ${JSON.stringify(g)} vs ${JSON.stringify(p)}`);
      }
    });
    for (const b of f.bad) {
      badInjected++;
      if (!r.comps.some((c) => c.address === b) && r.warnings.some((w) => w.includes(b) && w.includes('skipped'))) badRejected++;
    }
    if (fileOk) filesExact++;
  } catch (e) {
    csvThrows++;
    if (csvMismatch.length < 5) csvMismatch.push(`file ${i} threw ${String(e)}`);
  }
}

// ---------- 4. garbage input never throws ----------
const FUZZ = 3000;
let fuzzThrows = 0;
const ALPHABET = ['a', 'Z', '0', '9', ',', ';', '\t', '"', "'", '\n', '\r', ' ', '$', '/', '-', '.', 'é', '﻿', '\u0000', 'address', 'status', 'sqft', 'sold_price', 'N/A'];
for (let i = 0; i < FUZZ; i++) {
  let s = '';
  if (i % 3 === 0) s = makeFile().text.slice(0, int(0, 400));
  else for (let k = int(0, 300); k > 0; k--) s += pick(ALPHABET);
  try {
    const r = parseComps(s);
    if (!Array.isArray(r.comps) || !Array.isArray(r.warnings)) fuzzThrows++;
  } catch {
    fuzzThrows++;
  }
}

// ---------- report ----------
const pc = (a: number, b: number) => (b === 0 ? 'n/a' : `${((a / b) * 100).toFixed(2)}%`);
const A = procRows.actual;
const B = procRows['360'];
const procTotal = A.n + B.n;
const procExact = A.exact + B.exact;
const md = `# Benchmark

Written by \`scripts/benchmark.ts\` (run \`npm run benchmark\`). Seeded, so a rerun gives the same numbers. Nothing here is typed by hand.

## What is compared

- **Proration and net totals** are compared with a reference written separately in the script. The reference counts calendar days by stepping through them one at a time, keeps money in whole cents, and rounds half a cent up using integers. The product code counts days by date arithmetic and rounds floating-point numbers.
- **CSV parsing** is run on generated messy files. Each file is built from clean rows whose true values are known, then messed up. The parsed result is compared with the known values.
- The 30/360 rule (every month counts 30 days, a 31st counts as the 30th) and "half a cent rounds up" are definitions both sides share. This checks the code against an independent implementation of those rules. It does not check that a local closing practice uses them.

## Proration (seller share, to the cent)

| Method | Cases | Exact match (days in period, seller days, seller share, effect on net) | Cases whose period holds Feb 29 | Exact on those |
|---|---|---|---|---|
| Actual days | ${A.n} | ${A.exact} (${pc(A.exact, A.n)}) | ${A.leap} | ${A.leapExact} |
| 360-day | ${B.n} | ${B.exact} (${pc(B.exact, B.n)}) | ${B.leap} | ${B.leapExact} |
| **Total** | **${procTotal}** | **${procExact} (${pc(procExact, procTotal)})** | **${A.leap + B.leap}** | **${A.leapExact + B.leapExact}** |

Cases use calendar years, fiscal years (any start month), single months and quarters, in years 2023 to 2033 (leap years 2024, 2028, 2032 included), with a closing date from 20 days before the period to 20 days after it. Amounts are random whole cents from $0.01 to $40,000.00. Both closing-day owners and both paid states are mixed in.

## Net sheet and buyer cash to close (to the cent)

| Check | Cases | Exact match |
|---|---|---|
| Seller net to the cent, per scenario | ${netScen} | ${netExact} (${pc(netExact, netScen)}) |
| Buyer cash to close to the cent, per scenario | ${netScen} | ${buyerExact} (${pc(buyerExact, netScen)}) |

${NET_CASES} random jobs, 3 price scenarios each. Each job has 2 payoffs, 3 to 10 seller cost lines and 3 to 10 buyer lines (flat, percent and dollars per $1,000, in all groups), and 2 prorations (either may be switched off), under a random method.

## CSV parser on generated messy files

Mess applied: comma, tab and semicolon separators, CRLF and LF, a byte-order mark, shuffled columns, 0 to 2 unknown columns, header name variants and case, \`$\` and thousands commas and \`k\` suffixes, \`1,850 sf\` style sizes, status synonyms, ISO and M/D/YYYY dates, N/A and blank cells, quoted fields with commas and doubled quotes, padded notes, blank lines, and a blanked days-on-market that must be counted from the dates. Each file also gets 0 to 3 bad rows (no sold price, size typo, unknown status, no list price, no size) that must be skipped with a warning.

| Check | Result |
|---|---|
| Files generated | ${CSV_FILES} |
| Files parsed with every good row exactly right and nothing extra | ${filesExact} (${pc(filesExact, CSV_FILES)}) |
| Good rows | ${rowsExpected}, exact: ${rowsExact} (${pc(rowsExact, rowsExpected)}) |
| Field values checked | ${fieldsAll}, correct: ${fieldsOk} (${pc(fieldsOk, fieldsAll)}) |
| Extra rows that should not exist | ${rowsExtra} |
| Bad rows injected | ${badInjected}, skipped with a warning naming the row: ${badRejected} (${pc(badRejected, badInjected)}) |
| Exceptions on generated files | ${csvThrows} |

## Garbage input

${FUZZ} inputs: random characters (quotes, separators, a byte-order mark, a NUL, headers) and generated files cut off at a random length. Exceptions or malformed results: **${fuzzThrows}**.
${procMismatch.length + netMismatch.length + csvMismatch.length ? `\n## First mismatches\n\n${[...procMismatch, ...netMismatch, ...csvMismatch].map((m) => `- \`${m.replace(/`/g, "'").slice(0, 300)}\``).join('\n')}\n` : ''}
## Limits

The reference shares the rules described above. The generated CSV files come from one generator written by the same author as the parser, so they test the mess types listed here and not every spreadsheet export in the wild.
`;
writeFileSync('BENCHMARK.md', md);

const line = `Checked against an independent reference: ${procExact} of ${procTotal} generated prorations (actual-day and 360-day, ${A.leap + B.leap} spanning a Feb 29) and ${netExact} of ${netScen} net totals match to the cent; ${rowsExact} of ${rowsExpected} generated messy CSV rows parse exactly and ${badRejected} of ${badInjected} bad rows are skipped with a warning. Details: [BENCHMARK.md](BENCHMARK.md).`;
const readme = readFileSync('README.md', 'utf8');
const re = /<!-- bench:start -->[\s\S]*?<!-- bench:end -->/;
if (re.test(readme)) writeFileSync('README.md', readme.replace(re, () => `<!-- bench:start -->\n${line}\n<!-- bench:end -->`));
console.log(md.split('\n').slice(10, 22).join('\n'));
const failures = procTotal - procExact + (netScen - netExact) + (netScen - buyerExact) + csvThrows + fuzzThrows;
console.log(failures === 0 && rowsExact === rowsExpected && badRejected === badInjected ? 'ALL EXACT' : `NOT ALL EXACT (failures ${failures}, rows ${rowsExact}/${rowsExpected}, bad ${badRejected}/${badInjected})`);
