# 单页复刻总流程

> **路径约定**：本文档中所有 `scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。执行命令时，请先 `cd ~/.claude/skills/site-replicator`，或在命令中使用绝对路径。

---

## 一、总流程图

```
┌─────────────────────────────────────────────────────────────────────┐
│                         单页复刻流水线                               │
└─────────────────────────────────────────────────────────────────────┘

  目标 URL
      │
      ▼
┌─────────────┐
│  Step 1     │  capture.mjs
│  页面抓取   │  ─────────────────────────────────────────────────────
│             │  输入：目标 URL
│             │  产出：dom.html / dom-tree.json / network.json
│             │        screenshots/1440.png / 768.png / 375.png
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Step 2     │  download-assets.mjs
│  资源本地化 │  ─────────────────────────────────────────────────────
│             │  输入：network.json + dom.html
│             │  产出：assets/...（已下载资源树）
│             │        asset-map.json（URL → 本地路径映射）
│             │        index.html（= L1 克隆，URL 已重写为本地路径）
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Step 3     │  浏览器 MCP / 人工
│  反混淆     │  ─────────────────────────────────────────────────────
│             │  对 JS 混淆/压缩代码做可读化处理
│             │  探查动画触发逻辑、自定义字体加载方式
│             │  产出：理解层（无文件落盘；必要时注释到克隆代码里）
└──────┬──────┘
       │
       ▼
┌─────────────┐
│  Step 4     │  dom-diff.mjs  +  visual-diff.mjs
│  三重对比   │  ─────────────────────────────────────────────────────
│             │  ① 像素对比：visual-diff（score、热力图 diff.png）
│             │  ② DOM 结构对比：dom-diff structureScore
│             │  ③ 样式对比：dom-diff styleScore
│             │  产出：dom-report.json、diff-<bp>.png、report.html
└──────┬──────┘
       │  未达阈值？
       ├──────── 是 ──────────────────────────────┐
       │                                          ▼
       │                               ┌──────────────────┐
       │                               │  Step 5 回修闭环  │
       │                               │  dom-diff mismatches[].path
       │                               │  定位节点 → 修改 clone
       │                               │  → 重跑 Step 4   │
       │                               └────────┬─────────┘
       │                                        │
       │◄───────────────────────────────────────┘
       │  全部达阈值 + 人工确认
       ▼
┌─────────────┐
│  Step 5     │  浏览器 MCP + 手工
│  动效复刻   │  ─────────────────────────────────────────────────────
│             │  CSS transition / animation / GSAP / Lottie 等逐一
│             │  实现到 clone；用浏览器 MCP 录制/回放验证视觉一致
└──────┬──────┘
       │
       ▼
   复刻完成（report.html 归档）
```

---

## 二、工作目录结构（落盘约定）

所有产物统一落在：

```
.site-replicator/<host>/<page-slug>/
├── original/                    ← capture.mjs 产物（原始站快照）
│   ├── dom.html                 ← 完整序列化 DOM（page.content()）
│   ├── dom-tree.json            ← 轻量 DOM 树（tag/id/classes/children，depth≤5000）
│   ├── network.json             ← 网络请求记录（url/method/resourceType/status/contentType）
│   └── screenshots/
│       ├── 1440.png             ← 全页截图，视口宽 1440px
│       ├── 768.png              ← 全页截图，视口宽 768px
│       └── 375.png              ← 全页截图，视口宽 375px
├── assets/                      ← download-assets.mjs 下载的静态资源（保留原始路径结构）
├── asset-map.json               ← { "https://…/foo.css": "assets/foo.css", … }
├── clone/                       ← L1 克隆产物
│   └── index.html               ← 引用已重写为本地路径的完整页面
├── diff-1440.png                ← visual-diff 热力图（各断点各一张）
├── diff-768.png
├── diff-375.png
├── dom-report.json              ← dom-diff 完整报告
└── report.html                  ← 三断点汇总报告（含评分 + 热力图）
```

> `<host>` 取目标 URL 的 hostname（如 `example.com`）；`<page-slug>` 取 URL pathname 的 slug 化结果（如首页用 `home`，`/products/foo` → `products-foo`）。

---

## 三、五步与脚本/工具映射表

| 步骤 | 名称 | 输入 | 产出 | 工具/脚本 |
|:---:|------|------|------|-----------|
| 1 | 页面抓取 | 目标 URL | `original/`（dom.html、dom-tree.json、network.json、screenshots/） | `scripts/capture.mjs` |
| 2 | 资源本地化 | network.json、dom.html | `assets/`、asset-map.json、`clone/index.html` | `scripts/download-assets.mjs` |
| 3 | 反混淆 | clone/index.html、assets/*.js | 理解层；必要时注释/格式化代码 | 浏览器 MCP（交互探查）、Playwright evaluate |
| 4 | 三重对比 | original/screenshots、clone URL、原始 URL | dom-report.json、diff-\<bp\>.png、report.html | `scripts/dom-diff.mjs`、`scripts/visual-diff.mjs` |
| 5 | 动效复刻 | 反混淆结果、浏览器录制 | 带动效的最终 clone | 浏览器 MCP（录制/回放）、手工编码 |

---

## 四、回修闭环规则

**核心原则：对比未达标，禁止宣称复刻完成。**

回修的完整闭环如下：

1. **触发条件**：Step 4 产出的任何一项指标低于阈值（各阈值见 `05-visual-verification.md`），需进入回修。

2. **定位差异节点**：从 `dom-report.json` 的 `mismatches` 数组中取 `path` 字段，即可精确定位到 clone 中偏差的节点。`path` 格式为 `body/div[0]/section[2]/…`，可直接用作 CSS/JS 选择器参考。

3. **分类处理**：
   - `type: "structure"`：结构差异，检查 clone 中该路径的 DOM 层级是否多/少节点（常见于第三方注入的 analytics/chat widget）。
   - `type: "style"`：样式差异，查看 `prop`/`orig`/`clone` 三字段，对照修改 clone 中对应节点的 CSS。

4. **重跑对比**：修改 clone 后，重新执行 Step 4（capture + dom-diff + visual-diff），直到全部阈值通过。

5. **人工确认**：自动阈值全部通过后，还需要人工打开 report.html，目视检查热力图与关键模块（导航、Hero、CTA、Footer）的视觉一致性，确认后方可归档。

---

## 五、编排分工说明（方案 A）

### 浏览器 MCP — 「看与判断」

浏览器 MCP 负责所有需要**感知与交互**的环节：

- 打开目标页面，探查 hover、scroll、click 触发的动态效果
- 截图用于视觉比对前的人工预审
- 录制 CSS/JS 动效的触发时序
- 在反混淆阶段执行 `page.evaluate()` 提取运行时数据

**浏览器工具探测优先级（由高到低）**：

1. **Playwright MCP**（`mcp__plugin_playwright_playwright__*`）：首选，功能最完整，支持网络拦截、evaluate、截图等。
2. **Chrome DevTools MCP**（`mcp__ChromeDevTools__*`）：次选，适合需要 DevTools 协议的场景（性能分析、内存快照）。
3. **Bash + 脚本**（`scripts/capture.mjs` 等）：兜底方案，脚本内置 Playwright 作为可移植的无浏览器 MCP 环境回退。

### npm 脚本 — 「算与搬」

`scripts/` 下的脚本负责所有**批量、确定性**的工作：

- `capture.mjs`：批量多断点截图 + 网络日志收集（无需人工干预）
- `download-assets.mjs`：批量下载 + 引用重写（算法确定性强）
- `dom-diff.mjs`：结构/样式评分（数值可量化、可记录）
- `visual-diff.mjs`：像素级差异热力图（客观、可归档）

---

## 六、完整单页 L1 复刻命令示例

以下命令演示从零到 L1 验证的完整流程（假设目标站为 `https://example.com`，在 skill 根目录下执行）：

```bash
# 0. 进入 skill 根目录
cd ~/.claude/skills/site-replicator

# 1. 抓取原始站（三断点全量截图）
node scripts/capture.mjs https://example.com \
  --out .site-replicator/example.com/home/original \
  --breakpoints 1440,768,375 \
  --timeout 60000

# 2. 下载并本地化所有静态资源，生成 L1 clone
node scripts/download-assets.mjs \
  --network .site-replicator/example.com/home/original/network.json \
  --html    .site-replicator/example.com/home/original/dom.html \
  --out     .site-replicator/example.com/home/clone

# 3. 用本地 HTTP 服务托管 clone（比较时 dom-diff 需要 URL）
npx serve .site-replicator/example.com/home/clone --listen 3000 &
CLONE_URL="http://localhost:3000"

# 4a. 抓取 clone 截图（三断点）
node scripts/capture.mjs $CLONE_URL \
  --out .site-replicator/example.com/home/clone-cap \
  --breakpoints 1440,768,375

# 4b. 像素对比 — 每个断点各跑一次
for BP in 1440 768 375; do
  node scripts/visual-diff.mjs \
    --orig  .site-replicator/example.com/home/original/screenshots/${BP}.png \
    --clone .site-replicator/example.com/home/clone-cap/screenshots/${BP}.png \
    --out   .site-replicator/example.com/home/diff-${BP}.png \
    --threshold 0.1
done

# 4c. DOM 结构 + 样式对比
node scripts/dom-diff.mjs \
  --orig  https://example.com \
  --clone $CLONE_URL \
  --out   .site-replicator/example.com/home/dom-report.json

# 5. 查看评分（terminal 输出已打印 JSON；也可读文件）
cat .site-replicator/example.com/home/dom-report.json | \
  node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
    console.log('structureScore:', d.structureScore, '/ styleScore:', d.styleScore, '/ mismatches:', d.mismatches.length)"
```

执行后，检查各指标是否达标（阈值详见 `05-visual-verification.md`）。如未达标，根据 `dom-report.json` 的 `mismatches[].path` 定位节点，修改 clone，再从步骤 4a 重跑，直至全部通过并完成人工确认。
