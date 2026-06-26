import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string' }, sel: { type: 'string' } } });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(values.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const imgs = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return [...root.querySelectorAll('img')].map((im) => ({
      src: im.getAttribute('src') || im.getAttribute('data-src'),
      alt: im.getAttribute('alt'),
      w: im.naturalWidth,
      h: im.naturalHeight,
    }));
  }, values.sel);
  console.log(JSON.stringify(imgs, null, 2));
} finally {
  await browser.close();
}
