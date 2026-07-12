import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFixtureServer } from './helpers/server.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'capture.mjs');

let srv, out;
before(async () => {
  srv = await startFixtureServer();
  out = await mkdtemp(path.join(os.tmpdir(), 'cap-'));
});
after(async () => {
  await srv.close();
  await rm(out, { recursive: true, force: true });
});

test('capture writes dom, tree, network, screenshots', async () => {
  await exec('node', [script, srv.url + '/', '--out', out, '--breakpoints', '1440,375'], { timeout: 60000 });

  const dom = await readFile(path.join(out, 'dom.html'), 'utf8');
  assert.match(dom, /<h1 id="title">Hello<\/h1>/);

  const tree = JSON.parse(await readFile(path.join(out, 'dom-tree.json'), 'utf8'));
  assert.equal(tree.tag, 'body');
  const titles = JSON.stringify(tree);
  assert.match(titles, /"id":"title"/);

  const net = JSON.parse(await readFile(path.join(out, 'network.json'), 'utf8'));
  const urls = net.map((r) => r.url);
  assert.ok(urls.some((u) => u.endsWith('/style.css')), 'css in network');
  assert.ok(urls.some((u) => u.endsWith('/logo.png')), 'png in network');

  assert.ok(existsSync(path.join(out, 'screenshots', '1440.png')));
  assert.ok(existsSync(path.join(out, 'screenshots', '375.png')));
});

test('exits non-zero when required args are missing', async () => {
  await assert.rejects(exec('node', [script], { timeout: 30000 }));
});

test('screenshots are deterministic: CSS animations frozen by default', async () => {
  // /motion.html 有 200x200 的 infinite spin：不冻结动画时两次抓取的旋转角必然不同
  const d1 = await mkdtemp(path.join(os.tmpdir(), 'cap-fz1-'));
  const d2 = await mkdtemp(path.join(os.tmpdir(), 'cap-fz2-'));
  const vdiff = path.join(here, '..', 'visual-diff.mjs');
  await exec('node', [script, srv.url + '/motion.html', '--out', d1, '--breakpoints', '1440'], { timeout: 60000 });
  await exec('node', [script, srv.url + '/motion.html', '--out', d2, '--breakpoints', '1440'], { timeout: 60000 });
  const { stdout } = await exec('node', [vdiff, '--orig', path.join(d1, 'screenshots', '1440.png'), '--clone', path.join(d2, 'screenshots', '1440.png'), '--out', path.join(d1, 'diff.png')], { timeout: 30000 });
  const r = JSON.parse(stdout);
  assert.equal(r.mismatched, 0, `two captures of the same page must be pixel-identical, got ${r.mismatched} mismatched px`);
  await rm(d1, { recursive: true, force: true });
  await rm(d2, { recursive: true, force: true });
});

test('promotes data-lazy-src images so they enter network + dom snapshot', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cap-lz-'));
  await exec('node', [script, srv.url + '/lazy.html', '--out', dir, '--breakpoints', '1440'], { timeout: 60000 });

  const net = JSON.parse(await readFile(path.join(dir, 'network.json'), 'utf8'));
  assert.ok(net.some((r) => r.url.endsWith('/logo2.png')), 'lazy real image requested during capture');

  const dom = await readFile(path.join(dir, 'dom.html'), 'utf8');
  assert.match(dom, /<img[^>]*id="lz"[^>]*src="\/logo2\.png"/, 'placeholder src replaced by real image in snapshot');
  await rm(dir, { recursive: true, force: true });
});
