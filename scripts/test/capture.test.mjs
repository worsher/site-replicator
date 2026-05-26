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
