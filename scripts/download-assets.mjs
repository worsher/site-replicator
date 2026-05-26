import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
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

// 由 URL 推导本地相对路径（去 query、去前导 /）
function localPathFor(u) {
  const url = new URL(u);
  let p = url.pathname.replace(/^\/+/, '');
  if (!p || p.endsWith('/')) p += 'index';
  // 防目录穿越
  p = p.split('/').filter((s) => s && s !== '..').join('/');
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
  const resp = await fetch(r.url);
  if (!resp.ok) {
    console.error('skip (fetch failed):', r.url, resp.status);
    continue;
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  await writeFile(abs, buf);
  map[r.url] = rel.split(path.sep).join('/');
}

await writeFile(path.join(out, 'asset-map.json'), JSON.stringify(map, null, 2), 'utf8');

// 引用重写：先替换完整绝对 URL；再替换下载到的 css 内部 url(...)
function rewrite(text) {
  let result = text;
  for (const [orig, local] of Object.entries(map)) {
    result = result.split(orig).join(local);
    // 同时替换 pathname 形式（相对引用）
    const p = new URL(orig).pathname;
    result = result.split(`"${p}"`).join(`"${local}"`);
    result = result.split(`'${p}'`).join(`'${local}'`);
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
