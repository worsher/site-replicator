import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { startFixtureServer } from './helpers/server.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const S = (n) => path.join(here, '..', n);

// 极简静态文件服务器，用于托管 L1 clone 目录
function serveDir(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.png': 'image/png' };
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p === '/') p = '/index.html';
      const abs = path.join(dir, p);
      const ext = path.extname(abs);
      res.writeHead(200, { 'content-type': types[ext] || 'application/octet-stream' });
      createReadStream(abs).on('error', () => { res.writeHead(404); res.end(); }).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => { s.closeAllConnections(); return new Promise((r) => s.close(r)); } }));
  });
}

let srv, work;
before(async () => {
  srv = await startFixtureServer();
  work = await mkdtemp(path.join(os.tmpdir(), 'e2e-'));
});
after(async () => {
  await srv.close();
  await rm(work, { recursive: true, force: true });
});

test('L1 clone of fixture matches original (visual + dom)', async () => {
  const cap = path.join(work, 'orig');
  await exec('node', [S('capture.mjs'), srv.url + '/', '--out', cap, '--breakpoints', '1440'], { timeout: 60000 });

  await exec('node', [S('download-assets.mjs'), '--network', path.join(cap, 'network.json'), '--html', path.join(cap, 'dom.html'), '--out', work], { timeout: 60000 });

  const clone = await serveDir(work);
  try {
    // clone 截图
    const cloneCap = path.join(work, 'clonecap');
    await exec('node', [S('capture.mjs'), clone.url, '--out', cloneCap, '--breakpoints', '1440'], { timeout: 60000 });

    const vout = await exec('node', [S('visual-diff.mjs'), '--orig', path.join(cap, 'screenshots', '1440.png'), '--clone', path.join(cloneCap, 'screenshots', '1440.png'), '--out', path.join(work, 'diff.png')], { timeout: 30000 });
    const v = JSON.parse(vout.stdout);
    assert.ok(v.score > 0.99, `visual score ${v.score} should be > 0.99`);

    const dreport = path.join(work, 'dom-report.json');
    await exec('node', [S('dom-diff.mjs'), '--orig', srv.url + '/', '--clone', clone.url, '--out', dreport], { timeout: 60000 });
    const d = JSON.parse(await readFile(dreport, 'utf8'));
    assert.ok(d.styleScore > 0.95, `style score ${d.styleScore} should be > 0.95`);
  } finally {
    await clone.close();
  }
});
