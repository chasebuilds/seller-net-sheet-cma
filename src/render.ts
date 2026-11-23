import { locationPlot, ppsfChart, rangeBar, statusChart, STATUS_LABEL } from './charts';
import { computeCma, type CmaResult } from './cma';
import { fmtDate, parseDate } from './dates';
import { esc, money, money0, pct } from './money';
import { computeBuyer } from './buyer';
import { computeNet, type NetResult } from './netsheet';
import type { State } from './state';

export const DISCLAIMER =
  'This is a comparative market analysis: a real estate broker opinion used to price a listing. It is not an appraisal and is not a USPAP appraisal, which only a licensed or certified appraiser can give. Net sheet figures are estimates. The closing agent settlement statement is the real number.';

const neg = (n: number) => (n < 0 ? 'neg' : '');
const dateText = (iso: string) => {
  const ms = parseDate(iso);
  return ms === null ? esc(iso) : fmtDate(ms);
};

export function sheetPage(s: State, r: NetResult, opts: { live?: boolean } = {}): string {
  const cols = r.scenarios;
  const n = cols.length;
  const head = `<tr><th class="l">Line</th><th class="l basis">Basis</th>${cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>`;
  const priceRow = `<tr class="strong"><td class="l">Sale price</td><td class="basis"></td>${cols.map((c) => `<td>${money(c.price)}</td>`).join('')}</tr>`;
  const sub = (label: string, f: (c: (typeof cols)[number]) => number) => `<tr class="sub"><td class="l" colspan="2">${label}</td>${cols.map((c) => `<td class="${neg(f(c))}">${money(f(c))}</td>`).join('')}</tr>`;
  const payRows = s.net.payoffs
    .map((p, i) => `<tr><td class="l">${esc(p.label)}</td><td class="basis">payoff</td>${cols.map((c) => `<td>${money(c.payoffs[i]?.amount ?? 0)}</td>`).join('')}</tr>`)
    .join('');
  const groupRows = (cols[0]?.groups ?? [])
    .map((g, gi) => {
      const lines = g.lines
        .map((l, li) => `<tr><td class="l">${esc(l.label)}${l.placeholder ? '<span class="ph">*</span>' : ''}</td><td class="basis">${esc(l.basis)}</td>${cols.map((c) => `<td>${money(c.groups[gi]?.lines[li]?.amount ?? 0)}</td>`).join('')}</tr>`)
        .join('');
      return `<tr class="grp"><td class="l" colspan="${n + 2}">${esc(g.label)}</td></tr>${lines}`;
    })
    .join('');
  const prRows = r.prorations
    .map((p) => `<tr><td class="l">${esc(p.setup.label)} proration</td><td class="basis">${p.result.ok ? `${p.result.sellerDays} of ${p.result.periodDays} days, ${p.setup.status === 'unpaid' ? 'owed' : 'credit'}` : 'check dates'}</td>${cols.map(() => `<td class="${neg(p.result.effect)}">${money(p.result.effect)}</td>`).join('')}</tr>`)
    .join('');
  const netRow = `<tr class="net"><td class="l" colspan="2">Estimated net to seller</td>${cols.map((c) => `<td>${money(c.net)}</td>`).join('')}</tr>`;
  const pctRow = `<tr class="muted"><td class="l" colspan="2">Net as a share of sale price</td>${cols.map((c) => `<td>${pct(c.netPct)}</td>`).join('')}</tr>`;
  const detail = r.prorations.length
    ? `<div class="detail"><h4>Proration detail (closing ${dateText(s.net.closingDate)}; the closing day belongs to the ${s.net.closingDayOwner}; ${s.net.prorationMethod === "360" ? "360-day banker year, 30/360" : "actual calendar days"})</h4>${r.prorations.map((p) => `<p><b>${esc(p.setup.label)}.</b> ${esc(p.result.formula)}${p.result.note ? ` ${esc(p.result.note)}` : ''}</p>`).join('')}</div>`
    : '';
  const ph = r.placeholderCount ? `<p class="warnline">* ${r.placeholderCount} cost line(s) still use a placeholder amount that has not been confirmed. Replace them with local figures before showing this sheet to a client.</p>` : '';
  return `<section class="page sheet-page${opts.live ? ' live' : ''}">
<header class="ph-head"><div><h2>Seller net sheet</h2><div class="sub">${esc(s.subject.address)} &middot; estimated closing ${dateText(s.net.closingDate)}</div></div><div class="who">${esc(s.agent.name)}<br>${esc(s.agent.brokerage)}</div></header>
<table class="nt">${head}${priceRow}
<tr class="grp"><td class="l" colspan="${n + 2}">Payoffs</td></tr>${payRows}${sub('Total payoffs', (c) => c.payoffTotal)}
${groupRows}${sub('Total costs', (c) => c.costTotal)}
${prRows ? `<tr class="grp"><td class="l" colspan="${n + 2}">Prorations (credit is positive, amount owed is negative)</td></tr>${prRows}` : ''}
${netRow}${pctRow}</table>
${detail}${ph}
<p class="disc">Estimate only, not a quote or a commitment. Net sheet figures are estimates. The closing agent settlement statement is the real number.</p>
</section>`;
}


function foot(n: number, total: number): string {
  return `<footer class="pfoot"><span>${esc(DISCLAIMER_SHORT)}</span><span>${n} / ${total}</span></footer>`;
}
const DISCLAIMER_SHORT = 'A CMA is a broker opinion of value for pricing, not an appraisal.';

function tile(label: string, value: string, note = ''): string {
  return `<div class="tile"><div class="tl">${esc(label)}</div><div class="tv">${value}</div>${note ? `<div class="tn">${esc(note)}</div>` : ''}</div>`;
}

export function deck(s: State): string {
  const cma = computeCma(s.cma.comps, s.subject, s.cma.rates);
  const net = computeNet(s.net);
  const total = 7;
  const subjPpsf = cma.range ? cma.range.mid / s.subject.sqft : undefined;
  const sold = cma.stats.find((x) => x.status === 'sold');
  const pages: string[] = [];

  pages.push(`<section class="page cover"><div class="cover-in"><div class="eyebrow">Listing appointment</div><h1>${esc(s.subject.address)}</h1><p class="lead">Market analysis and seller net sheet</p><div class="coverwho"><b>Prepared by ${esc(s.agent.name)}</b><br>${esc(s.agent.brokerage)}<br>${dateText(s.agent.preparedDate)}</div></div>${foot(1, total)}</section>`);

  pages.push(`<section class="page"><h2>The subject property</h2>
<table class="kv"><tr><th>Address</th><td>${esc(s.subject.address)}</td></tr><tr><th>Living area</th><td>${s.subject.sqft.toLocaleString()} sq ft</td></tr><tr><th>Bedrooms and baths</th><td>${s.subject.beds} bed, ${s.subject.baths} bath</td></tr><tr><th>Year built</th><td>${s.subject.yearBuilt}</td></tr></table>
${s.subject.notes ? `<h3>Notes</h3><p>${esc(s.subject.notes)}</p>` : ''}
<h3>Market at a glance</h3><div class="tiles">${cma.stats.map((x) => tile(STATUS_LABEL[x.status], String(x.count), x.medianPpsf !== undefined ? `median $${x.medianPpsf.toFixed(0)}/sq ft` : '')).join('')}</div>
<p class="muted">Counts come from the ${s.cma.comps.length} listings in this analysis (${esc(s.cma.source)}).</p>${foot(2, total)}</section>`);

  pages.push(`<section class="page"><h2>Market activity</h2>${statusChart(cma)}
<div class="tiles">${tile('Sold, median days on market', cma.soldDomMedian !== undefined ? cma.soldDomMedian.toFixed(0) : 'n/a', cma.soldDomMean !== undefined ? `mean ${cma.soldDomMean.toFixed(0)}` : '')}${tile('List-to-sale ratio, median', cma.ltsrMedian !== undefined ? pct(cma.ltsrMedian * 100) : 'n/a', cma.ltsrMin !== undefined ? `range ${pct((cma.ltsrMin ?? 0) * 100)} to ${pct((cma.ltsrMax ?? 0) * 100)}, ${cma.ltsrCount} sales` : '')}${tile('Sold, median $ per sq ft', sold?.medianPpsf !== undefined ? `$${sold.medianPpsf.toFixed(0)}` : 'n/a')}${tile('Competing median list price', cma.competitionMedianList !== undefined ? money0(cma.competitionMedianList) : 'n/a', 'active and pending')}</div>
<p>List-to-sale ratio is the sold price divided by the final list price. Days on market is as given in the source data. Expired listings are homes that did not sell at their price, which is the reason pricing matters.</p>${foot(3, total)}</section>`);

  const rowsHtml = cma.rows
    .map((x) => `<tr class="${x.usedInValue ? 'used' : ''}"><td>${x.index}</td><td class="l">${esc(x.comp.address)}</td><td>${STATUS_LABEL[x.comp.status]}</td><td>${money0(x.price)}</td><td>${x.comp.sqft.toLocaleString()}</td><td>$${x.ppsf.toFixed(0)}</td><td>${x.comp.beds ?? ''}/${x.comp.baths ?? ''}</td><td>${x.comp.yearBuilt ?? ''}</td><td>${x.comp.dom ?? ''}</td><td>${x.listToSale !== undefined ? pct(x.listToSale * 100) : ''}</td></tr>`)
    .join('');
  pages.push(`<section class="page"><h2>Comparable properties</h2><table class="grid"><thead><tr><th>#</th><th class="l">Address</th><th>Status</th><th>Price*</th><th>Sq ft</th><th>$/sq ft</th><th>Bd/Ba</th><th>Built</th><th>DOM</th><th>Sale/list</th></tr></thead><tbody>${rowsHtml}</tbody></table>
<p class="muted">* Sold price for sold listings, list price for the rest. Shaded rows are the sold comps used for the price range.</p>${foot(4, total)}</section>`);

  const plot = locationPlot(cma, s.subject);
  pages.push(`<section class="page"><h2>Price per square foot</h2><div class="chart">${ppsfChart(cma, subjPpsf)}</div>${plot ? `<h3>Where the comparables sit</h3><div class="chart">${plot}</div>` : ''}${foot(5, total)}</section>`);

  const used = cma.rows.filter((x) => x.usedInValue);
  const adjRows = used
    .map((x) => `<tr><td>${x.index}</td><td class="l">${esc(x.comp.address)}</td><td>${money0(x.price)}</td><td class="l adjl">${x.lines.length ? x.lines.map((l) => `${esc(l.label)}: ${l.amount < 0 ? '-' : '+'}${money0(Math.abs(l.amount))}`).join('<br>') : 'none'}</td><td class="${neg(x.adjTotal)}">${money0(x.adjTotal)}</td><td><b>${money0(x.adjusted)}</b></td></tr>`)
    .join('');
  const rng = cma.range;
  const rateWarn = s.cma.rates.placeholder.length ? `<p class="warnline">Some adjustment rates are still placeholders (${s.cma.rates.placeholder.length} not yet confirmed). Replace them with rates supported by your market before relying on the range.</p>` : '';
  pages.push(`<section class="page"><h2>Suggested list price range</h2>
${rng ? `${rangeBar(rng.low, rng.mid, rng.high)}<div class="tiles">${tile('Low', money0(rng.low))}${tile('Middle (median)', money0(rng.mid), `${money0(rng.mid / s.subject.sqft)} per sq ft`)}${tile('High', money0(rng.high))}${tile('Sold comps used', String(rng.n))}</div><p>${esc(rng.method)}</p>${cma.ppsfCrossCheck !== undefined ? `<p>Cross-check: the median unadjusted $ per sq ft of the comps used, times ${s.subject.sqft.toLocaleString()} sq ft, is ${money0(cma.ppsfCrossCheck)}.</p>` : ''}` : '<p>No sold comps selected, so there is no range yet.</p>'}
${cma.warnings.map((w) => `<p class="warnline">${esc(w)}</p>`).join('')}${rateWarn}
<h3>Adjustments to the sold comps</h3><table class="grid"><thead><tr><th>#</th><th class="l">Address</th><th>Sold</th><th class="l">Adjustments (subject minus comp)</th><th>Total</th><th>Adjusted</th></tr></thead><tbody>${adjRows}</tbody></table>${foot(6, total)}</section>`);

  pages.push(`${sheetPage(s, net).replace('</section>', `${foot(7, total)}</section>`)}`);
  return pages.join('\n');
}

export function cmaSummary(cma: CmaResult, s: State): string {
  const sold = cma.stats.find((x) => x.status === 'sold');
  const rng = cma.range;
  return `<div class="tiles">${tile('Listings', String(cma.rows.length))}${tile('Sold median $/sq ft', sold?.medianPpsf !== undefined ? `$${sold.medianPpsf.toFixed(0)}` : 'n/a')}${tile('Median days on market (sold)', cma.soldDomMedian !== undefined ? cma.soldDomMedian.toFixed(0) : 'n/a')}${tile('Median list-to-sale', cma.ltsrMedian !== undefined ? pct(cma.ltsrMedian * 100) : 'n/a')}</div>
<div class="rangebox">${rng ? `<div class="rl">Suggested list price range for ${esc(s.subject.address)}</div><div class="rv">${money0(rng.low)} to ${money0(rng.high)}</div><div class="rn">Middle ${money0(rng.mid)} from ${rng.n} sold comp(s). ${esc(rng.method)}</div>` : '<div class="rl">Suggested list price range</div><div class="rn">Tick at least one sold comp.</div>'}${cma.warnings.map((w) => `<div class="warnline">${esc(w)}</div>`).join('')}</div>`;
}

export function buyerPage(s: State, opts: { live?: boolean } = {}): string {
  const net = computeNet(s.net);
  const cols = computeBuyer(s.buyer, s.net, net);
  const n = cols.length;
  const row = (label: string, basis: string, f: (c: (typeof cols)[number]) => number, cls = '') => `<tr class="${cls}"><td class="l">${label}</td><td class="basis">${basis}</td>${cols.map((c) => `<td class="${f(c) < 0 ? 'neg' : ''}">${money(f(c))}</td>`).join('')}</tr>`;
  const groups = (cols[0]?.groups ?? [])
    .map((g, gi) => {
      const sign = g.group === 'credit' ? -1 : 1;
      const lines = g.lines
        .map((l, li) => `<tr><td class="l">${esc(l.label)}${l.placeholder ? '<span class="ph">*</span>' : ''}</td><td class="basis">${esc(l.basis)}</td>${cols.map((c) => `<td class="${sign < 0 ? 'neg' : ''}">${money(sign * (c.groups[gi]?.lines[li]?.amount ?? 0))}</td>`).join('')}</tr>`)
        .join('');
      return `<tr class="grp"><td class="l" colspan="${n + 2}">${esc(g.label)}</td></tr>${lines}`;
    })
    .join('');
  const ph = s.buyer.lines.filter((l) => l.placeholder).length;
  return `<section class="page sheet-page${opts.live ? ' live' : ''}">
<header class="ph-head"><div><h2>Buyer estimated cash to close</h2><div class="sub">${esc(s.subject.address)} &middot; estimated closing ${dateText(s.net.closingDate)}</div></div><div class="who">${esc(s.agent.name)}<br>${esc(s.agent.brokerage)}</div></header>
<table class="nt"><tr><th class="l">Line</th><th class="l basis">Basis</th>${cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}</tr>
${row('Purchase price', '', (c) => c.price, 'strong')}${row('Loan amount (price minus down payment)', '', (c) => c.loanAmount, 'muted')}
${groups}${row('Total charges', '', (c) => c.charges, 'sub')}
<tr class="grp"><td class="l" colspan="${n + 2}">Credits from the seller side of this deal</td></tr>
${row('Seller concessions (from the net sheet)', 'net sheet', (c) => -c.sellerConcessions)}${row('Prorations, buyer view (credit is negative)', 'net sheet, same method', (c) => c.prorations)}
<tr class="net"><td class="l" colspan="2">Estimated cash to close</td>${cols.map((c) => `<td>${money(c.cashToClose)}</td>`).join('')}</tr></table>
${ph ? `<p class="warnline">* ${ph} line(s) still use a placeholder amount that has not been confirmed. Replace them with the lender's estimate before showing this sheet to a client.</p>` : ''}
<p class="disc">Estimate only, not a loan estimate or a quote. The lender's Closing Disclosure and the closing agent's settlement statement are the real numbers. Credits and deductions are shown as negatives.</p>
</section>`;
}
