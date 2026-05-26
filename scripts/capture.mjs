import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: 'string' },
    breakpoints: { type: 'string', default: '1440,768,375' },
  },
});
const url = positionals[0];
if (!url || !values.out) {
  console.error('usage: node capture.mjs <url> --out <dir> [--breakpoints 1440,768,375]');
  process.exit(1);
}
const out = values.out;
const breakpoints = values.breakpoints.split(',').map((s) => parseInt(s.trim(), 10));

await mkdir(path.join(out, 'screenshots'), { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

const requests = [];
page.on('response', (res) => {
  const req = res.request();
  requests.push({
    url: req.url(),
    method: req.method(),
    resourceType: req.resourceType(),
    status: res.status(),
    contentType: res.headers()['content-type'] || '',
  });
});

await page.goto(url, { waitUntil: 'networkidle' });

await writeFile(path.join(out, 'dom.html'), await page.content(), 'utf8');

const tree = await page.evaluate(() => {
  function ser(node) {
    const className =
      node.className && typeof node.className === 'string'
        ? node.className.split(/\s+/).filter(Boolean)
        : undefined;
    return {
      tag: node.tagName ? node.tagName.toLowerCase() : undefined,
      id: node.id || undefined,
      classes: className && className.length ? className : undefined,
      children: [...node.children].map(ser),
    };
  }
  return ser(document.body);
});
await writeFile(path.join(out, 'dom-tree.json'), JSON.stringify(tree, null, 2), 'utf8');
await writeFile(path.join(out, 'network.json'), JSON.stringify(requests, null, 2), 'utf8');

for (const bp of breakpoints) {
  await page.setViewportSize({ width: bp, height: 900 });
  await page.screenshot({ path: path.join(out, 'screenshots', `${bp}.png`), fullPage: true });
}

await browser.close();
console.log(JSON.stringify({ ok: true, out, breakpoints, requests: requests.length }));
