import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';

const { values } = parseArgs({
  options: {
    network: { type: 'string' },
    html: { type: 'string' },
    out: { type: 'string' },
    referer: { type: 'string' }, // 可选：破防盗链用的页面 Referer；不传则从 network.json 推导
    map: { type: 'string' }, // 可选：站点级共享 asset-map.json（读取合并 + 已落盘资源跳过下载，整站模式跨页去重）
    'html-out': { type: 'string' }, // 可选：重写后 HTML 输出路径（默认 <out>/index.html）
    concurrency: { type: 'string', default: '8' }, // 并发下载数
    'keep-lazy': { type: 'boolean', default: false }, // 保留懒加载占位标记（默认恢复真实 src/srcset 并剥离 LiteSpeed loader）
  },
});
if (!values.network || !values.out) {
  console.error(
    'usage: node download-assets.mjs --network <network.json> --html <dom.html> --out <dir> [--referer <page-url>] [--map <asset-map.json>] [--html-out <file>] [--concurrency 8] [--keep-lazy]',
  );
  process.exit(1);
}
const out = values.out;
const STATIC = new Set(['stylesheet', 'image', 'font', 'script', 'media']);
// resourceType 跨 Playwright 版本/手工整理的 network.json 中不可靠，按扩展名兜底识别静态资源
const ASSET_EXT = /\.(css|js|mjs|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav)$/i;
const concurrency = Math.max(1, parseInt(values.concurrency, 10) || 8);

const network = JSON.parse(await readFile(values.network, 'utf8'));

// Referer 推导：很多 CDN 有防盗链，裸 fetch 会 403。优先 --referer，
// 否则取 network 里首条 document 请求 URL，再否则用首条资源的 origin。
let referer = values.referer;
if (!referer) {
  const doc = network.find((r) => r.resourceType === 'document' && r.url);
  if (doc) referer = doc.url;
  else if (network[0] && network[0].url) {
    try { referer = new URL(network[0].url).origin + '/'; } catch {}
  }
}
const pageBase = referer || (network[0] && network[0].url) || 'http://localhost/';
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  ...(referer ? { Referer: referer } : {}),
};

const seen = new Set();
const map = {};
const claimed = new Map(); // 本地路径 → 首个占用它的 host（跨 host 撞同一 pathname 时给后来者加 host 目录，防互相覆盖）
let fetched = 0;

// 站点级共享 map：已在 map 且文件已落盘的 URL 直接复用，不再下载
const mapOut = values.map || path.join(out, 'asset-map.json');
if (values.map && existsSync(values.map)) {
  for (const [u, local] of Object.entries(JSON.parse(await readFile(values.map, 'utf8')))) {
    map[u] = local;
    try { claimed.set(local, new URL(u).host); } catch {}
    if (existsSync(path.join(out, local))) seen.add(u); // 文件缺失则允许重新下载
  }
}

// 由 URL 推导本地相对路径（去前导 /，防目录穿越；带 query 的资源用 query 哈希避免碰撞覆盖）
function localPathFor(u) {
  const url = new URL(u);
  let p = url.pathname.replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index';
  p = p.split('/').filter((s) => s && s !== '..').join('/');
  if (url.search) {
    const h = createHash('sha1').update(url.search).digest('hex').slice(0, 8);
    const ext = path.extname(p);
    p = ext ? `${p.slice(0, -ext.length)}-${h}${ext}` : `${p}-${h}`;
  }
  return path.join('assets', p);
}

// 认领本地路径：同步执行（先于任何 await，并发安全）；不同 host 撞同一路径时落到 assets/<host>/ 下
function claimLocalPath(u) {
  const url = new URL(u);
  let rel = localPathFor(u);
  const owner = claimed.get(rel);
  if (owner !== undefined && owner !== url.host) {
    rel = rel.replace(/^assets\//, `assets/${url.host.replace(/:/g, '_')}/`);
  }
  claimed.set(rel, url.host);
  return rel;
}

async function download(u) {
  if (seen.has(u)) return map[u] || null;
  seen.add(u);
  const rel = claimLocalPath(u);
  const abs = path.join(out, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  let resp;
  try {
    resp = await fetch(u, { signal: AbortSignal.timeout(30000), headers: FETCH_HEADERS });
  } catch (err) {
    console.error('skip (fetch error):', u, err.message);
    return null;
  }
  if (!resp.ok) {
    console.error('skip (fetch failed):', u, resp.status);
    return null;
  }
  await writeFile(abs, Buffer.from(await resp.arrayBuffer()));
  const local = rel.split(path.sep).join('/');
  map[u] = local;
  fetched++;
  return local;
}

// 并发池：concurrency 个 worker 消费同一队列（seen 去重在 download 内同步完成）
async function downloadAll(urls) {
  let i = 0;
  const workers = Math.min(concurrency, urls.length) || 1;
  await Promise.all(
    Array.from({ length: workers }, async () => {
      while (i < urls.length) await download(urls[i++]);
    }),
  );
}

// 1) network.json 里记录的静态资源（resourceType 命中 或 扩展名兜底命中）
const fromNetwork = new Set();
for (const r of network) {
  if (r.status >= 400) continue;
  let extOk = false;
  try { extOk = ASSET_EXT.test(new URL(r.url).pathname); } catch { continue; }
  if (!STATIC.has(r.resourceType) && !extOk) continue;
  fromNetwork.add(r.url);
}
await downloadAll([...fromNetwork]);

// 懒加载/LiteSpeed 运行态还原：占位 src → 真实 src/srcset，恢复被延迟的 script/link，
// 剥离 LiteSpeed 专用 loader（type="litespeed/javascript"、data-no-optimize 存根）。
// 静态 clone 没有服务端 optimizer 运行时，这些标记不还原会导致图片空白、脚本不执行。
function unlazyHtml(html) {
  html = html.replace(/<img\b[^>]*>/gi, (tag) => {
    let t = tag;
    const src = /\sdata-(?:src|lazy-src|lazysrc|original)="([^"]*)"/i.exec(t);
    const srcset = /\sdata-(?:srcset|lazy-srcset)="([^"]*)"/i.exec(t);
    const sizes = /\sdata-sizes="([^"]*)"/i.exec(t);
    if (src) t = /\ssrc="[^"]*"/i.test(t) ? t.replace(/\ssrc="[^"]*"/i, ` src="${src[1]}"`) : t.replace(/<img/i, `<img src="${src[1]}"`);
    if (srcset) t = /\ssrcset="[^"]*"/i.test(t) ? t.replace(/\ssrcset="[^"]*"/i, ` srcset="${srcset[1]}"`) : t.replace(/<img/i, `<img srcset="${srcset[1]}"`);
    if (sizes && !/\ssizes="[^"]*"/i.test(t)) t = t.replace(/<img/i, `<img sizes="${sizes[1]}"`);
    return t.replace(/\sdata-lazyloaded="[^"]*"/gi, '');
  });
  html = html.replace(/<script\b[^>]*data-no-optimize="1"[^>]*>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/type="litespeed\/javascript"/gi, 'type="text/javascript"');
  html = html.replace(/(<script\b[^>]*?)\sdata-src="([^"]*)"/gi, '$1 src="$2"');
  html = html.replace(/(<link\b[^>]*?)\sdata-src="([^"]*)"/gi, '$1 href="$2"');
  return html;
}

// 2) 补抓 network 漏掉的资源：从 dom.html 的 data-original/src/srcset 与已下载 CSS 的 url()
//    解析出引用 URL。懒加载真图、视口外的背景图常不出现在 network.json 中，必须主动补抓。
// base 必须是“该文本来源的原始 URL”：HTML 用页面 URL，CSS 用该 CSS 自身的原始 URL。
// 否则根绝对路径(/public/...)会被错误解析到页面 host，而非 CSS 所在的 CDN host。
function extractRefs(text, base) {
  const found = new Set();
  for (const m of text.matchAll(/(?:data-original|data-src|data-lazy-src|data-lazysrc|src|href)\s*=\s*["']([^"']+)["']/g)) found.add(m[1]);
  for (const m of text.matchAll(/(?:data-(?:lazy-)?)?srcset\s*=\s*["']([^"']+)["']/g)) {
    for (const part of m[1].split(',')) {
      const u = part.trim().split(/\s+/)[0];
      if (u) found.add(u);
    }
  }
  for (const m of text.matchAll(/url\(\s*['"]?([^)'"\s]+)['"]?\s*\)/g)) found.add(m[1]);

  const urls = [];
  for (let u of found) {
    u = (u || '').trim();
    if (!u || /^(data:|blob:|#|javascript:|mailto:|tel:)/i.test(u)) continue;
    let abs;
    try { abs = new URL(u, base).href; } catch { continue; }
    // 只补抓图片/字体/媒体类（避免误抓接口/HTML/JS chunk）
    if (!/\.(png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|ogg|mp3|wav)(\?|#|$)/i.test(abs)) continue;
    urls.push(abs);
  }
  return urls;
}

// 反查 本地路径 → 原始 URL，供 CSS 内引用按其自身 host 解析
const localToOrig = {};
for (const [orig, local] of Object.entries(map)) if (!(local in localToOrig)) localToOrig[local] = orig;

let pageHtml = null;
if (values.html) {
  pageHtml = await readFile(values.html, 'utf8');
  if (!values['keep-lazy']) pageHtml = unlazyHtml(pageHtml);
}

const refTexts = [];
if (pageHtml !== null) refTexts.push({ text: pageHtml, base: pageBase });
for (const local of Object.values(map)) {
  if (!local.endsWith('.css')) continue;
  try {
    refTexts.push({ text: await readFile(path.join(out, local), 'utf8'), base: localToOrig[local] || pageBase });
  } catch {}
}
const extra = new Set();
for (const { text, base } of refTexts) for (const u of extractRefs(text, base)) extra.add(u);
const fetchedBeforeExtra = fetched;
await downloadAll([...extra].filter((u) => !map[u] && !seen.has(u)));
const extraCount = fetched - fetchedBeforeExtra;

await mkdir(path.dirname(mapOut), { recursive: true });
await writeFile(mapOut, JSON.stringify(map, null, 2), 'utf8');

// 引用重写：HTML 用相对 html-out 所在目录的路径；CSS 用相对“该 CSS 文件目录”的路径
// （深层目录的 CSS 若用 out 根相对路径，浏览器会相对 CSS 自身再次解析而 404）。
function toRel(local, fromDir) {
  return fromDir
    ? (path.relative(fromDir, path.join(out, local)).split(path.sep).join('/') || path.basename(local))
    : local;
}

// pathname → local 反查（供 url()/srcset 兜底用；优先按完整 URL 查 map，pathname 仅兜底）
const byPath = {};
for (const [orig, local] of Object.entries(map)) {
  try { byPath[new URL(orig).pathname] = local; } catch {}
}

function rewrite(text, fromDir, baseUrl) {
  let result = text;
  const entries = Object.entries(map).sort(([a], [b]) => b.length - a.length);
  for (const [orig, local] of entries) {
    const target = toRel(local, fromDir);
    result = result.split(orig).join(target);
    // 协议相对形式（//host/path）：完整 URL 已先被替换，此处剩余的即真·协议相对引用
    const noScheme = orig.replace(/^https?:/, '');
    if (noScheme !== orig) result = result.split(noScheme).join(target);
    let p;
    try { p = new URL(orig).pathname; } catch { continue; }
    // 规范形式：根绝对 pathname 的引号形式与 CSS url() 各变体（保留原引号风格）
    for (const form of [`"${p}"`, `'${p}'`, `url(${p})`, `url("${p}")`, `url('${p}')`]) {
      result = result.split(form).join(form.replace(p, target));
    }
  }
  if (baseUrl) {
    // srcset/data-srcset：一个属性值里多条 <URL 描述符>，整体不命中上面的引号形式，需逐条重写。
    // 完整 URL 条目已被 split/join 替换为相对路径（不再以 / 或 http 开头），此处只处理根绝对残留。
    result = result.replace(/((?:data-(?:lazy-)?)?srcset)\s*=\s*(["'])([^"']*)\2/gi, (whole, attr, q, val) => {
      const items = val
        .split(',')
        .map((s) => {
          const item = s.trim();
          if (!item) return null;
          const [u, ...desc] = item.split(/\s+/);
          if (!/^(https?:|\/)/i.test(u)) return item;
          let resolved;
          try { resolved = new URL(u, baseUrl); } catch { return item; }
          const local = map[resolved.href] || byPath[resolved.pathname];
          if (!local) return item;
          return [toRel(local, fromDir), ...desc].join(' ');
        })
        .filter(Boolean);
      return `${attr}=${q}${items.join(', ')}${q}`;
    });
    // url(...) 兜底：容忍畸形引号（如原站 CSS 的 `url(path')` 笔误），按解析后 URL/pathname 匹配 map。
    // 对已替换好的相对路径用 baseUrl 解析回原 pathname → 幂等，不会二次破坏。
    result = result.replace(/url\(\s*['"]?\s*([^)'"\s]+)\s*['"]?\s*\)/g, (whole, ref) => {
      if (/^(data:|blob:)/i.test(ref)) return whole;
      // 只兜“仍指向原始位置”的引用（完整 URL 或根绝对路径）；
      // 已相对化的产物（如 logo.png、../img.png）跳过，避免规范化误改。
      if (!/^(https?:|\/)/i.test(ref)) return whole;
      let resolved;
      try { resolved = new URL(ref, baseUrl); } catch { return whole; }
      const local = map[resolved.href] || byPath[resolved.pathname];
      if (!local) return whole;
      return `url("${toRel(local, fromDir)}")`;
    });
  }
  return result;
}

if (pageHtml !== null) {
  const htmlOut = values['html-out'] || path.join(out, 'index.html');
  await mkdir(path.dirname(htmlOut), { recursive: true });
  await writeFile(htmlOut, rewrite(pageHtml, path.dirname(htmlOut), pageBase), 'utf8');
}

// 重写已下载的 css 文件中的 url() 引用（相对各自所在目录；按各自原始 URL 解析）
for (const local of Object.values(map)) {
  if (!local.endsWith('.css')) continue;
  const abs = path.join(out, local);
  let css;
  try { css = await readFile(abs, 'utf8'); } catch { continue; }
  await writeFile(abs, rewrite(css, path.dirname(abs), localToOrig[local] || pageBase), 'utf8');
}

console.log(JSON.stringify({ ok: true, downloaded: fetched, mapped: Object.keys(map).length, extra: extraCount }));
