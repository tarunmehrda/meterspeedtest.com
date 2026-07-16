import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
page.on('console', m => { if (m.type()==='error') errors.push('CONSOLE: ' + m.text()); });

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle' });

// Intro sweep should be animating shortly after load: needle rotation changes
await page.waitForTimeout(250);
const rot1 = await page.getAttribute('#gauge-needle', 'transform');
await page.waitForTimeout(300);
const rot2 = await page.getAttribute('#gauge-needle', 'transform');
console.log('intro sweep animating:', rot1 !== rot2, `(${rot1?.slice(0,20)} -> ${rot2?.slice(0,20)})`);

async function runMode(modeBtn, label) {
  if (modeBtn) await page.click(`#mode button[data-mode="${modeBtn}"]`);
  const t0 = Date.now();
  await page.click('#start-btn');
  let status = '';
  for (let i = 0; i < 90; i++) {
    status = (await page.textContent('#status')) || '';
    if (/complete/i.test(status)) break;
    if (/went wrong|stopped/i.test(status)) break;
    await page.waitForTimeout(400);
  }
  const secs = (Date.now() - t0) / 1000;
  const dl = (await page.textContent('#m-download'))?.trim();
  const ul = (await page.textContent('#m-upload'))?.trim();
  const ping = (await page.textContent('#m-ping'))?.trim();
  console.log(`${label}: ${secs.toFixed(1)}s  |  ${dl} down / ${ul} up / ${ping} ms  |  ok: ${/complete/i.test(status)}`);
  return secs;
}

const quick = await runMode('quick', 'QUICK   ');
await page.waitForTimeout(800);
const balanced = await runMode('balanced', 'BALANCED');

// data-phase attribute drives gradient morph — check it landed on 'done'
console.log('gauge data-phase after run:', await page.getAttribute('[data-gauge]', 'data-phase'));
console.log('gauge data-state after run:', await page.getAttribute('[data-gauge]', 'data-state'));
console.log('insights entered class:', (await page.getAttribute('#insights','class'))?.includes('insights--enter'));
console.log('history rows:', await page.locator('#history-list .history__row').count());
console.log('JS errors:', errors.length);
errors.slice(0,8).forEach(e=>console.log('  ', e));
await browser.close();
const pass = quick < 10 && balanced < 15 && errors.length === 0;
console.log(pass ? 'TIMING PASS' : 'TIMING FAIL');
process.exit(pass ? 0 : 1);
