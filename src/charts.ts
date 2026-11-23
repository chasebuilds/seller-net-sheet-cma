import type { CmaResult } from './cma';
import type { Status } from './csv';
import { esc, money0 } from './money';

export const STATUS_COLOR: Record<Status, string> = { sold: '#2b7a6b', pending: '#c98a1b', active: '#3b6fb6', expired: '#a0524a' };
export const STATUS_LABEL: Record<Status, string> = { sold: 'Sold', pending: 'Pending', active: 'Active', expired: 'Expired' };
const LETTER: Record<Status, string> = { sold: 'S', pending: 'P', active: 'A', expired: 'E' };
const INK = '#2a2019';
const MUTED = '#6b5e52';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}...` : s);

function legend(x: number, y: number): string {
  return (['sold', 'pending', 'active', 'expired'] as Status[])
    .map((s, i) => `<g transform="translate(${x + i * 92},${y})"><rect width="12" height="12" rx="2" fill="${STATUS_COLOR[s]}"/><text x="17" y="10.5" font-size="11" fill="${INK}">${STATUS_LABEL[s]}</text></g>`)
    .join('');
}

/** Horizontal bars of price per square foot, one per comp, with the median sold line and the subject's indicated value. */
export function ppsfChart(r: CmaResult, subjectPpsf?: number): string {
  const rows = [...r.rows].sort((a, b) => b.ppsf - a.ppsf);
  if (!rows.length) return '';
  const W = 700;
  const left = 250;
  const right = 650;
  const top = 58;
  const rh = 22;
  const H = top + rows.length * rh + 30;
  const max = Math.max(...rows.map((x) => x.ppsf), r.soldPpsfMedian ?? 0, subjectPpsf ?? 0) * 1.1;
  const sx = (v: number) => left + ((right - left) * v) / max;
  const step = max > 400 ? 100 : max > 150 ? 50 : 25;
  const ticks: number[] = [];
  for (let v = 0; v <= max; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${top - 6}" y2="${H - 24}" stroke="#d9cfc4" stroke-width="1"/><text x="${sx(v)}" y="${H - 8}" font-size="10" text-anchor="middle" fill="${MUTED}">$${v}</text>`).join('');
  const bars = rows
    .map((x, i) => {
      const y = top + i * rh;
      const c = x.comp;
      return `<text x="${left - 8}" y="${y + 13}" font-size="11" text-anchor="end" fill="${INK}">#${x.index} ${esc(clip(c.address, 27))} [${LETTER[c.status]}]</text><rect x="${left}" y="${y + 2}" width="${sx(x.ppsf) - left}" height="${rh - 6}" rx="2" fill="${STATUS_COLOR[c.status]}"/><text x="${sx(x.ppsf) + 5}" y="${y + 13}" font-size="11" fill="${INK}">$${x.ppsf.toFixed(0)}</text>`;
    })
    .join('');
  const med =
    r.soldPpsfMedian !== undefined
      ? `<line x1="${sx(r.soldPpsfMedian)}" x2="${sx(r.soldPpsfMedian)}" y1="${top - 8}" y2="${H - 24}" stroke="${INK}" stroke-width="1.5" stroke-dasharray="5 4"/><text x="${sx(r.soldPpsfMedian)}" y="${top - 12}" font-size="10.5" text-anchor="middle" fill="${INK}">sold median $${r.soldPpsfMedian.toFixed(0)}</text>`
      : '';
  const subj =
    subjectPpsf !== undefined
      ? `<line x1="${sx(subjectPpsf)}" x2="${sx(subjectPpsf)}" y1="${top - 8}" y2="${H - 24}" stroke="#e2583a" stroke-width="2.5"/><text x="${sx(subjectPpsf)}" y="${top - 24}" font-size="10.5" font-weight="700" text-anchor="middle" fill="#c8452c">subject at mid price $${subjectPpsf.toFixed(0)}</text>`
      : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price per square foot by comparable" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, system-ui, sans-serif">${legend(left, 6)}${grid}${bars}${med}${subj}</svg>`;
}

/** Count of listings per status with each median days on market. */
export function statusChart(r: CmaResult): string {
  const W = 700;
  const rh = 34;
  const H = 20 + r.stats.length * rh;
  const max = Math.max(1, ...r.stats.map((s) => s.count));
  const left = 90;
  const bw = 380;
  const rowsSvg = r.stats
    .map((s, i) => {
      const y = 10 + i * rh;
      const w = (bw * s.count) / max;
      const dom = s.medianDom !== undefined ? `median ${s.medianDom.toFixed(0)} days on market` : 'no days on market data';
      return `<text x="${left - 10}" y="${y + 19}" font-size="13" text-anchor="end" fill="${INK}">${STATUS_LABEL[s.status]}</text><rect x="${left}" y="${y + 4}" width="${Math.max(w, 2)}" height="22" rx="3" fill="${STATUS_COLOR[s.status]}"/><text x="${left + Math.max(w, 2) + 8}" y="${y + 20}" font-size="13" font-weight="700" fill="${INK}">${s.count}</text><text x="${left + bw + 50}" y="${y + 20}" font-size="12" fill="${MUTED}">${dom}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Listings by status" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, system-ui, sans-serif">${rowsSvg}</svg>`;
}

/** Relative positions from latitude and longitude. Not a street map. */
export function locationPlot(r: CmaResult, subject: { lat?: number; lng?: number }): string {
  const pts = r.rows.flatMap((x) => (x.comp.lat !== undefined && x.comp.lng !== undefined ? [{ x: x.comp.lng, y: x.comp.lat, n: x.index, s: x.comp.status }] : []));
  if (!pts.length) return '';
  const hasSubject = subject.lat !== undefined && subject.lng !== undefined;
  const all = hasSubject ? [...pts, { x: subject.lng ?? 0, y: subject.lat ?? 0, n: 0, s: 'sold' as Status }] : pts;
  const lat0 = all.reduce((t, p) => t + p.y, 0) / all.length;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  const px = all.map((p) => p.x * kx);
  const py = all.map((p) => -p.y);
  const minX = Math.min(...px);
  const maxX = Math.max(...px);
  const minY = Math.min(...py);
  const maxY = Math.max(...py);
  const W = 700;
  const H = 340;
  const pad = 40;
  const span = Math.max(maxX - minX, maxY - minY, 1e-9);
  const scale = Math.min((W - 2 * pad) / span, (H - 2 * pad - 20) / span);
  const ox = (W - (maxX - minX) * scale) / 2;
  const oy = (H + 16 - (maxY - minY) * scale) / 2;
  const X = (v: number) => ox + (v - minX) * scale;
  const Y = (v: number) => oy + (v - minY) * scale;
  const dots = pts
    .map((p) => `<circle cx="${X(p.x * kx).toFixed(1)}" cy="${Y(-p.y).toFixed(1)}" r="11" fill="${STATUS_COLOR[p.s]}" stroke="#fff" stroke-width="1.5"/><text x="${X(p.x * kx).toFixed(1)}" y="${(Y(-p.y) + 4).toFixed(1)}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">${p.n}</text>`)
    .join('');
  const subj = hasSubject
    ? `<rect x="${X((subject.lng ?? 0) * kx) - 11}" y="${Y(-(subject.lat ?? 0)) - 11}" width="22" height="22" rx="3" fill="#e2583a" stroke="#fff" stroke-width="1.5"/><text x="${X((subject.lng ?? 0) * kx)}" y="${Y(-(subject.lat ?? 0)) + 4}" font-size="11" font-weight="700" text-anchor="middle" fill="#fff">S</text>`
    : '';
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Relative locations of the subject and comparables" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, system-ui, sans-serif"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="6" fill="#f7f2ec" stroke="#d9cfc4"/>${legend(pad - 10, 12)}${dots}${subj}<text x="${W / 2}" y="${H - 8}" font-size="10.5" text-anchor="middle" fill="${MUTED}">Relative positions from the coordinates in your data. Not a street map and not to a stated scale. S is the subject.</text></svg>`;
}

export function rangeBar(low: number, mid: number, high: number): string {
  const W = 700;
  const H = 70;
  const a = 60;
  const b = 640;
  const span = Math.max(high - low, 1);
  const pad = span * 0.25;
  const min = low - pad;
  const max = high + pad;
  const sx = (v: number) => a + ((b - a) * (v - min)) / (max - min);
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Suggested list price range" xmlns="http://www.w3.org/2000/svg" font-family="Segoe UI, system-ui, sans-serif"><rect x="${a}" y="28" width="${b - a}" height="6" rx="3" fill="#e7dfd5"/><rect x="${sx(low)}" y="22" width="${sx(high) - sx(low)}" height="18" rx="4" fill="#2b7a6b"/><line x1="${sx(mid)}" x2="${sx(mid)}" y1="16" y2="46" stroke="${INK}" stroke-width="2.5"/><text x="${sx(low)}" y="62" font-size="12" text-anchor="middle" fill="${INK}">${money0(low)}</text><text x="${sx(mid)}" y="12" font-size="12" font-weight="700" text-anchor="middle" fill="${INK}">${money0(mid)}</text><text x="${sx(high)}" y="62" font-size="12" text-anchor="middle" fill="${INK}">${money0(high)}</text></svg>`;
}
