// 确定态截图：两侧（原站/克隆）用同一脚本，消除 JS 运行态时序差异
// 用法: node det-shot.mjs <url> <outdir> [--block-3p]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const [url, outdir] = process.argv.slice(2);
const block3p = process.argv.includes('--block-3p');
const BLOCK = /xiaoman|googletagmanager|googleads|doubleclick|googleadservices|sensorsdata|clarity|facebook|analyze/;

const b = await chromium.launch();
mkdirSync(outdir, { recursive: true });
for (const w of [1440, 768, 375]) {
  const page = await b.newPage({ viewport: { width: w, height: 900 } });
  if (block3p) await page.route('**/*', r => BLOCK.test(r.request().url()) ? r.abort() : r.continue());
  // 记录所有定时器 id，稍后统一清除
  await page.addInitScript(() => {
    window.__ivs = []; window.__tos = [];
    const oi = window.setInterval, ot = window.setTimeout;
    window.setInterval = function (...a) { const id = oi.apply(window, a); window.__ivs.push(id); return id; };
    window.setTimeout = function (...a) { const id = ot.apply(window, a); window.__tos.push(id); return id; };
  });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(2500); // 等插件初始化
  // 滚动全页触发懒加载
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 90)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(800);
  // 停表 + 轮播归零
  await page.evaluate(() => {
    // 剥离克隆侧静态重建的三方 UI（data-rep-3p 标记），与原站侧 --block-3p 屏蔽对齐
    document.querySelectorAll('[data-rep-3p]').forEach(el => el.remove());
    (window.__ivs || []).forEach(clearInterval);
    (window.__tos || []).forEach(clearTimeout);
    const $ = window.jQuery;
    if ($) {
      try { $('.owl-carousel.owl-loaded').trigger('stop.owl.autoplay').trigger('to.owl.carousel', [0, 0, true]); } catch (e) {}
      try { $('.slick-initialized').slick('slickSetOption', 'autoplay', false, false).slick('slickGoTo', 0, true); } catch (e) {}
    }
    document.querySelectorAll('.swiper').forEach(el => {
      const s = el.swiper; if (s) { try { s.autoplay && s.autoplay.stop(); (s.slideToLoop || s.slideTo).call(s, 0, 0, false); } catch (e) {} }
    });
    // 兜底：点击各轮播第一个圆点（dot 导航跨库通用，loop 模式下比索引归位更确定）
    document.querySelectorAll('.owl-dots, .slick-dots, .swiper-pagination').forEach(box => {
      const first = box.querySelector('button, .owl-dot, li, .swiper-pagination-bullet');
      if (first) { try { first.click(); } catch (e) {} }
    });
    // wow.js 揭示全部显示
    document.querySelectorAll('.wow').forEach(el => { el.style.visibility = 'visible'; el.style.animationName = 'none'; el.style.opacity = ''; });
    window.scrollTo(0, 0);
  });
  // 冻结 CSS 动画/过渡
  await page.addStyleTag({ content: '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}' });
  // 等全部可见图片加载完成（远程侧网络慢，不等会截出空白图 → 与本地克隆形成假差异）
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForFunction(
    () => [...document.images].every(i => !i.offsetParent || (i.complete && i.naturalWidth > 0) || !i.getAttribute('src')),
    { timeout: 25000 }
  ).catch(() => {});
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${outdir}/${w}.png`, fullPage: true });
  await page.close();
  console.log(JSON.stringify({ w, ok: true }));
}
await b.close();
