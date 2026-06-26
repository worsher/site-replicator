import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string' }, sel: { type: 'string' } } });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(values.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const rows = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return [...root.children].map((el, i) => ({
      i,
      h: (el.querySelector('h1,h2') || {}).textContent?.trim().replace(/\s+/g, ' ') || '',
      text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 500),
    }));
  }, values.sel);
  console.log(JSON.stringify(rows, null, 2));
} finally {
  await browser.close();
}
