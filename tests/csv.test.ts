import { describe, expect, it } from 'vitest';
import messy from '../samples/comps-messy.csv?raw';
import sample from '../samples/comps-sample.csv?raw';
import { parseComps, parseNum, parseStatus, readRows } from '../src/csv';

describe('parseNum', () => {
  it('handles currency, commas, units, suffixes and blanks', () => {
    expect(parseNum('$1,234,567')).toBe(1234567);
    expect(parseNum(' 1,850 sf ')).toBe(1850);
    expect(parseNum('1850 SqFt')).toBe(1850);
    expect(parseNum('$425k')).toBe(425000);
    expect(parseNum('1.25M')).toBe(1250000);
    expect(parseNum('2.5')).toBe(2.5);
    expect(parseNum('N/A')).toBeUndefined();
    expect(parseNum('')).toBeUndefined();
    expect(parseNum('abc')).toBeUndefined();
  });
});

describe('parseStatus', () => {
  it('maps common MLS words', () => {
    expect(parseStatus('Closed')).toBe('sold');
    expect(parseStatus('SOLD')).toBe('sold');
    expect(parseStatus('Active Under Contract')).toBe('pending');
    expect(parseStatus('Contingent')).toBe('pending');
    expect(parseStatus('Withdrawn')).toBe('expired');
    expect(parseStatus('Coming Soon')).toBe('active');
    expect(parseStatus('Mystery')).toBeUndefined();
  });
});

describe('readRows', () => {
  it('keeps commas, doubled quotes and newlines inside quotes, and reads CRLF', () => {
    expect(readRows('a,"b,c","d ""e"""\r\n1,"x\ny",3', ',')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', 'x\ny', '3'],
    ]);
  });
});

describe('parseComps on the documented sample', () => {
  const r = parseComps(sample);
  it('reads all 14 rows with 7 sold, 2 pending, 3 active, 2 expired', () => {
    expect(r.comps).toHaveLength(14);
    const count = (s: string) => r.comps.filter((c) => c.status === s).length;
    expect([count('sold'), count('pending'), count('active'), count('expired')]).toEqual([7, 2, 3, 2]);
    expect(r.warnings).toEqual([]);
  });
});

describe('parseComps on messy input', () => {
  const r = parseComps(messy);
  it('keeps the 3 usable rows and says why it skipped the other 5', () => {
    expect(r.rowsRead).toBe(8);
    expect(r.comps.map((c) => c.address)).toEqual(['12 Test St, Unit 4', '88 Example Rd', 'Row 4']);
    const skipped = r.warnings.filter((w) => w.includes('skipped'));
    expect(skipped).toHaveLength(5);
    expect(skipped.join('\n')).toMatch(/no sold price/);
    expect(skipped.join('\n')).toMatch(/looks like a typo/);
    expect(skipped.join('\n')).toMatch(/Mystery/);
    expect(skipped.join('\n')).toMatch(/no list price/);
  });
  it('cleans values and maps header aliases', () => {
    const c = r.comps[0]!;
    expect(c.status).toBe('sold');
    expect(c.soldPrice).toBe(245500);
    expect(c.listPrice).toBe(250000);
    expect(c.sqft).toBe(1150);
    expect(c.notes).toBe('Says "as is", cash only');
    expect(c.listDate).toBe('2026-03-01');
    expect(c.saleDate).toBe('2026-04-10');
    expect(c.dom).toBe(40);
    expect(r.mapped.soldPrice).toBe('Close Price');
    expect(r.comps[1]!.status).toBe('pending');
    expect(r.comps[1]!.listPrice).toBe(300000);
    expect(r.warnings.some((w) => /counted from the list and sale dates/.test(w))).toBe(true);
  });
});

describe('parseComps on bad files', () => {
  it('reports an empty file', () => {
    expect(parseComps('').warnings[0]).toMatch(/empty/);
    expect(parseComps('   \n ').comps).toEqual([]);
  });
  it('reports missing required columns and does not guess', () => {
    const r = parseComps('street,price\n1 Main,300000');
    expect(r.comps).toEqual([]);
    expect(r.warnings[0]).toMatch(/Missing required column/);
  });
  it('needs a price column', () => {
    expect(parseComps('address,status,sqft\n1 Main,sold,1200').warnings[0]).toMatch(/price column/);
  });
  it('handles a BOM, tab separated data and semicolons', () => {
    const tab = '﻿address\tstatus\tsold price\tsqft\n1 Main\tSold\t$300,000\t1,200\n';
    expect(parseComps(tab).comps[0]?.soldPrice).toBe(300000);
    expect(parseComps('address;status;sold_price;sqft\n1 Main;sold;300000;1200').comps).toHaveLength(1);
  });
  it('ignores bad coordinates and bad dates but keeps the row', () => {
    const r = parseComps('address,status,list_price,sqft,list_date,lat,lng\n1 Main,active,300000,1200,someday,95,10');
    expect(r.comps).toHaveLength(1);
    expect(r.comps[0]?.lat).toBeUndefined();
    expect(r.comps[0]?.listDate).toBeUndefined();
    expect(r.warnings.join()).toMatch(/not understood/);
  });
});
