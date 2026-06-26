import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { url: { type: 'string' }, sel: { type: 'string' } } });
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(values.url, { waitUntil: 'load', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const data = await page.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    const links = [...root.querySelectorAll('a')].map((a) => {
      const img = a.querySelector('img');
      return {
        text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
        href: a.getAttribute('href'),
        img: img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null,
      };
    }).filter((l) => l.text || l.img);
    return links;
  }, values.sel);
  console.log(JSON.stringify(data, null, 2));
} finally {
  await browser.close();
}
