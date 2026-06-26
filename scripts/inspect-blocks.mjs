import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    sel: { type: 'string' },
    width: { type: 'string', default: '1440' },
  },
});

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: parseInt(values.width, 10), height: 900 } });
  const page = await ctx.newPage();
  await page.goto(values.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  await page.evaluate(async () => {
    const s = (ms) => new Promise((r) => setTimeout(r, ms));
    const vh = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += Math.round(vh * 0.8)) { window.scrollTo(0, y); await s(200); }
    window.scrollTo(0, 0); await s(600);
  });
  const rows = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return [...root.children].map((el, i) => {
      const h = el.querySelector('h1,h2');
      return {
        i,
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 48),
        height: Math.round(el.getBoundingClientRect().height),
        heading: h ? h.textContent.trim().replace(/\s+/g, ' ').slice(0, 42) : '',
      };
    });
  }, values.sel);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
}
