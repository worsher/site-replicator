import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './helpers/server.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'run-pages.mjs');

let srv, root;
before(async () => {
  srv = await startFixtureServer();
  root = await mkdtemp(path.join(os.tmpdir(), 'runpages-'));
});
after(async () => {
  await srv.close();
  await rm(root, { recursive: true, force: true });
});

test('multi-page batch: capture, shared assets, link map, inert links', async () => {
  const cfg = {
    origin: srv.url,
    root,
    breakpoints: [1440],
    concurrency: 4,
    inertPaths: ['/cart/'],
    pages: [
      { slug: 'home', path: '/', file: 'index.html' },
      { slug: 'about', path: '/about/', file: 'about.html' },
    ],
  };
  const cfgFile = path.join(root, 'pages.json');
  await writeFile(cfgFile, JSON.stringify(cfg, null, 2));

  await exec('node', [script, '--config', cfgFile], { timeout: 120000 });

  // 每页原始快照
  assert.ok(existsSync(path.join(root, 'home', 'original', 'dom.html')), 'home captured');
  assert.ok(existsSync(path.join(root, 'about', 'original', 'dom.html')), 'about captured');
  assert.ok(existsSync(path.join(root, 'home', 'original', 'screenshots', '1440.png')), 'home screenshot');

  // 成品页 + 站点级共享资产
  const build = path.join(root, 'pages-build');
  assert.ok(existsSync(path.join(build, 'index.html')), 'index.html built');
  assert.ok(existsSync(path.join(build, 'about.html')), 'about.html built');
  assert.ok(existsSync(path.join(build, 'assets', 'style.css')), 'shared asset downloaded once at site level');
  assert.ok(existsSync(path.join(build, 'asset-map.json')), 'site-level asset map');

  const about = await readFile(path.join(build, 'about.html'), 'utf8');
  assert.match(about, /id="home-link" href="index\.html"/, 'inter-page link rewritten to local file');
  assert.match(about, /id="cart-link" href="#"/, 'inert commerce link neutralized');
  assert.ok(!about.includes(`src="${srv.url}`), 'no absolute asset refs left');
  assert.match(about, /src="assets\/logo\.png"/, 'asset ref rewritten to shared assets/');
});

test('re-run skips existing captures (idempotent resume)', async () => {
  const cfgFile = path.join(root, 'pages.json');
  const reqBefore = srv.requests.length;
  await exec('node', [script, '--config', cfgFile, '--mode', 'capture'], { timeout: 60000 });
  const delta = srv.requests.slice(reqBefore);
  assert.ok(!delta.includes('/about/'), 'already-captured page not re-fetched');
});
