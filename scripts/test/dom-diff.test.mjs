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

test('--exclude removes third-party injected nodes from both sides', async () => {
  // clone 多了一个第三方 chat widget 注入节点，--exclude 后应完全对齐
  const withWidget = `<!doctype html><html><body><h1 id="t" style="color:rgb(0, 0, 0);font-size:20px">Hi</h1><div class="chat-widget">x</div></body></html>`;
  const c = await serve(withWidget);
  try {
    const report = path.join(out, 'r3.json');
    await exec('node', [script, '--orig', a.url, '--clone', c.url, '--out', report, '--exclude', '.chat-widget'], { timeout: 60000 });
    const r = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(r.structureScore, 1, 'widget removed before compare');
    assert.equal(r.styleScore, 1);
  } finally {
    await c.close();
  }
});

test('--width applies the given viewport (media queries take effect)', async () => {
  // mq 页在 ≤500px 下 font-size:10px；fixed 页恒为 10px → 在 375 视口下两者应一致
  const MQ = `<!doctype html><html><head><style>#t{font-size:20px}@media (max-width:500px){#t{font-size:10px}}</style></head><body><h1 id="t">Hi</h1></body></html>`;
  const FIXED = `<!doctype html><html><head><style>#t{font-size:10px}</style></head><body><h1 id="t">Hi</h1></body></html>`;
  const m = await serve(MQ);
  const f = await serve(FIXED);
  try {
    const report = path.join(out, 'r4.json');
    await exec('node', [script, '--orig', m.url, '--clone', f.url, '--out', report, '--width', '375'], { timeout: 60000 });
    const r = JSON.parse(await readFile(report, 'utf8'));
    assert.equal(r.structureScore, 1);
    assert.ok(!r.mismatches.some((x) => x.prop === 'font-size'), 'no font-size mismatch at 375px viewport');
  } finally {
    await m.close();
    await f.close();
  }
});
