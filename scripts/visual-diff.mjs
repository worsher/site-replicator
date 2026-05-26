import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

const { values } = parseArgs({
  options: {
    orig: { type: 'string' },
    clone: { type: 'string' },
    out: { type: 'string' },
    threshold: { type: 'string', default: '0.1' },
  },
});
if (!values.orig || !values.clone || !values.out) {
  console.error('usage: node visual-diff.mjs --orig <a.png> --clone <b.png> --out <diff.png>');
  process.exit(1);
}

const a = PNG.sync.read(readFileSync(values.orig));
const b = PNG.sync.read(readFileSync(values.clone));
const width = Math.min(a.width, b.width);
const height = Math.min(a.height, b.height);

// 裁剪到公共尺寸（左上对齐）
function crop(src, w, h) {
  if (src.width === w && src.height === h) return src;
  const dst = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = (src.width * y + x) * 4;
      const di = (w * y + x) * 4;
      dst.data[di] = src.data[si];
      dst.data[di + 1] = src.data[si + 1];
      dst.data[di + 2] = src.data[si + 2];
      dst.data[di + 3] = src.data[si + 3];
    }
  }
  return dst;
}

const ca = crop(a, width, height);
const cb = crop(b, width, height);
const diff = new PNG({ width, height });
const mismatched = pixelmatch(ca.data, cb.data, diff.data, width, height, {
  threshold: parseFloat(values.threshold),
});
writeFileSync(values.out, PNG.sync.write(diff));

const score = 1 - mismatched / (width * height);
console.log(JSON.stringify({ score, mismatched, width, height }));
