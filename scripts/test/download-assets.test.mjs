import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rm, mkdtemp, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './helpers/server.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'download-assets.mjs');

let srv, out;
before(async () => {
  srv = await startFixtureServer();
  out = await mkdtemp(path.join(os.tmpdir(), 'dl-'));
});
after(async () => {
  await srv.close();
  await rm(out, { recursive: true, force: true });
});

test('downloads assets, writes map, rewrites html', async () => {
  const network = [
    { url: srv.url + '/style.css', resourceType: 'stylesheet', status: 200, contentType: 'text/css' },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200, contentType: 'image/png' },
    { url: srv.url + '/', resourceType: 'document', status: 200, contentType: 'text/html' },
  ];
  const html = `<link rel="stylesheet" href="${srv.url}/style.css"><img src="${srv.url}/logo.png">`;
  await writeFile(path.join(out, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(out, 'dom.html'), html);

  await exec('node', [script, '--network', path.join(out, 'network.json'), '--html', path.join(out, 'dom.html'), '--out', out], { timeout: 30000 });

  assert.ok(existsSync(path.join(out, 'assets', 'style.css')), 'css downloaded');
  assert.ok(existsSync(path.join(out, 'assets', 'logo.png')), 'png downloaded');

  const map = JSON.parse(await readFile(path.join(out, 'asset-map.json'), 'utf8'));
  assert.equal(map[srv.url + '/style.css'], 'assets/style.css');

  const rewritten = await readFile(path.join(out, 'index.html'), 'utf8');
  assert.match(rewritten, /href="assets\/style\.css"/);
  assert.match(rewritten, /src="assets\/logo\.png"/);
  assert.ok(!rewritten.includes(srv.url), 'no original origin left in html');

  // CSS 内 url() 重写为相对该 CSS 文件目录的路径（style.css 与 logo.png 同在 assets/ 下 → logo.png）
  const css = await readFile(path.join(out, 'assets', 'style.css'), 'utf8');
  assert.match(css, /url\("logo\.png"\)/, 'quoted css url() rewritten relative to css dir');
  assert.match(css, /url\(logo\.png\)/, 'unquoted css url() rewritten relative to css dir');
  assert.ok(!css.includes('url("/logo.png")'), 'quoted original url gone');
  assert.ok(!css.includes('url(/logo.png)'), 'unquoted original url gone');

  // document 类型不应被当作静态资源下载
  assert.ok(!existsSync(path.join(out, 'assets', 'index')), 'document not downloaded as a static asset');
});

test('rewrites protocol-relative (//host/path) references', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-pr-'));
  const host = srv.url.replace(/^http:/, ''); // //127.0.0.1:port
  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
  ];
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(dir, 'dom.html'), `<img src="${host}/logo.png">`);

  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir], { timeout: 30000 });

  const rewritten = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(rewritten, /src="assets\/logo\.png"/, 'protocol-relative src rewritten');
  assert.ok(!rewritten.includes(host + '/logo.png'), 'no protocol-relative residue');
  await rm(dir, { recursive: true, force: true });
});

test('rewrites root-absolute srcset entries', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-ss-'));
  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
    { url: srv.url + '/logo2.png', resourceType: 'image', status: 200 },
  ];
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(dir, 'dom.html'), `<img src="${srv.url}/logo.png" srcset="/logo.png 1x, /logo2.png 2x">`);

  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir], { timeout: 30000 });

  const rewritten = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(rewritten, /srcset="assets\/logo\.png 1x, assets\/logo2\.png 2x"/, 'srcset entries rewritten');
  await rm(dir, { recursive: true, force: true });
});

test('cross-host same-path assets do not overwrite each other', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-xh-'));
  const srvB = await startFixtureServer({ logoColor: [0, 255, 0, 255] });
  try {
    const network = [
      { url: srv.url + '/', resourceType: 'document', status: 200 },
      { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
      { url: srvB.url + '/logo.png', resourceType: 'image', status: 200 },
    ];
    await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
    await writeFile(path.join(dir, 'dom.html'), `<img src="${srv.url}/logo.png"><img src="${srvB.url}/logo.png">`);

    await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir], { timeout: 30000 });

    const map = JSON.parse(await readFile(path.join(dir, 'asset-map.json'), 'utf8'));
    assert.notEqual(map[srv.url + '/logo.png'], map[srvB.url + '/logo.png'], 'two hosts map to distinct local paths');
    assert.ok(existsSync(path.join(dir, map[srv.url + '/logo.png'])), 'host A file exists');
    assert.ok(existsSync(path.join(dir, map[srvB.url + '/logo.png'])), 'host B file exists');
    const bytesA = await readFile(path.join(dir, map[srv.url + '/logo.png']));
    const bytesB = await readFile(path.join(dir, map[srvB.url + '/logo.png']));
    assert.ok(!bytesA.equals(bytesB), 'contents preserved per host');
  } finally {
    await srvB.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('--map shares a site-level map and skips already-downloaded files', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-map-'));
  const mapFile = path.join(dir, 'site-map.json');
  // 预置：logo.png 已在共享 map 中且文件已落盘
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'assets', 'logo.png'), 'PRESEEDED');
  await writeFile(mapFile, JSON.stringify({ [srv.url + '/logo.png']: 'assets/logo.png' }));

  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
    { url: srv.url + '/logo2.png', resourceType: 'image', status: 200 },
  ];
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(dir, 'dom.html'), `<img src="${srv.url}/logo.png"><img src="${srv.url}/logo2.png">`);

  const reqBefore = srv.requests.length;
  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir, '--map', mapFile], { timeout: 30000 });
  const delta = srv.requests.slice(reqBefore);

  assert.ok(!delta.includes('/logo.png'), 'preseeded asset not re-fetched');
  assert.ok(delta.includes('/logo2.png'), 'new asset fetched');
  assert.equal(await readFile(path.join(dir, 'assets', 'logo.png'), 'utf8'), 'PRESEEDED', 'preseeded file not overwritten');
  const merged = JSON.parse(await readFile(mapFile, 'utf8'));
  assert.equal(merged[srv.url + '/logo.png'], 'assets/logo.png');
  assert.equal(merged[srv.url + '/logo2.png'], 'assets/logo2.png');
  const rewritten = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(rewritten, /src="assets\/logo\.png"/, 'preseeded mapping still used in rewrite');
  await rm(dir, { recursive: true, force: true });
});

test('--html-out and --concurrency are supported', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-ho-'));
  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
  ];
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(dir, 'dom.html'), `<img src="${srv.url}/logo.png">`);

  const htmlOut = path.join(dir, 'pages', 'home.html');
  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir, '--html-out', htmlOut, '--concurrency', '4'], { timeout: 30000 });

  assert.ok(existsSync(htmlOut), 'html written to custom path');
  assert.ok(!existsSync(path.join(dir, 'index.html')), 'default index.html not written when --html-out given');
  await rm(dir, { recursive: true, force: true });
});

test('un-lazies img/script/link and strips LiteSpeed loader markup', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-lz-'));
  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/logo.png', resourceType: 'image', status: 200 },
    { url: srv.url + '/app.js', resourceType: 'script', status: 200 },
    { url: srv.url + '/style.css', resourceType: 'stylesheet', status: 200 },
  ];
  const html = [
    `<img src="data:image/gif;base64,R0lGODlhAQABAA==" data-src="${srv.url}/logo.png" data-lazyloaded="1">`,
    `<script type="litespeed/javascript" data-src="${srv.url}/app.js"></script>`,
    `<script data-no-optimize="1">window.litespeed = {};</script>`,
    `<link rel="stylesheet" data-src="${srv.url}/style.css">`,
  ].join('\n');
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));
  await writeFile(path.join(dir, 'dom.html'), html);

  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--html', path.join(dir, 'dom.html'), '--out', dir], { timeout: 30000 });

  const rewritten = await readFile(path.join(dir, 'index.html'), 'utf8');
  assert.match(rewritten, /<img[^>]*src="assets\/logo\.png"/, 'lazy img promoted to real src and localized');
  assert.ok(!rewritten.includes('data-lazyloaded'), 'lazyload marker removed');
  assert.match(rewritten, /<script[^>]*type="text\/javascript"[^>]*src="assets\/app\.js"/, 'litespeed script restored to real script');
  assert.ok(!rewritten.includes('data-no-optimize'), 'litespeed loader stub stripped');
  assert.match(rewritten, /<link[^>]*href="assets\/style\.css"/, 'lazy stylesheet link promoted');
  await rm(dir, { recursive: true, force: true });
});

test('falls back to file-extension filtering when resourceType is unreliable', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dl-ext-'));
  const network = [
    { url: srv.url + '/', resourceType: 'document', status: 200 },
    { url: srv.url + '/font.woff2', resourceType: 'other', status: 200 },
  ];
  await writeFile(path.join(dir, 'network.json'), JSON.stringify(network));

  await exec('node', [script, '--network', path.join(dir, 'network.json'), '--out', dir], { timeout: 30000 });

  assert.ok(existsSync(path.join(dir, 'assets', 'font.woff2')), 'woff2 with resourceType=other still downloaded');
  await rm(dir, { recursive: true, force: true });
});
