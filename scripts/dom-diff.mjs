import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    orig: { type: 'string' },
    clone: { type: 'string' },
    out: { type: 'string' },
  },
});
if (!values.orig || !values.clone || !values.out) {
  console.error('usage: node dom-diff.mjs --orig <url> --clone <url> --out <report.json>');
  process.exit(1);
}

const KEY_PROPS = [
  'display', 'position', 'color', 'background-color', 'font-size', 'font-weight',
  'font-family', 'margin', 'padding', 'width', 'height', 'flex-direction',
  'justify-content', 'align-items', 'text-align', 'border',
];

async function snapshot(url) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    const nodes = await page.evaluate((props) => {
      const list = [];
      function walk(node, p) {
        const cs = getComputedStyle(node);
        const styles = {};
        for (const k of props) styles[k] = cs.getPropertyValue(k);
        list.push({ path: p, tag: node.tagName.toLowerCase(), styles });
        [...node.children].forEach((c, i) => walk(c, `${p}/${c.tagName.toLowerCase()}[${i}]`));
      }
      const root = document.body || document.documentElement;
      if (root) walk(root, root.tagName.toLowerCase());
      return list;
    }, KEY_PROPS);
    return nodes;
  } finally {
    await browser.close();
  }
}

const [origNodes, cloneNodes] = await Promise.all([snapshot(values.orig), snapshot(values.clone)]);

const mismatches = [];
const max = Math.max(origNodes.length, cloneNodes.length);
let structMatch = 0;
let stylePairs = 0;
let styleMatch = 0;

for (let i = 0; i < max; i++) {
  const o = origNodes[i];
  const c = cloneNodes[i];
  if (!o || !c) {
    mismatches.push({ path: (o || c).path, type: 'structure', orig: o?.tag, clone: c?.tag });
    continue;
  }
  if (o.tag !== c.tag || o.path !== c.path) {
    mismatches.push({ path: o.path, type: 'structure', orig: o.tag, clone: c.tag });
  } else {
    structMatch++;
  }
  for (const prop of KEY_PROPS) {
    stylePairs++;
    if (o.styles[prop] === c.styles[prop]) styleMatch++;
    else mismatches.push({ path: o.path, type: 'style', prop, orig: o.styles[prop], clone: c.styles[prop] });
  }
}

const report = {
  structureScore: max ? structMatch / max : 1,
  styleScore: stylePairs ? styleMatch / stylePairs : 1,
  origCount: origNodes.length,
  cloneCount: cloneNodes.length,
  mismatches,
};
await writeFile(values.out, JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify({ structureScore: report.structureScore, styleScore: report.styleScore, mismatches: mismatches.length }));
