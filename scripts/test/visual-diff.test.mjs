import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, rm, mkdtemp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePng } from './helpers/server.mjs';

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'visual-diff.mjs');

let out;
before(async () => { out = await mkdtemp(path.join(os.tmpdir(), 'vdiff-')); });
after(async () => { await rm(out, { recursive: true, force: true }); });

test('identical images score 1.0', async () => {
  const a = path.join(out, 'a.png');
  const b = path.join(out, 'b.png');
  await writeFile(a, makePng(16, 16, [0, 128, 255, 255]));
  await writeFile(b, makePng(16, 16, [0, 128, 255, 255]));
  const { stdout } = await exec('node', [script, '--orig', a, '--clone', b, '--out', path.join(out, 'd1.png')], { timeout: 30000 });
  const r = JSON.parse(stdout);
  assert.equal(r.mismatched, 0);
  assert.equal(r.score, 1);
});

test('different images score < 1 and write heatmap', async () => {
  const a = path.join(out, 'a2.png');
  const b = path.join(out, 'b2.png');
  await writeFile(a, makePng(16, 16, [0, 0, 0, 255]));
  await writeFile(b, makePng(16, 16, [255, 255, 255, 255]));
  const diff = path.join(out, 'd2.png');
  const { stdout } = await exec('node', [script, '--orig', a, '--clone', b, '--out', diff], { timeout: 30000 });
  const r = JSON.parse(stdout);
  assert.ok(r.score < 1);
  assert.ok(r.mismatched > 0);
  assert.ok(existsSync(diff));
});
