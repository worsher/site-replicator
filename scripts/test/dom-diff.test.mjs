import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, rm, mkdtemp } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'dom-diff.mjs');

function serve(html) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    });
    s.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${s.address().port}/`, close: () => { s.closeAllConnections(); return new Promise((r) => s.close(r)); } }));
  });
}

const PAGE = (color) => `<!doctype html><html><body><h1 id="t" style="color:${color};font-size:20px">Hi</h1></body></html>`;

let a, b, out;
before(async () => {
  a = await serve(PAGE('rgb(0, 0, 0)'));
  b = await serve(PAGE('rgb(0, 0, 0)'));
  out = await mkdtemp(path.join(os.tmpdir(), 'domdiff-'));
});
after(async () => {
  await a.close();
  await b.close();
  await rm(out, { recursive: true, force: true });
});

test('identical pages score 1.0', async () => {
  const report = path.join(out, 'r1.json');
  await exec('node', [script, '--orig', a.url, '--clone', b.url, '--out', report], { timeout: 60000 });
  const r = JSON.parse(await readFile(report, 'utf8'));
  assert.equal(r.structureScore, 1);
  assert.equal(r.styleScore, 1);
  assert.equal(r.mismatches.length, 0);
});

test('color difference is flagged', async () => {
  const c = await serve(PAGE('rgb(255, 0, 0)'));
  const report = path.join(out, 'r2.json');
  await exec('node', [script, '--orig', a.url, '--clone', c.url, '--out', report], { timeout: 60000 });
  const r = JSON.parse(await readFile(report, 'utf8'));
  assert.ok(r.styleScore < 1, 'styleScore should drop');
  assert.ok(r.mismatches.some((m) => m.prop === 'color'), 'color mismatch flagged');
  await c.close();
});
