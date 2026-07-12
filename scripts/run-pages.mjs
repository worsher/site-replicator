/* 通用多页（整站抽样）批量 L1 复刻管线：
 *   capture（跳过已抓取 + 礼貌限速）
 *   → download-assets（站点级共享 asset-map，跨页去重）
 *   → 页间互链重写为本地文件 + 危险/无后端支撑链接失活
 *   → 可选拷贝到目标项目目录
 *
 * 用法：
 *   node run-pages.mjs --config <pages.json> [--mode capture|build|all]
 *
 * 配置格式（root/copyTo 支持相对 cwd 或绝对路径）：
 * {
 *   "origin": "https://www.example.com",
 *   "root": ".site-replicator/example.com",
 *   "breakpoints": [1440, 768, 375],
 *   "concurrency": 8,
 *   "inertPaths": ["/cart/", "/checkout/", "/my-account/", "/wishlist/"],
 *   "copyTo": "/path/to/project",
 *   "pages": [
 *     { "slug": "home",  "path": "/",         "file": "index.html" },
 *     { "slug": "about", "path": "/about-us/", "file": "about-us.html" }
 *   ]
 * }
 *
 * 产物：<root>/<slug>/original/（各页快照）、<root>/pages-build/（成品页 + 共享 assets/ + asset-map.json）、
 *       <root>/run-pages.log（进度日志）。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, cp, appendFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));

const { values } = parseArgs({
  options: {
    config: { type: 'string' },
    mode: { type: 'string', default: 'all' }, // capture | build | all
  },
});
if (!values.config || !['capture', 'build', 'all'].includes(values.mode)) {
  console.error('usage: node run-pages.mjs --config <pages.json> [--mode capture|build|all]');
  process.exit(1);
}
const cfg = JSON.parse(await readFile(values.config, 'utf8'));
if (!cfg.origin || !cfg.root || !Array.isArray(cfg.pages) || cfg.pages.length === 0 ||
    cfg.pages.some((p) => !p.slug || !p.path || !p.file)) {
  console.error('config 需包含 origin / root / pages[{slug,path,file}]（slug、path、file 均必填）');
  process.exit(1);
}

const origin = cfg.origin.replace(/\/+$/, '');
const root = path.resolve(cfg.root);
const breakpoints = (Array.isArray(cfg.breakpoints) && cfg.breakpoints.length ? cfg.breakpoints : [1440, 768, 375]).join(',');
const firstBp = breakpoints.split(',')[0];
const concurrency = String(cfg.concurrency || 8);
const inertPaths = Array.isArray(cfg.inertPaths) ? cfg.inertPaths : [];
const BUILD = path.join(root, 'pages-build');
const LOG = path.join(root, 'run-pages.log');

async function log(m) {
  const line = `[${new Date().toISOString()}] ${m}\n`;
  await mkdir(root, { recursive: true });
  await appendFile(LOG, line).catch(() => {});
  process.stdout.write(line);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function captureAll() {
  for (const p of cfg.pages) {
    const outDir = path.join(root, p.slug, 'original');
    // 断点续跑：dom.html 与首断点截图都在则视为已抓取
    if (existsSync(path.join(outDir, 'dom.html')) && existsSync(path.join(outDir, 'screenshots', `${firstBp}.png`))) {
      await log(`capture ${p.slug}: exists, skip`);
      continue;
    }
    try {
      await exec('node', [path.join(here, 'capture.mjs'), origin + p.path, '--out', outDir, '--breakpoints', breakpoints], { timeout: 180000 });
      await log(`capture ${p.slug}: OK`);
    } catch (e) {
      await log(`capture ${p.slug}: FAIL ${String(e.message || e).split('\n')[0]}`);
    }
    await sleep(500 + Math.random() * 500); // 礼貌限速（见 02-site-discovery 约束）
  }
}

async function buildAll() {
  await mkdir(BUILD, { recursive: true });
  for (const p of cfg.pages) {
    const orig = path.join(root, p.slug, 'original');
    if (!existsSync(path.join(orig, 'dom.html'))) {
      await log(`build ${p.slug}: NO dom.html, skip`);
      continue;
    }
    await exec('node', [
      path.join(here, 'download-assets.mjs'),
      '--network', path.join(orig, 'network.json'),
      '--html', path.join(orig, 'dom.html'),
      '--out', BUILD,
      '--map', path.join(BUILD, 'asset-map.json'),
      '--html-out', path.join(BUILD, p.file),
      '--referer', origin + p.path,
      '--concurrency', concurrency,
    ], { timeout: 600000 });

    // 页间互链 → 本地文件；无后端支撑的链接（购物车/结算/账户等）失活为 #，防止点击跳回原站
    let html = await readFile(path.join(BUILD, p.file), 'utf8');
    for (const q of cfg.pages) {
      for (const form of [`href="${origin}${q.path}"`, `href="${q.path}"`]) html = html.split(form).join(`href="${q.file}"`);
    }
    for (const ip of inertPaths) {
      for (const form of [`href="${origin}${ip}"`, `href="${ip}"`]) html = html.split(form).join('href="#"');
    }
    await writeFile(path.join(BUILD, p.file), html, 'utf8');
    await log(`build ${p.slug}: -> ${p.file} (${html.length}B)`);
  }
}

async function copyToProject() {
  if (!cfg.copyTo) return;
  const dest = path.resolve(cfg.copyTo);
  await mkdir(dest, { recursive: true });
  for (const p of cfg.pages) {
    const f = path.join(BUILD, p.file);
    if (existsSync(f)) await cp(f, path.join(dest, p.file));
  }
  if (existsSync(path.join(BUILD, 'assets'))) await cp(path.join(BUILD, 'assets'), path.join(dest, 'assets'), { recursive: true });
  await log(`copyTo: done -> ${dest}`);
}

await log(`=== run-pages start mode=${values.mode} pages=${cfg.pages.length} ===`);
if (values.mode === 'all' || values.mode === 'capture') await captureAll();
if (values.mode === 'all' || values.mode === 'build') {
  await buildAll();
  await copyToProject();
}
await log(`=== run-pages done ===`);
