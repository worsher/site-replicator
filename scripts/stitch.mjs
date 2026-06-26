import { PNG } from 'pngjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    a: { type: 'string' },
    b: { type: 'string' },
    out: { type: 'string' },
    gap: { type: 'string', default: '24' },
  },
});

const A = PNG.sync.read(readFileSync(values.a));
const B = PNG.sync.read(readFileSync(values.b));
const gap = parseInt(values.gap, 10);
const W = A.width + gap + B.width;
const H = Math.max(A.height, B.height);
const out = new PNG({ width: W, height: H });
for (let i = 0; i < out.data.length; i += 4) {
  out.data[i] = 235; out.data[i + 1] = 235; out.data[i + 2] = 235; out.data[i + 3] = 255;
}
PNG.bitblt(A, out, 0, 0, A.width, A.height, 0, 0);
PNG.bitblt(B, out, 0, 0, B.width, B.height, A.width + gap, 0);
writeFileSync(values.out, PNG.sync.write(out));
console.log(JSON.stringify({ ok: true, w: W, h: H, a: [A.width, A.height], b: [B.width, B.height] }));
