import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
await page.goto('http://localhost:4322/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

// What is at the center-bottom of the gauge (the dark pill)?
const info = await page.evaluate(() => {
  const gauge = document.querySelector('.gauge');
  const r = gauge.getBoundingClientRect();
  // sample a point near bottom-center of the gauge
  const x = r.left + r.width / 2;
  const y = r.bottom - 6;
  const el = document.elementFromPoint(x, y);
  const chain = [];
  let e = el;
  while (e && chain.length < 6) {
    chain.push({ tag: e.tagName, id: e.id, cls: e.className?.toString?.().slice(0, 60), z: getComputedStyle(e).zIndex, pos: getComputedStyle(e).position });
    e = e.parentElement;
  }
  // arc state
  const arc = document.getElementById('gauge-arc');
  const needle = document.getElementById('gauge-needle');
  return {
    point: { x: Math.round(x), y: Math.round(y) },
    chain,
    arcOffset: arc?.style.strokeDashoffset,
    needleTransform: needle?.style.transform,
    goHidden: document.getElementById('go-btn')?.hasAttribute('hidden'),
    readoutHidden: document.getElementById('gauge-readout')?.hasAttribute('hidden'),
  };
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
