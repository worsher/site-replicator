import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import path from 'node:path';

const { values } = parseArgs({
  options: {
    network: { type: 'string' },
    html: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.network || !values.out) {
  console.error('usage: node download-assets.mjs --network <network.json> --html <dom.html> --out <dir>');
  process.exit(1);
}
const out = values.out;
const STATIC = new Set(['stylesheet', 'image', 'font', 'script', 'media']);

const network = JSON.parse(await readFile(values.network, 'utf8'));
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

for (const r of network) {
  if (!STATIC.has(r.resourceType)) continue;
  if (r.status >= 400) continue;
  if (seen.has(r.url)) continue;
  seen.add(r.url);
  const rel = localPathFor(r.url);
  const abs = path.join(out, rel);
  await mkdir(path.dirname(abs), { recursive: true });
  let resp;
  try {
    resp = await fetch(r.url, { signal: AbortSignal.timeout(30000) });
  } catch (err) {
    console.error('skip (fetch error):', r.url, err.message);
    continue;
  }
  if (!resp.ok) {
    console.error('skip (fetch failed):', r.url, resp.status);
    continue;
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(abs, buf);
  map[r.url] = rel.split(path.sep).join('/');
}

await writeFile(path.join(out, 'asset-map.json'), JSON.stringify(map, null, 2), 'utf8');

// 引用重写：长 URL 优先（避免前缀碰撞）；替换绝对 URL、引号包裹的 pathname、以及 url() 形式
function rewrite(text) {
  let result = text;
  const entries = Object.entries(map).sort(([a], [b]) => b.length - a.length);
  for (const [orig, local] of entries) {
    result = result.split(orig).join(local);
    const p = new URL(orig).pathname;
    result = result.split(`"${p}"`).join(`"${local}"`);
    result = result.split(`'${p}'`).join(`'${local}'`);
    result = result.split(`url(${p})`).join(`url(${local})`);
  }
  return result;
}

if (values.html) {
  const html = await readFile(values.html, 'utf8');
  await writeFile(path.join(out, 'index.html'), rewrite(html), 'utf8');
}

// 重写已下载的 css 文件中的 url() 引用
for (const local of Object.values(map)) {
  if (!local.endsWith('.css')) continue;
  const abs = path.join(out, local);
  const css = await readFile(abs, 'utf8');
  await writeFile(abs, rewrite(css), 'utf8');
}

console.log(JSON.stringify({ ok: true, downloaded: Object.keys(map).length }));
