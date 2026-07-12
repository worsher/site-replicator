import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    breakpoints: { type: 'string', default: '1440,768,375' },
    timeout: { type: 'string', default: '60000' },
    'keep-motion': { type: 'boolean', default: false }, // 保留动画运行态（默认截图前冻结，保证像素对比可复现）
  },
});
const url = positionals[0];
if (!url || !values.out) {
  console.error('usage: node capture.mjs <url> --out <dir> [--breakpoints 1440,768,375] [--timeout 60000]');
  process.exit(1);
}
const out = values.out;
const breakpoints = values.breakpoints
  .split(',')
  .map((s) => parseInt(s.trim(), 10))
  .filter((n) => Number.isInteger(n) && n > 0);
if (breakpoints.length === 0) {
  console.error('error: no valid breakpoints');
  process.exit(1);
}
const navTimeout = parseInt(values.timeout, 10) || 60000;

await mkdir(path.join(out, 'screenshots'), { recursive: true });

const browser = await chromium.launch();
try {
  // 以首个断点为抓取视口：dom.html/network.json 反映桌面端布局（默认 context 是 1280，与 1440 断点不一致）
  const context = await browser.newContext({ viewport: { width: breakpoints[0], height: 900 } });
  const page = await context.newPage();

  const requests = [];
  page.on('response', (res) => {
    const req = res.request();
    requests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
      status: res.status(),
      contentType: res.headers()['content-type'] || '',
    });
  });

  await page.goto(url, { waitUntil: 'load', timeout: navTimeout });
  // best-effort settle for lazy-loaded assets; never hang on persistent connections
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});

  // 自动滚动到底再回顶：触发懒加载图与下方区块的 CSS 背景图请求，
  // 否则这些资源永不进入 network.json，后续 download-assets 无从下载（懒加载/视口外背景图漏抓的根因）。
  await page
    .evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      let last = -1;
      let same = 0;
      for (let i = 0; i < 100; i++) {
        window.scrollBy(0, Math.max(400, Math.floor(window.innerHeight * 0.8)));
        await sleep(120);
        const h = document.documentElement.scrollHeight;
        const atBottom = window.scrollY + window.innerHeight >= h - 2;
        if (h === last) same++;
        else { same = 0; last = h; }
        if (atBottom && same >= 2) break; // 到底且高度连续两轮稳定
      }
      // 强制把仍是占位符的懒加载图替换为真实图（让其发起请求并进入截图）；
      // 覆盖常见懒加载库的属性变体：lazysizes/LiteSpeed(data-src/data-lazy-src)、老 lazyload(data-original)
      document.querySelectorAll('img').forEach((img) => {
        const real =
          img.getAttribute('data-original') ||
          img.getAttribute('data-src') ||
          img.getAttribute('data-lazy-src') ||
          img.getAttribute('data-lazysrc');
        if (real && (!img.getAttribute('src') || img.src.startsWith('data:'))) img.setAttribute('src', real);
        const realSet = img.getAttribute('data-srcset') || img.getAttribute('data-lazy-srcset');
        if (realSet && !img.getAttribute('srcset')) img.setAttribute('srcset', realSet);
      });
      window.scrollTo(0, 0);
      await sleep(200);
    })
    .catch(() => {});
  // 等待滚动触发的新资源落地
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {});

  await writeFile(path.join(out, 'dom.html'), await page.content(), 'utf8');

  const tree = await page.evaluate(() => {
    const MAX_DEPTH = 5000;
    function ser(node, depth) {
      const className =
        node.className && typeof node.className === 'string'
          ? node.className.split(/\s+/).filter(Boolean)
          : undefined;
      return {
        tag: node.tagName ? node.tagName.toLowerCase() : undefined,
        id: node.id || undefined,
        classes: className && className.length ? className : undefined,
        children: depth >= MAX_DEPTH ? [] : [...node.children].map((c) => ser(c, depth + 1)),
      };
    }
    const root = document.body || document.documentElement;
    return root ? ser(root, 0) : null;
  });
  await writeFile(path.join(out, 'dom-tree.json'), JSON.stringify(tree, null, 2), 'utf8');
  await writeFile(path.join(out, 'network.json'), JSON.stringify(requests, null, 2), 'utf8');

  for (const bp of breakpoints) {
    await page.setViewportSize({ width: bp, height: 900 });
    // 换断点后等响应式布局/新宽度触发的图片请求稳定，再截图（否则窄断点常截到未加载完的图）
    await page.waitForTimeout(350);
    await page.waitForLoadState('networkidle', { timeout: 2000 }).catch(() => {});
    // 冻结 CSS/WAAPI 动画（有限动画快进到终态，无限动画取消回基态），否则两次抓取的
    // 旋转角/过渡进度必然不同，像素对比被稀释。JS 定时器驱动的 UI（轮播自动播、rAF 位移）
    // 冻结不了，属残留噪声，见 05-visual-verification 噪声源与 06-animation 的 DOM 级处理。
    if (!values['keep-motion']) {
      await page
        .evaluate(() => {
          for (const a of document.getAnimations()) {
            try {
              const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : {};
              if (t.iterations === Infinity) a.cancel();
              else a.finish();
            } catch {}
          }
        })
        .catch(() => {});
    }
    await page.screenshot({ path: path.join(out, 'screenshots', `${bp}.png`), fullPage: true });
  }

  console.log(JSON.stringify({ ok: true, out, breakpoints, requests: requests.length }));
} finally {
  await browser.close();
}
