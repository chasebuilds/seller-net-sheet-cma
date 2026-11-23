// Builds the app, serves dist/, writes docs/preview.png and counts printed PDF pages.
// Needs Playwright with a Chromium install. Point PLAYWRIGHT_PATH at a node_modules folder that has it if it is not installed here.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const require = createRequire(process.env.PLAYWRIGHT_PATH ? join(resolve(process.env.PLAYWRIGHT_PATH), 'x.js') : import.meta.url);
const { chromium } = require('playwright');

const root = resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = createServer(async (req, res) => {
  const p = (req.url ?? '/').split('?')[0];
  try {
    const body = await readFile(join(root, p === '/' ? 'index.html' : p));
    res.writeHead(200, { 'content-type': types[extname(p === '/' ? 'x.html' : p)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(4179, ok));
const base = 'http://localhost:4179/';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(`${base}#net`);
await page.waitForSelector('.sheet-page');
await page.screenshot({ path: 'docs/preview.png' });
await page.goto(`${base}#buyer`);
await page.waitForSelector('#buyer-live .sheet-page');
await page.screenshot({ path: 'docs/preview-buyer.png' });
await page.goto(`${base}#cma`);
await page.waitForSelector('#cma-out svg');
await page.screenshot({ path: 'docs/preview-cma.png', fullPage: true });

const counts = {};
for (const mode of ['sheet', 'buyer', 'deck']) {
  const p = await browser.newPage();
  await p.goto(`${base}?print=${mode}`);
  await p.waitForSelector('#print-root .page', { state: 'attached' });
  const pdf = await p.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true, path: `docs/_${mode}.pdf` });
  counts[mode] = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  await p.close();
}
const narrow = await browser.newPage({ viewport: { width: 375, height: 800 } });
const widths = {};
for (const t of ['net', 'buyer', 'cma', 'deck']) {
  await narrow.goto(`${base}#${t}`);
  await narrow.reload();
  await narrow.waitForTimeout(250);
  widths[t] = await narrow.evaluate(() => document.documentElement.scrollWidth);
}
console.log(JSON.stringify({ pdfPages: counts, widthAt375: widths, errors }));
await browser.close();
server.close();
