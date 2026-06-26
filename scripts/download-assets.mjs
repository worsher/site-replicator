import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';

const { values } = parseArgs({
  options: {
    network: { type: 'string' },
    html: { type: 'string' },
    out: { type: 'string' },
    referer: { type: 'string' }, // 可选：破防盗链用的页面 Referer；不传则从 network.json 推导
  },
});
if (!values.network || !values.out) {
  console.error('usage: node download-assets.mjs --network <network.json> --html <dom.html> --out <dir> [--referer <page-url>]');
  process.exit(1);
}
const out = values.out;
const STATIC = new Set(['stylesheet', 'image', 'font', 'script', 'media']);

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

async function download(u) {
  if (seen.has(u)) return map[u] || null;
  seen.add(u);
  const rel = localPathFor(u);
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
  return local;
}

// 1) network.json 里记录的静态资源
for (const r of network) {
  if (!STATIC.has(r.resourceType)) continue;
  if (r.status >= 400) continue;
  await download(r.url);
}

// 2) 补抓 network 漏掉的资源：从 dom.html 的 data-original/src/srcset 与已下载 CSS 的 url()
//    解析出引用 URL。懒加载真图、视口外的背景图常不出现在 network.json 中，必须主动补抓。
// base 必须是“该文本来源的原始 URL”：HTML 用页面 URL，CSS 用该 CSS 自身的原始 URL。
// 否则根绝对路径(/public/...)会被错误解析到页面 host，而非 CSS 所在的 CDN host。
function extractRefs(text, base) {
  const found = new Set();
  for (const m of text.matchAll(/(?:data-original|data-src|src|href)\s*=\s*["']([^"']+)["']/g)) found.add(m[1]);
  for (const m of text.matchAll(/srcset\s*=\s*["']([^"']+)["']/g)) {
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

const refTexts = [];
if (values.html) refTexts.push({ text: await readFile(values.html, 'utf8'), base: pageBase });
for (const local of Object.values(map)) {
  if (!local.endsWith('.css')) continue;
  try {
    refTexts.push({ text: await readFile(path.join(out, local), 'utf8'), base: localToOrig[local] || pageBase });
  } catch {}
}
const extra = new Set();
for (const { text, base } of refTexts) for (const u of extractRefs(text, base)) extra.add(u);
let extraCount = 0;
for (const u of extra) {
  if (map[u] || seen.has(u)) continue;
  if (await download(u)) extraCount++;
}

await writeFile(path.join(out, 'asset-map.json'), JSON.stringify(map, null, 2), 'utf8');

// 引用重写：HTML 用相对 out 根的路径；CSS 用相对“该 CSS 文件目录”的路径
// （深层目录的 CSS 若用 out 根相对路径，浏览器会相对 CSS 自身再次解析而 404）。
function toRel(local, fromDir) {
  return fromDir
    ? (path.relative(fromDir, path.join(out, local)).split(path.sep).join('/') || path.basename(local))
    : local;
}

// pathname → local 反查（供 url() 兜底用）
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
    let p;
    try { p = new URL(orig).pathname; } catch { continue; }
    // 规范形式：根绝对 pathname 的引号形式与 CSS url() 各变体（保留原引号风格）
    for (const form of [`"${p}"`, `'${p}'`, `url(${p})`, `url("${p}")`, `url('${p}')`]) {
      result = result.split(form).join(form.replace(p, target));
    }
  }
  // url(...) 兜底：容忍畸形引号（如原站 CSS 的 `url(path')` 笔误），按 pathname 匹配 map。
  // 对已替换好的相对路径用 baseUrl 解析回原 pathname → 幂等，不会二次破坏。
  if (baseUrl) {
    result = result.replace(/url\(\s*['"]?\s*([^)'"\s]+)\s*['"]?\s*\)/g, (whole, ref) => {
      if (/^(data:|blob:)/i.test(ref)) return whole;
      // 只兜“仍指向原始位置”的引用（完整 URL 或根绝对路径）；
      // 已相对化的产物（如 logo.png、../img.png）跳过，避免规范化误改。
      if (!/^(https?:|\/)/i.test(ref)) return whole;
      let pathname;
      try { pathname = new URL(ref, baseUrl).pathname; } catch { return whole; }
      const local = byPath[pathname];
      if (!local) return whole;
      return `url("${toRel(local, fromDir)}")`;
    });
  }
  return result;
}

if (values.html) {
  const html = await readFile(values.html, 'utf8');
  await writeFile(path.join(out, 'index.html'), rewrite(html, null, pageBase), 'utf8');
}

// 重写已下载的 css 文件中的 url() 引用（相对各自所在目录；按各自原始 URL 解析）
for (const local of Object.values(map)) {
  if (!local.endsWith('.css')) continue;
  const abs = path.join(out, local);
  const css = await readFile(abs, 'utf8');
  await writeFile(abs, rewrite(css, path.dirname(abs), localToOrig[local] || pageBase), 'utf8');
}

console.log(JSON.stringify({ ok: true, downloaded: Object.keys(map).length, extra: extraCount }));
