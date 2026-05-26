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

  // document 类型不应被当作静态资源下载
  assert.ok(!existsSync(path.join(out, 'assets', 'index.html')));
});
