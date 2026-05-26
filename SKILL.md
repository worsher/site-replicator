---
name: site-replicator
description: 网页 1:1 复刻专家，对线上真实网页做高保真复刻。支持「单页复刻」与「整站发现+筛选+批量复刻」两种模式；复刻管线含 HTML 结构抓取、静态资源罗列下载与本地化、混淆代码分级复原、浏览器结构+样式+像素三重对比、动效提取与复刻。输出支持三层：L1 独立静态站 / L2 融入目标项目 / L3 重建到固定技术栈（默认 Next.js+Tailwind+TS，可配置）。
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, mcp__plugin_playwright_playwright__*, mcp__ChromeDevTools__*
---

## 简介

site-replicator 能对任意线上网页做高保真 1:1 复刻，支持两种调用模式：

- **单页模式**：给定单个 URL，对该页执行完整五步管线，输出 L1/L2/L3 产物。
- **整站模式**：给定站点根 URL 或要求「复刻整站」，先通过 sitemap + 内链爬取 + 手动列表发现全站页面，用户确认筛选后批量对每页执行单页管线。

---

## 首次使用前置（依赖自检）

脚本依赖 Playwright、pixelmatch、pngjs。执行以下幂等安装命令（已装则跳过）：

```bash
cd ~/.claude/skills/site-replicator/scripts && pnpm install && pnpm exec playwright install chromium
```

**脚本用法约定**：所有 `node scripts/<name>.mjs ...` 命令均从 skill 根目录执行，或在命令中使用绝对路径（`~/.claude/skills/site-replicator/scripts/<name>.mjs`）。

---

## 浏览器工具探测顺序（方案 A）

优先级从高到低：

1. **Playwright MCP**（`mcp__plugin_playwright_playwright__*`）：首选，功能最完整，支持网络拦截、evaluate、截图等。
2. **Chrome DevTools MCP**（`mcp__ChromeDevTools__*`）：次选，适合 performance trace、内存快照等 DevTools 协议场景。
3. **Bash + 脚本**（`scripts/capture.mjs` 等）：最终回退，脚本内置 Playwright 作为无 MCP 环境的兜底。

分工原则：**MCP 负责交互探查/截图/动效录制（看与判断），脚本负责批量下载/像素 diff/DOM diff（算与搬）。**

> **注意**：浏览器 MCP（Playwright / Chrome DevTools）需在宿主环境单独启用；若不可用，自带的 `scripts/`（基于 Playwright）即为无需 MCP 的保底回退路径，核心抓取/对比（capture/dom-diff/visual-diff）均可不依赖 MCP 完成。

---

## 配置读取

读取工作目录下可选的 `site-replicator.config.json`（字段详见 `references/output-targets.md`），调用参数可覆盖配置文件。关键字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `outputTarget` | `"L1"` | 输出层级：`L1`（独立静态站）/ `L2`（融入目标项目）/ `L3`（固定栈重建） |
| `l3Stack` | `{ framework: "next", styling: "tailwind", typescript: true }` | L3 固定栈配置（仅 L3 生效） |
| `deobfuscation` | `"tier1"` | 反混淆级别：`tier1`（仅动效核心模块）/ `tier2`（全量，耗时高） |
| `breakpoints` | `[1440, 768, 375]` | 截图与对比的断点（px） |
| `fidelityThreshold` | `{ pixel: 0.98, structure: 0.90, style: 0.85 }` | 三项分别的验收门控阈值 |

---

## 模式路由 / 决策树

```
用户给单个 URL
  → 单页模式 → 走 references/01-page-pipeline.md

用户给站点根 URL 或要求整站复刻
  → 整站模式 → 先 references/02-site-discovery.md（发现+去重+用户确认）
              → 再对每页走 references/01-page-pipeline.md

指定 outputTarget
  → 走对应 L1 / L2 / L3 → 详见 references/output-targets.md
```

---

## 五步管线概览

| 步骤 | 名称 | 工具/脚本 | 详见 |
|:---:|---|---|---|
| 1 | 结构抓取 | `scripts/capture.mjs` | `references/01-page-pipeline.md` |
| 2 | 资源下载本地化 | `scripts/download-assets.mjs` | `references/03-asset-extraction.md` |
| 3 | 分级反混淆 | 浏览器 MCP + Prettier/shuji | `references/04-deobfuscation.md` |
| 4 | 结构+样式+像素三重对比 | `scripts/dom-diff.mjs` + `scripts/visual-diff.mjs` | `references/05-visual-verification.md` |
| 5 | 动效复刻 | 浏览器 MCP + 手工编码 | `references/06-animation.md` |

每步的详细操作、产物落盘结构、回修闭环规则均在对应 reference 中，本文件不展开。

---

## 脚本速查表

| 脚本 | 用途 | CLI | 详见 |
|---|---|---|---|
| `capture.mjs` | 多断点截图 + DOM/网络快照 | `node scripts/capture.mjs <url> --out <dir> [--breakpoints 1440,768,375] [--timeout 60000]` | `references/01-page-pipeline.md` |
| `download-assets.mjs` | 批量下载静态资源并重写引用 | `node scripts/download-assets.mjs --network <network.json> --html <dom.html> --out <dir>` | `references/03-asset-extraction.md` |
| `dom-diff.mjs` | DOM 结构 + 计算样式对比，输出 report.json | `node scripts/dom-diff.mjs --orig <url> --clone <url> --out <report.json>` | `references/05-visual-verification.md` |
| `visual-diff.mjs` | 像素级差异热力图，输出 diff.png + score | `node scripts/visual-diff.mjs --orig <a.png> --clone <b.png> --out <diff.png> [--threshold 0.1]` | `references/05-visual-verification.md` |

---

## 闭环纪律

对比任一分项低于门控阈值，**禁止宣称复刻完成**。回修流程：

1. 从 `dom-report.json` 的 `mismatches[].path` 定位差异节点，修改 clone。
2. 重跑 Step 4（重新截图 → visual-diff → dom-diff），直至全部达标。
3. 自动指标全部通过后，还需**人工打开 report.html 目视确认**（热力图无明显红区、导航/Hero/CTA/Footer 视觉一致）。

**默认门控阈值**（来自 `references/05-visual-verification.md`）：

| 指标 | 门控 |
|---|---|
| visual-diff `score`（各断点） | ≥ 0.98 |
| dom-diff `structureScore` | ≥ 0.90 |
| dom-diff `styleScore` | ≥ 0.85 |

两个关卡（自动指标 + 人工确认）均通过，方可归档。

---

## 非目标 / 边界

- **不复刻后端/接口逻辑**：只复刻前端可见产物（HTML/CSS/JS/静态资源）与交互动效。
- **不绕过登录/付费墙**：除非用户提供合法的 Cookie 或 token 凭据，脚本不自动尝试认证。
- **不做规模化抓取或对抗检测**：内链爬取默认深度 2 层，相邻请求限速，尊重 robots.txt Disallow 规则。
- **仅用于授权范围内复刻**：使用前请确认目标站使用条款允许复刻；本 skill 不承担法律责任。
- **反混淆仅为可读性**：分级反混淆的唯一目的是理解动效逻辑，不用于破解授权、提取加密密钥或二次销售还原代码。
