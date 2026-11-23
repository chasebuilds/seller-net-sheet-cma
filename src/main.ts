import './style.css';
import { locationPlot, ppsfChart, statusChart, STATUS_LABEL } from './charts';
import { computeCma, type RateKey } from './cma';
import { parseComps } from './csv';
import { calendarYearOf, monthOf } from './dates';
import { esc, money0 } from './money';
import { computeNet, GROUPS, type Group } from './netsheet';
import { cmaSummary, deck, sheetPage } from './render';
import { newId, normalizeState, sampleState, SAMPLE_CSV, toRows, type State } from './state';

const KEY = 'seller-net-sheet-cma:v1';
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector<T>(sel) as T;

function loadInitial(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const r = normalizeState(JSON.parse(raw));
      if ('state' in r) return r.state;
    }
  } catch {
    /* storage can be blocked; start from the sample */
  }
  return sampleState();
}

let state: State = loadInitial();
let tab: 'net' | 'cma' | 'deck' = 'net';
let parseWarnings: string[] = [];

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const num = (path: string, v: number, attrs = '') => `<input type="number" step="any" data-b="${path}" data-t="n" value="${v}" ${attrs}>`;
const txt = (path: string, v: string, attrs = '') => `<input type="text" data-b="${path}" data-t="s" value="${esc(v)}" ${attrs}>`;
const date = (path: string, v: string) => `<input type="date" data-b="${path}" data-t="s" value="${esc(v)}">`;
const sel = (path: string, v: string, opts: [string, string][]) => `<select data-b="${path}" data-t="s">${opts.map(([k, l]) => `<option value="${k}"${k === v ? ' selected' : ''}>${l}</option>`).join('')}</select>`;

function netForm(): string {
  const n = state.net;
  const scen = n.scenarios.map((s, i) => `<div class="field"><label>Scenario ${i + 1} name</label>${txt(`net.scenarios.${i}.name`, s.name)}<label>Sale price</label>${num(`net.scenarios.${i}.price`, s.price)}</div>`).join('');
  const payoffs = n.payoffs.map((p, i) => `<div class="row2"><div>${txt(`net.payoffs.${i}.label`, p.label)}</div><div>${num(`net.payoffs.${i}.amount`, p.amount)}</div><button class="x" data-act="del-payoff" data-i="${i}" aria-label="Remove payoff">Remove</button></div>`).join('');
  const lines = n.lines
    .map(
      (l, i) => `<tr><td>${txt(`net.lines.${i}.label`, l.label)}</td><td>${sel(`net.lines.${i}.group`, l.group, GROUPS.map((g) => [g.id, g.label]))}</td><td>${sel(`net.lines.${i}.mode`, l.mode, [['flat', 'Flat $'], ['percent', '% of price'], ['perThousand', '$ per $1,000']])}</td><td>${num(`net.lines.${i}.value`, l.value)}</td><td>${l.placeholder ? `<span class="badge" data-badge="line-${i}">placeholder</span>` : ''}</td><td><button class="x" data-act="del-line" data-i="${i}" aria-label="Remove line">Remove</button></td></tr>`,
    )
    .join('');
  const prs = n.prorations
    .map(
      (p, i) => `<div class="prcard"><div class="prtop"><label class="chk">${`<input type="checkbox" data-b="net.prorations.${i}.enabled" data-t="b"${p.enabled ? ' checked' : ''}>`} Include</label>${txt(`net.prorations.${i}.label`, p.label)}<button class="x" data-act="del-pr" data-i="${i}">Remove</button></div>
<div class="grid4"><div class="field"><label>Bill for the period ($)</label>${num(`net.prorations.${i}.amount`, p.amount)}</div><div class="field"><label>Period start</label>${date(`net.prorations.${i}.periodStart`, p.periodStart)}</div><div class="field"><label>Period end</label>${date(`net.prorations.${i}.periodEnd`, p.periodEnd)}</div><div class="field"><label>Status</label>${sel(`net.prorations.${i}.status`, p.status, [['unpaid', 'Not yet paid (seller owes)'], ['paid', 'Already paid (buyer reimburses)']])}</div></div>
<div class="presets"><button class="mini" data-act="pr-preset" data-i="${i}" data-p="year">Calendar year of closing</button><button class="mini" data-act="pr-preset" data-i="${i}" data-p="month">Month of closing</button></div>
<div class="formula" data-pr="${i}"></div></div>`,
    )
    .join('');
  return `<div class="card"><h3>Sale price scenarios</h3><div class="grid3">${scen}</div>
<div class="grid2"><div class="field"><label>Closing date</label>${date('net.closingDate', n.closingDate)}</div><div class="field"><label>Closing day belongs to</label>${sel('net.closingDayOwner', n.closingDayOwner, [['buyer', 'Buyer (seller owns through the day before)'], ['seller', 'Seller (seller owns through closing day)']])}</div></div></div>
<div class="card"><h3>Mortgage and lien payoffs</h3>${payoffs}<button class="mini" data-act="add-payoff">Add payoff</button></div>
<div class="card"><h3>Costs of sale</h3><p class="hint">Every starting value below is a <b>placeholder</b>. Replace each with the agreement, quote or local figure for this sale. Commission is split into listing and buyer side lines, so each has its own value.</p><div class="tscroll"><table class="lines"><thead><tr><th>Line</th><th>Group</th><th>How it is figured</th><th>Value</th><th></th><th></th></tr></thead><tbody>${lines}</tbody></table></div>
<div class="addrow"><select id="new-group">${GROUPS.map((g) => `<option value="${g.id}">${g.label}</option>`).join('')}</select><button class="mini" data-act="add-line">Add line</button></div></div>
<div class="card"><h3>Prorations (property tax, HOA, other)</h3><p class="hint">Actual-day method: the bill is split by calendar days in its period, so leap years count 366 days. The formula and day count show under each item.</p>${prs}<button class="mini" data-act="add-pr">Add proration</button></div>`;
}

function cmaForm(): string {
  const s = state.subject;
  const r = state.cma.rates;
  const rate = (k: RateKey, label: string) => `<div class="field"><label>${label} ${r.placeholder.includes(k) ? `<span class="badge" data-rbadge="${k}">placeholder</span>` : ''}</label>${num(`cma.rates.${k}`, r[k])}</div>`;
  const comps = state.cma.comps
    .map(
      (c, i) => `<tr><td><input type="checkbox" data-b="cma.comps.${i}.include" data-t="b"${c.include ? ' checked' : ''}${c.status === 'sold' ? '' : ' disabled'} aria-label="Use comp ${i + 1}"></td><td>${i + 1}</td><td class="l">${esc(c.address)}</td><td><span class="st st-${c.status}">${STATUS_LABEL[c.status]}</span></td><td>${money0(c.status === 'sold' ? (c.soldPrice ?? 0) : (c.listPrice ?? 0))}</td><td>${c.sqft.toLocaleString()}</td><td>${c.beds ?? ''}/${c.baths ?? ''}</td><td>${c.yearBuilt ?? ''}</td><td>${c.dom ?? ''}</td><td>${num(`cma.comps.${i}.otherAdj`, c.otherAdj, 'class="narrow"')}</td><td>${txt(`cma.comps.${i}.otherNote`, c.otherNote, 'class="note" placeholder="why"')}</td><td data-out="adj-${i}"></td><td data-out="adjd-${i}"></td></tr>`,
    )
    .join('');
  const cols = ['address', 'status', 'sqft', 'sold_price', 'list_price', 'beds', 'baths', 'year_built', 'list_date', 'sale_date', 'days_on_market', 'lat', 'lng', 'notes'];
  return `<div class="card"><h3>Subject property</h3><div class="grid4"><div class="field wide"><label>Address</label>${txt('subject.address', s.address)}</div><div class="field"><label>Living area (sq ft)</label>${num('subject.sqft', s.sqft)}</div><div class="field"><label>Year built</label>${num('subject.yearBuilt', s.yearBuilt)}</div><div class="field"><label>Bedrooms</label>${num('subject.beds', s.beds)}</div><div class="field"><label>Bathrooms</label>${num('subject.baths', s.baths)}</div><div class="field"><label>Latitude (optional)</label>${num('subject.lat', s.lat ?? 0)}</div><div class="field"><label>Longitude (optional)</label>${num('subject.lng', s.lng ?? 0)}</div><div class="field wide"><label>Notes</label>${txt('subject.notes', s.notes)}</div></div>
<h3>Presentation details</h3><div class="grid4"><div class="field"><label>Prepared by</label>${txt('agent.name', state.agent.name)}</div><div class="field"><label>Brokerage</label>${txt('agent.brokerage', state.agent.brokerage)}</div><div class="field"><label>Date</label>${date('agent.preparedDate', state.agent.preparedDate)}</div></div></div>
<div class="card"><h3>Comparable listings</h3><p class="hint">Source: <b>${esc(state.cma.source)}</b>. Upload a CSV, paste rows, or use the invented sample. Everything stays in this browser.</p>
<div class="addrow"><input type="file" id="csv-file" accept=".csv,.tsv,.txt,text/csv"><button class="mini" data-act="use-sample">Use invented sample</button><button class="mini" data-act="dl-sample">Download sample CSV</button></div>
<details><summary>Paste CSV text</summary><textarea id="csv-paste" rows="5" placeholder="address,status,sold_price,list_price,sqft,..."></textarea><button class="mini" data-act="load-paste">Load pasted rows</button></details>
<details><summary>CSV columns</summary><p class="hint">Header names are matched loosely (case and punctuation ignored; for example Sq Ft, Close Price and DOM work). Required: <b>address, status, sqft</b>, plus <b>sold_price</b> on sold rows and <b>list_price</b> on the others. Optional: ${cols.slice(5).join(', ')}. Status words: active, pending (under contract, contingent), sold (closed), expired (withdrawn, cancelled). Comma, tab or semicolon separators all work.</p></details>
<div id="parse-warn"></div>
<div class="tscroll"><table class="lines comps"><thead><tr><th>Use</th><th>#</th><th class="l">Address</th><th>Status</th><th>Price</th><th>Sq ft</th><th>Bd/Ba</th><th>Built</th><th>DOM</th><th>Other adj ($)</th><th>Note</th><th>Adjustments</th><th>Adjusted</th></tr></thead><tbody>${comps}</tbody></table></div></div>
<div class="card"><h3>Adjustment rates (subject minus comp)</h3><p class="hint">Starting rates are <b>placeholders</b>. Replace them with rates you can support from paired sales or your market. Only sold comps you tick feed the range.</p><div class="grid4">${rate('perSqft', '$ per sq ft')}${rate('perBed', '$ per bedroom')}${rate('perBath', '$ per bathroom')}${rate('perYear', '$ per year of age')}${rate('monthlyTrendPct', 'Market change per month (%)')}<div class="field"><label>Value as of</label>${date('cma.rates.asOf', r.asOf)}</div></div></div>`;
}

function shell() {
  $('#app').innerHTML = `<div class="backdrop"></div><div class="wrap">
<header class="glass bar"><div class="brand"><b>CB</b><span>Seller net sheet and CMA</span></div>
<nav class="tabs" role="tablist"><button data-tab="net" role="tab">Net sheet</button><button data-tab="cma" role="tab">CMA</button><button data-tab="deck" role="tab">Presentation</button></nav>
<div class="acts"><button class="pill" data-act="save">Save JSON</button><button class="pill" data-act="open">Open JSON</button><button class="pill ghost" data-act="reset">Reset to sample</button><input type="file" id="json-file" accept="application/json,.json" hidden></div></header>
<p class="banner">A CMA is a broker opinion for pricing, not an appraisal. A USPAP appraisal needs a licensed or certified appraiser. Net sheet figures are estimates: the closing agent settlement statement is the real number. Sample data is invented.</p>
<main>
<section id="tab-net" class="tab"><div class="cols"><div id="net-form" class="colform"></div><div class="colout"><div class="outhead"><h3>Net sheet</h3><button class="pill solid" data-act="print-sheet">Print one page</button></div><div id="net-live"></div></div></div></section>
<section id="tab-cma" class="tab"><div id="cma-form"></div><div class="card" id="cma-out"></div></section>
<section id="tab-deck" class="tab"><div class="card"><div class="outhead"><h3>Listing presentation</h3><button class="pill solid" data-act="print-deck">Print presentation (7 pages)</button></div><p class="hint">Cover, subject, market activity, comps, charts, pricing and net sheet. Use your browser print dialog: choose Save as PDF, Letter, no headers and footers.</p></div><div id="deck-preview" class="pages"></div></section>
</main></div>`;
}

function renderForms() {
  $('#net-form').innerHTML = netForm();
  $('#cma-form').innerHTML = cmaForm();
  $('#parse-warn').innerHTML = parseWarnings.length ? `<ul class="warns">${parseWarnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : '';
  refresh();
}

function refresh() {
  const net = computeNet(state.net);
  const cma = computeCma(state.cma.comps, state.subject, state.cma.rates);
  $('#net-live').innerHTML = sheetPage(state, net, { live: true });
  net.prorations.forEach((p) => {
    const idx = state.net.prorations.indexOf(p.setup);
    const el = document.querySelector(`[data-pr="${idx}"]`);
    if (el) el.innerHTML = `${esc(p.result.formula)}${p.result.note ? ` <i>${esc(p.result.note)}</i>` : ''}`;
  });
  state.net.prorations.forEach((p, i) => {
    if (!p.enabled) {
      const el = document.querySelector(`[data-pr="${i}"]`);
      if (el) el.textContent = 'Not included in the net sheet.';
    }
  });
  cma.rows.forEach((x, i) => {
    const a = document.querySelector(`[data-out="adj-${i}"]`);
    const b = document.querySelector(`[data-out="adjd-${i}"]`);
    if (a) a.innerHTML = x.lines.length ? x.lines.map((l) => `${esc(l.label)}: ${l.amount < 0 ? '-' : '+'}${money0(Math.abs(l.amount))}`).join('<br>') : 'none';
    if (b) b.textContent = money0(x.adjusted);
  });
  const subjPpsf = cma.range ? cma.range.mid / state.subject.sqft : undefined;
  const plot = locationPlot(cma, state.subject);
  $('#cma-out').innerHTML = `<h3>Market picture and suggested range</h3>${cmaSummary(cma, state)}
<div class="actrow"><button class="mini" data-act="to-net">Use this range for the net sheet scenarios</button><span class="hint">List = high, likely = middle, low = low, each rounded to the nearest $100.</span></div>
<div class="charts"><div><h4>Listings by status</h4>${statusChart(cma)}</div><div><h4>Price per square foot</h4>${ppsfChart(cma, subjPpsf)}</div>${plot ? `<div><h4>Locations</h4>${plot}</div>` : ''}</div>`;
  if (tab === 'deck') $('#deck-preview').innerHTML = deck(state);
  persist();
}

function setTab(t: typeof tab) {
  tab = t;
  document.querySelectorAll<HTMLElement>('.tab').forEach((el) => (el.hidden = el.id !== `tab-${t}`));
  document.querySelectorAll<HTMLElement>('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  if (t === 'deck') $('#deck-preview').innerHTML = deck(state);
  if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`);
}

function setPath(path: string, v: unknown) {
  const parts = path.split('.');
  let o: Record<string, unknown> = state as unknown as Record<string, unknown>;
  for (const p of parts.slice(0, -1)) o = o[p] as Record<string, unknown>;
  o[parts[parts.length - 1] ?? ''] = v;
  const line = /^net\.lines\.(\d+)\.(value|mode)$/.exec(path);
  if (line) {
    const l = state.net.lines[Number(line[1])];
    if (l) l.placeholder = false;
    document.querySelector(`[data-badge="line-${line[1]}"]`)?.remove();
  }
  const rate = /^cma\.rates\.(\w+)$/.exec(path);
  if (rate) {
    state.cma.rates.placeholder = state.cma.rates.placeholder.filter((k) => k !== rate[1]);
    document.querySelector(`[data-rbadge="${rate[1]}"]`)?.remove();
  }
}

function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function printHtml(html: string) {
  $('#print-root').innerHTML = html;
  window.print();
}

function loadCsv(text: string, source: string) {
  const r = parseComps(text);
  parseWarnings = r.warnings;
  if (r.comps.length) {
    state.cma.comps = toRows(r.comps);
    state.cma.source = `${source} (${r.comps.length} of ${r.rowsRead} rows used)`;
  }
  renderForms();
}

const round100 = (x: number) => Math.round(x / 100) * 100;

document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement | HTMLSelectElement;
  const path = t.dataset?.b;
  if (!path) return;
  const kind = t.dataset.t;
  const v = kind === 'b' ? (t as HTMLInputElement).checked : kind === 'n' ? (Number.isFinite((t as HTMLInputElement).valueAsNumber) ? (t as HTMLInputElement).valueAsNumber : 0) : t.value;
  setPath(path, v);
  refresh();
});

document.addEventListener('click', async (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act],[data-tab]');
  if (!el) return;
  if (el.dataset.tab) return setTab(el.dataset.tab as typeof tab);
  const i = Number(el.dataset.i);
  switch (el.dataset.act) {
    case 'del-line': state.net.lines.splice(i, 1); return renderForms();
    case 'add-line': state.net.lines.push({ id: newId('l'), group: ($<HTMLSelectElement>('#new-group').value as Group), label: 'New line', mode: 'flat', value: 0, placeholder: false }); return renderForms();
    case 'del-payoff': state.net.payoffs.splice(i, 1); return renderForms();
    case 'add-payoff': state.net.payoffs.push({ id: newId('po'), label: 'Payoff', amount: 0 }); return renderForms();
    case 'del-pr': state.net.prorations.splice(i, 1); return renderForms();
    case 'add-pr': {
      const p = calendarYearOf(state.net.closingDate) ?? { start: '', end: '' };
      state.net.prorations.push({ id: newId('pr'), enabled: true, label: 'Other proration', amount: 0, periodStart: p.start, periodEnd: p.end, status: 'unpaid' });
      return renderForms();
    }
    case 'pr-preset': {
      const p = el.dataset.p === 'month' ? monthOf(state.net.closingDate) : calendarYearOf(state.net.closingDate);
      const pr = state.net.prorations[i];
      if (p && pr) {
        pr.periodStart = p.start;
        pr.periodEnd = p.end;
      }
      return renderForms();
    }
    case 'use-sample': parseWarnings = []; state.cma.comps = toRows(parseComps(SAMPLE_CSV).comps); state.cma.source = sampleState().cma.source; return renderForms();
    case 'dl-sample': return download('comps-sample.csv', SAMPLE_CSV, 'text/csv');
    case 'load-paste': return loadCsv($<HTMLTextAreaElement>('#csv-paste').value, 'Pasted rows');
    case 'to-net': {
      const r = computeCma(state.cma.comps, state.subject, state.cma.rates).range;
      if (!r) return;
      state.net.scenarios[0] = { name: 'List price', price: round100(r.high) };
      state.net.scenarios[1] = { name: 'Likely sale', price: round100(r.mid) };
      state.net.scenarios[2] = { name: 'Low sale', price: round100(r.low) };
      renderForms();
      return setTab('net');
    }
    case 'print-sheet': return printHtml(sheetPage(state, computeNet(state.net)));
    case 'print-deck': return printHtml(deck(state));
    case 'save': return download(`net-sheet-${state.agent.preparedDate || 'draft'}.json`, JSON.stringify(state, null, 2), 'application/json');
    case 'open': return $<HTMLInputElement>('#json-file').click();
    case 'reset':
      if (confirm('Replace everything with the invented sample? Unsaved changes are lost.')) {
        state = sampleState();
        parseWarnings = [];
        renderForms();
      }
      return;
  }
});

document.addEventListener('change', async (e) => {
  const t = e.target as HTMLInputElement;
  const f = t.files?.[0];
  if (!f) return;
  if (t.id === 'csv-file') loadCsv(await f.text(), f.name);
  if (t.id === 'json-file') {
    try {
      const r = normalizeState(JSON.parse(await f.text()));
      if ('error' in r) return void alert(r.error);
      state = r.state;
      parseWarnings = [];
      renderForms();
    } catch {
      alert('That file is not valid JSON.');
    }
    t.value = '';
  }
});

window.addEventListener('afterprint', () => {
  $('#print-root').innerHTML = '';
});

shell();
renderForms();
const initial = location.hash.slice(1);
setTab(initial === 'cma' || initial === 'deck' ? initial : 'net');
const printMode = new URLSearchParams(location.search).get('print');
if (printMode === 'deck') $('#print-root').innerHTML = deck(state);
if (printMode === 'sheet') $('#print-root').innerHTML = sheetPage(state, computeNet(state.net));
window.addEventListener('hashchange', () => {
  const h = location.hash.slice(1);
  if ((h === 'net' || h === 'cma' || h === 'deck') && h !== tab) setTab(h);
});
