// 轮播冻结 DOM 还原：把序列化快照里 owl/slick/swiper 的运行态 markup 恢复成干净的原始 slide 列表，
// 让站点自带 JS 在 clone 里按当前视口重新初始化（详见 06-animation.md 前置节「轮播/滑块」）。
// 用法: node restore-carousels.mjs --dir <目录>   # 处理目录下所有 *.html
//       node restore-carousels.mjs --html <文件>  # 处理单个文件
import { chromium } from 'playwright';
import { readdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';

const { values } = parseArgs({ options: { dir: { type: 'string' }, html: { type: 'string' } } });
if (!values.dir && !values.html) {
  console.error('usage: node restore-carousels.mjs --dir <目录> | --html <文件>');
  process.exit(1);
}
const files = values.html
  ? [path.resolve(values.html)]
  : readdirSync(values.dir).filter((f) => f.endsWith('.html')).map((f) => path.resolve(values.dir, f));

const b = await chromium.launch();
const ctx = await b.newContext({ javaScriptEnabled: false }); // 禁 JS：只做 DOM 手术，不让站点脚本跑

for (const f of files) {
  const page = await ctx.newPage();
  await page.goto('file://' + f, { waitUntil: 'domcontentloaded' });
  const stats = await page.evaluate(() => {
    const st = { owl: 0, slick: 0, swiperDup: 0 };
    // owl-carousel：收集非 clone 的原始 slide，替换掉 stage 结构
    document.querySelectorAll('.owl-carousel.owl-loaded').forEach((c) => {
      const items = [...c.querySelectorAll('.owl-item:not(.cloned)')].map((it) => it.firstElementChild).filter(Boolean);
      if (!items.length) return;
      c.innerHTML = '';
      items.forEach((el) => { el.removeAttribute('style'); c.appendChild(el); });
      c.className = c.className.replace(/\bowl-(loaded|drag|hidden|grab|rtl)\b/g, '').replace(/\s+/g, ' ').trim();
      c.removeAttribute('style');
      st.owl++;
    });
    // slick：取非 cloned slide，剥掉 list/track 壳与运行态属性（fade 模式的内联 left/opacity 一并清除）
    document.querySelectorAll('.slick-initialized').forEach((c) => {
      const slides = [...c.querySelectorAll('.slick-slide:not(.slick-cloned)')];
      if (!slides.length) return;
      slides.forEach((s) => {
        s.className = s.className.replace(/\bslick-[\w-]+\b/g, '').replace(/\s+/g, ' ').trim();
        ['style', 'tabindex', 'role', 'aria-hidden', 'aria-describedby', 'data-slick-index', 'id'].forEach((a) => s.removeAttribute(a));
      });
      c.innerHTML = '';
      slides.forEach((s) => c.appendChild(s));
      c.className = c.className.replace(/\bslick-(initialized|slider|dotted)\b/g, '').replace(/\s+/g, ' ').trim();
      st.slick++;
    });
    // swiper：去 loop duplicate、清 wrapper 内联 transform、去运行态类（保留 swiper/swiper-wrapper/swiper-slide 基类）
    document.querySelectorAll('.swiper-slide-duplicate').forEach((d) => { d.remove(); st.swiperDup++; });
    document.querySelectorAll('.swiper-wrapper').forEach((w) => { ['style', 'id', 'aria-live'].forEach((a) => w.removeAttribute(a)); });
    document.querySelectorAll('.swiper').forEach((c) => {
      c.className = c.className.replace(/\bswiper-(initialized|horizontal|vertical|pointer-events|backface-hidden)\b/g, '').replace(/\s+/g, ' ').trim();
    });
    document.querySelectorAll('.swiper-slide').forEach((s) => {
      s.className = s.className.replace(/\bswiper-slide-(active|next|prev|visible|duplicate-active|duplicate-next|duplicate-prev)\b/g, '').replace(/\s+/g, ' ').trim();
    });
    // bootstrap-select 等表单美化部件：序列化的生成壳 + JS 二次初始化 = 控件渲染两份（高度差级联位移）。
    // 还原成裸 <select>，让 JS 重新只初始化一次。（select2/chosen/nice-select 同理，按需扩展）
    st.select = 0;
    document.querySelectorAll('.bootstrap-select').forEach((w) => {
      const sel = w.querySelector('select');
      if (sel) {
        sel.className = sel.className.replace(/\bbs-select-hidden\b/g, '').trim();
        sel.removeAttribute('tabindex');
        w.replaceWith(sel);
        st.select++;
      }
    });
    return st;
  });
  const html = '<!DOCTYPE html>\n' + (await page.evaluate(() => document.documentElement.outerHTML));
  writeFileSync(f, html);
  console.log(JSON.stringify({ file: path.basename(f), ...stats }));
  await page.close();
}
await b.close();
