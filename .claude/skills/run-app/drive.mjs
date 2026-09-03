// Drive the CAPA CI Tracker UI headlessly and screenshot each page.
// Must run with frontend/ as cwd so `playwright` resolves (it's a frontend dep).
import { chromium } from 'playwright';

const base = 'http://localhost:5173';
const routes = [
  { path: '/', name: 'activity' },
  { path: '/tickets', name: 'tickets' },
  { path: '/transactions', name: 'transactions' },
];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

for (const r of routes) {
  await page.goto(base + r.path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const shot = `/tmp/capa-${r.name}.png`;
  await page.screenshot({ path: shot, fullPage: true });
  const title = await page.title();
  const text = (await page.locator('body').innerText()).slice(0, 400).replace(/\n+/g, ' | ');
  console.log(`\n=== ${r.path} (${title}) -> ${shot}`);
  console.log('TEXT:', text);
}

console.log('\n=== CONSOLE ERRORS ===');
console.log(errors.length ? errors.join('\n') : '(none)');

await browser.close();
