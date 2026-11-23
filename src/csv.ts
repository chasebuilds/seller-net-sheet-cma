import { daysBetween, parseDate } from './dates';

export type Status = 'active' | 'pending' | 'sold' | 'expired';

export interface ParsedComp {
  address: string;
  status: Status;
  listPrice?: number;
  soldPrice?: number;
  sqft: number;
  beds?: number;
  baths?: number;
  yearBuilt?: number;
  listDate?: string;
  saleDate?: string;
  dom?: number;
  lat?: number;
  lng?: number;
  notes?: string;
}

export interface ParseResult {
  comps: ParsedComp[];
  warnings: string[];
  rowsRead: number;
  /** Which source column fed each field. */
  mapped: Record<string, string>;
}

/** RFC 4180 style reader: quoted fields, doubled quotes, commas and newlines inside quotes, CRLF or LF. */
export function readRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text.charAt(i);
    if (inQuotes) {
      if (c === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"' && field === '') inQuotes = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text.charAt(i + 1) === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function sniffDelimiter(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  const count = (d: string) => first.split(d).length - 1;
  const best = [',', '\t', ';'].map((d) => ({ d, n: count(d) })).sort((a, b) => b.n - a.n)[0];
  return best && best.n > 0 ? best.d : ',';
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<string, string[]> = {
  address: ['address', 'propertyaddress', 'streetaddress', 'fulladdress', 'location', 'property'],
  status: ['status', 'liststatus', 'marketstatus', 'mlsstatus'],
  listPrice: ['listprice', 'lp', 'askingprice', 'askprice', 'listingprice', 'currentprice', 'finallistprice'],
  soldPrice: ['soldprice', 'saleprice', 'closeprice', 'closedprice', 'sp', 'soldamount', 'closingprice'],
  sqft: ['sqft', 'squarefeet', 'squarefootage', 'sf', 'livingarea', 'gla', 'sqfeet', 'finishedsqft', 'livingareasqft', 'areasqft', 'sqftliving'],
  beds: ['beds', 'bedrooms', 'br', 'bd', 'bedroomstotal'],
  baths: ['baths', 'bathrooms', 'ba', 'bathstotal', 'bathroomstotal'],
  yearBuilt: ['yearbuilt', 'built', 'yrbuilt', 'year', 'yearblt'],
  listDate: ['listdate', 'listingdate', 'listeddate', 'ondate', 'listedon', 'listed'],
  saleDate: ['saledate', 'solddate', 'closedate', 'closingdate', 'closeddate', 'settleddate', 'settlementdate', 'closed'],
  dom: ['dom', 'daysonmarket', 'cdom', 'daysonmkt'],
  lat: ['lat', 'latitude'],
  lng: ['lng', 'lon', 'long', 'longitude'],
  notes: ['notes', 'remarks', 'comments', 'publicremarks'],
};

export const CSV_COLUMNS: { field: string; header: string; required: string; description: string }[] = [
  { field: 'address', header: 'address', required: 'yes', description: 'Street address or any label you will recognize.' },
  { field: 'status', header: 'status', required: 'yes', description: 'active, pending, sold or expired. Also accepted: closed, under contract, contingent, withdrawn, cancelled.' },
  { field: 'sqft', header: 'sqft', required: 'yes', description: 'Living area in square feet. Commas and "sf" are fine.' },
  { field: 'soldPrice', header: 'sold_price', required: 'sold rows', description: 'Closed price. Needed for every sold row.' },
  { field: 'listPrice', header: 'list_price', required: 'other rows', description: 'Final list price. Needed for active, pending and expired rows, and used for list-to-sale ratio on sold rows.' },
  { field: 'beds', header: 'beds', required: 'no', description: 'Bedrooms.' },
  { field: 'baths', header: 'baths', required: 'no', description: 'Bathrooms, halves as .5.' },
  { field: 'yearBuilt', header: 'year_built', required: 'no', description: 'Four digit year.' },
  { field: 'listDate', header: 'list_date', required: 'no', description: 'YYYY-MM-DD or M/D/YYYY.' },
  { field: 'saleDate', header: 'sale_date', required: 'no', description: 'Close date, same formats. Used for the time adjustment.' },
  { field: 'dom', header: 'days_on_market', required: 'no', description: 'If blank and both dates exist, it is counted from list_date to sale_date.' },
  { field: 'lat', header: 'lat', required: 'no', description: 'Latitude, for the location plot.' },
  { field: 'lng', header: 'lng', required: 'no', description: 'Longitude, for the location plot.' },
  { field: 'notes', header: 'notes', required: 'no', description: 'Free text, shown in the comps table.' },
];

/** Reads a number from messy text: "$1,234,567", "1,850 sf", "425k", "N/A". Returns undefined when there is no usable number. */
export function parseNum(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  let s = raw.trim().toLowerCase();
  if (!s || ['n/a', 'na', 'null', 'none', '-', '--', 'tbd', 'unknown'].includes(s)) return undefined;
  s = s.replace(/[$\s]/g, '').replace(/(sq\.?ft\.?|sqft|sf|ft2)$/, '');
  const m = /^(-?\d[\d,]*\.?\d*|-?\.\d+)([km])?$/.exec(s);
  if (!m) return undefined;
  const n = Number((m[1] ?? '').replace(/,/g, ''));
  if (!Number.isFinite(n)) return undefined;
  return m[2] === 'k' ? n * 1000 : m[2] === 'm' ? n * 1_000_000 : n;
}

export function parseStatus(raw: string | undefined): Status | undefined {
  const s = (raw ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  if (/^(sold|closed|settled|sale)/.test(s)) return 'sold';
  if (/(pending|under contract|contingent|contract|sale pending|active under)/.test(s)) return 'pending';
  if (/^(expired|withdrawn|cancel+ed|off market|terminated)/.test(s)) return 'expired';
  if (/^(active|new|coming soon|for sale|listed|price change|back on market)/.test(s)) return 'active';
  return undefined;
}

function dateField(raw: string | undefined): string | undefined {
  const t = raw?.trim();
  if (!t) return undefined;
  const ms = parseDate(t);
  return ms === null ? undefined : new Date(ms).toISOString().slice(0, 10);
}

export function parseComps(input: string): ParseResult {
  const text = input.replace(/^﻿/, '');
  const warnings: string[] = [];
  const empty = (rowsRead: number): ParseResult => ({ comps: [], warnings, rowsRead, mapped: {} });
  if (!text.trim()) {
    warnings.push('The file is empty.');
    return empty(0);
  }
  const rows = readRows(text, sniffDelimiter(text));
  const headerRow = rows[0] ?? [];
  const col: Record<string, number> = {};
  const mapped: Record<string, string> = {};
  headerRow.forEach((h, idx) => {
    const key = norm(h);
    for (const [field, names] of Object.entries(ALIASES)) {
      if (col[field] === undefined && names.includes(key)) {
        col[field] = idx;
        mapped[field] = h.trim();
      }
    }
  });
  const missing = ['address', 'status', 'sqft'].filter((f) => col[f] === undefined);
  if (missing.length) {
    warnings.push(`Missing required column(s): ${missing.join(', ')}. Found headers: ${headerRow.map((h) => h.trim()).filter(Boolean).join(', ') || 'none'}.`);
    return empty(rows.length - 1);
  }
  if (col.soldPrice === undefined && col.listPrice === undefined) {
    warnings.push('Missing a price column: add sold_price and/or list_price.');
    return empty(rows.length - 1);
  }
  const get = (r: string[], f: string): string | undefined => {
    const idx = col[f];
    return idx === undefined ? undefined : r[idx];
  };
  const comps: ParsedComp[] = [];
  let rowsRead = 0;
  let domComputed = 0;
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => c.trim() === '')) return;
    rowsRead++;
    const line = i + 2;
    const address = (get(r, 'address') ?? '').trim() || `Row ${line}`;
    const tag = `Row ${line} (${address})`;
    const status = parseStatus(get(r, 'status'));
    if (!status) return void warnings.push(`${tag}: skipped, status "${(get(r, 'status') ?? '').trim()}" is not active, pending, sold or expired.`);
    const sqft = parseNum(get(r, 'sqft'));
    if (sqft === undefined) return void warnings.push(`${tag}: skipped, no usable square footage.`);
    if (sqft < 100 || sqft > 50_000) return void warnings.push(`${tag}: skipped, square footage ${sqft} looks like a typo.`);
    const listPrice = parseNum(get(r, 'listPrice'));
    const soldPrice = parseNum(get(r, 'soldPrice'));
    if (status === 'sold' && !(soldPrice && soldPrice > 0)) return void warnings.push(`${tag}: skipped, sold row has no sold price.`);
    if (status !== 'sold' && !(listPrice && listPrice > 0)) return void warnings.push(`${tag}: skipped, ${status} row has no list price.`);
    const listDate = dateField(get(r, 'listDate'));
    const saleDate = dateField(get(r, 'saleDate'));
    if ((get(r, 'listDate') ?? '').trim() && !listDate) warnings.push(`${tag}: list date "${get(r, 'listDate')?.trim()}" not understood, ignored.`);
    if ((get(r, 'saleDate') ?? '').trim() && !saleDate) warnings.push(`${tag}: sale date "${get(r, 'saleDate')?.trim()}" not understood, ignored.`);
    let dom = parseNum(get(r, 'dom'));
    if (dom !== undefined && dom < 0) dom = undefined;
    if (dom === undefined && listDate && saleDate) {
      const d = daysBetween(parseDate(listDate) ?? 0, parseDate(saleDate) ?? 0);
      if (d >= 0) {
        dom = d;
        domComputed++;
      }
    }
    const lat = parseNum(get(r, 'lat'));
    const lng = parseNum(get(r, 'lng'));
    comps.push({
      address,
      status,
      listPrice: listPrice && listPrice > 0 ? listPrice : undefined,
      soldPrice: soldPrice && soldPrice > 0 ? soldPrice : undefined,
      sqft,
      beds: parseNum(get(r, 'beds')),
      baths: parseNum(get(r, 'baths')),
      yearBuilt: parseNum(get(r, 'yearBuilt')),
      listDate,
      saleDate,
      dom,
      lat: lat !== undefined && Math.abs(lat) <= 90 && lng !== undefined && Math.abs(lng) <= 180 ? lat : undefined,
      lng: lat !== undefined && Math.abs(lat) <= 90 && lng !== undefined && Math.abs(lng) <= 180 ? lng : undefined,
      notes: (get(r, 'notes') ?? '').trim() || undefined,
    });
  });
  if (domComputed) warnings.push(`Days on market was blank on ${domComputed} row(s) and was counted from the list and sale dates.`);
  return { comps, warnings, rowsRead, mapped };
}
