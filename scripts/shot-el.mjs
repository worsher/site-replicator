import { chromium } from 'playwright';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    url: { type: 'string' },
    sel: { type: 'string' },
    out: { type: 'string' },
    width: { type: 'string', default: '1440' },
    timeout: { type: 'string', default: '30000' },
  },
});

const width = parseInt(values.width, 10);
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.goto(values.url, { waitUntil: 'load', timeout: parseInt(values.timeout, 10) });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  // 逐屏慢滚：每屏停留让 IntersectionObserver 回调 flush（触发 scroll-reveal），
  // 再回顶等动画完成，避免把入场动画的 opacity:0 误截成空白
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const vh = window.innerHeight;
    const total = () => document.body.scrollHeight;
    for (let y = 0; y < total(); y += Math.round(vh * 0.8)) {
      window.scrollTo(0, y);
      await sleep(250);
    }
    window.scrollTo(0, total());
    await sleep(400);
    window.scrollTo(0, 0);
    await sleep(1000); // 等 Reveal 的 opacity/transform transition 完成
  });
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  const el = await page.$(values.sel);
  if (!el) { console.error('SELECTOR_NOT_FOUND:', values.sel); process.exit(2); }
  await el.screenshot({ path: values.out });
  const box = await el.boundingBox();
  console.log(JSON.stringify({ ok: true, out: values.out, box }));
} finally {
  await browser.close();
}
