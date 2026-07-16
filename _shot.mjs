import { chromium } from 'playwright';

const URL = process.env.SHOT_URL || 'http://localhost:4322/';
const OUT = process.env.SHOT_OUT || 'shot.png';
const THEME = process.env.SHOT_THEME || 'light';
const WIDTH = parseInt(process.env.SHOT_W || '1280', 10);
const HEIGHT = parseInt(process.env.SHOT_H || '900', 10);
const FULL = process.env.SHOT_FULL === '1';
const CLIP = process.env.SHOT_CLIP; // "x,y,w,h"
const WAIT = parseInt(process.env.SHOT_WAIT || '1800', 10);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 2,
  colorScheme: THEME === 'dark' ? 'dark' : 'light',
});
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });

await page.addInitScript((t) => {
  try { localStorage.setItem('meter:theme', t); } catch {}
}, THEME);

await page.goto(URL, { waitUntil: 'networkidle' });
await page.addStyleTag({ content: 'astro-dev-toolbar{display:none !important}' });
await page.waitForTimeout(WAIT); // let intro sweep settle

const opts = { path: OUT };
if (FULL) opts.fullPage = true;
if (CLIP) {
  const [x, y, w, h] = CLIP.split(',').map(Number);
  opts.clip = { x, y, width: w, height: h };
}
await page.screenshot(opts);
console.log('shot ->', OUT, 'theme=' + THEME, 'errors=' + errors.length);
errors.slice(0, 8).forEach((e) => console.log('  ', e));
await browser.close();
