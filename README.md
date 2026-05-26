# site-replicator

对线上真实网页做高保真 1:1 复刻的 Claude Code skill。

---

## 用途与模式

**site-replicator** 支持两种调用模式：

- **单页模式**：给定单个 URL，对该页执行完整五步管线，输出 L1/L2/L3 产物。
- **整站模式**：给定站点根 URL 或要求「复刻整站」，先通过 sitemap + 内链爬取 + 手动列表发现全站页面，经用户确认筛选后批量对每页执行单页管线。

---

## 三层输出

| 层级 | 说明 |
|---|---|
| **L1 — 独立静态站** | 框架无关，HTML + 本地化资源，可直接在浏览器打开，适合快速预览与临时归档。 |
| **L2 — 融入目标项目** | 按宿主项目现有技术栈拆分为组件，遵循宿主约定，适合直接集成进现有代码库。 |
| **L3 — 固定栈重建** | 以区块为单位渐进重写为 Next.js + React + Tailwind + TS，每区块卡门禁，适合需要长期维护的独立代码库。 |

### site-replicator.config.json 示例

```jsonc
{
  // 输出层级（默认 L1）
  "outputTarget": "L1",          // "L1" | "L2" | "L3"

  // L3 固定栈配置（仅 outputTarget=L3 时生效）
  "l3Stack": {
    "framework": "next",         // "next"（当前唯一支持项）
    "styling": "tailwind",       // "tailwind"（当前唯一支持项）
    "typescript": true
  },

  // 反混淆级别（默认 tier1）
  "deobfuscation": "tier1",      // "tier1" | "tier2"

  // 截图与对比的断点（px）
  "breakpoints": [1440, 768, 375],

  // 三项分别的验收阈值
  "fidelityThreshold": {
    "pixel": 0.98,               // visual-diff score ≥ 0.98
    "structure": 0.90,           // dom-diff structureScore ≥ 0.90
    "style": 0.85                // dom-diff styleScore ≥ 0.85
  }
}
```

---

## 安装 / 依赖

```bash
cd ~/.claude/skills/site-replicator/scripts && pnpm install && pnpm exec playwright install chromium
```

---

## 脚本速查

| 脚本 | 用途 | 独立运行示例 |
|---|---|---|
| `capture.mjs` | 多断点截图 + DOM/网络快照 | `node scripts/capture.mjs <url> --out <dir> [--breakpoints 1440,768,375] [--timeout 60000]` |
| `download-assets.mjs` | 批量下载静态资源并重写引用 | `node scripts/download-assets.mjs --network <network.json> --html <dom.html> --out <dir>` |
| `dom-diff.mjs` | DOM 结构 + 计算样式对比，输出 report.json | `node scripts/dom-diff.mjs --orig <url> --clone <url> --out <report.json>` |
| `visual-diff.mjs` | 像素级差异热力图，输出 diff.png + score | `node scripts/visual-diff.mjs --orig <a.png> --clone <b.png> --out <diff.png> [--threshold 0.1]` |

---

## 五步管线概览

管线依序执行：①结构抓取 → ②资源下载本地化 → ③分级反混淆 → ④三重对比验收 → ⑤动效复刻。详细规则分别见：

- 步骤 1：[references/01-page-pipeline.md](references/01-page-pipeline.md)
- 步骤 2：[references/03-asset-extraction.md](references/03-asset-extraction.md)
- 步骤 3：[references/04-deobfuscation.md](references/04-deobfuscation.md)
- 步骤 4：[references/05-visual-verification.md](references/05-visual-verification.md)
- 步骤 5：[references/06-animation.md](references/06-animation.md)
- 整站发现：[references/02-site-discovery.md](references/02-site-discovery.md)
- 三层输出详解：[references/output-targets.md](references/output-targets.md)

---

## 测试

```bash
cd ~/.claude/skills/site-replicator/scripts && pnpm test
```

---

## 目录结构

```
~/.claude/skills/site-replicator/
├── SKILL.md                        ← skill 入口，含五步管线与脚本速查
├── README.md                       ← 本文件
├── references/
│   ├── 01-page-pipeline.md         ← 单页管线详细流程
│   ├── 02-site-discovery.md        ← 整站页面发现与筛选
│   ├── 03-asset-extraction.md      ← 静态资源下载与本地化
│   ├── 04-deobfuscation.md         ← 分级反混淆规则
│   ├── 05-visual-verification.md   ← 三重对比验收与回修闭环
│   ├── 06-animation.md             ← 动效提取与复刻
│   └── output-targets.md           ← L1/L2/L3 三层输出详解与配置格式
└── scripts/
    ├── capture.mjs                 ← 多断点截图 + DOM/网络快照
    ├── download-assets.mjs         ← 批量资源下载与引用重写
    ├── dom-diff.mjs                ← DOM 结构 + 样式对比
    ├── visual-diff.mjs             ← 像素级差异热力图
    ├── package.json
    └── test/
        ├── capture.test.mjs
        ├── dom-diff.test.mjs
        ├── download-assets.test.mjs
        ├── e2e.test.mjs
        └── visual-diff.test.mjs
```

---

## 边界声明

本 skill 仅用于授权范围内的复刻；使用前请确认目标站使用条款允许复刻，本 skill 不承担任何法律责任。
