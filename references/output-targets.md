# 三层输出形态

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。输出层级（L1/L2/L3）在调用 skill 时通过 `site-replicator.config.json` 指定，或在命令行参数中覆盖。

---

## 一、三层概览

| 层级 | 名称 | 核心特征 | 适用场景 |
|---|---|---|---|
| **L1** | 独立静态站 | 框架无关，HTML + 本地资源，可直接在浏览器打开 | 快速预览、临时归档、不需要与任何框架集成 |
| **L2** | 融入目标项目 | 拆分为宿主项目现有技术栈的组件，遵循宿主约定 | 将复刻结果直接集成进现有代码库 |
| **L3** | 固定栈重建 | 渐进重写为 Next.js + React + Tailwind + TS，每区块卡门禁 | 需要一份可长期维护的独立代码库 |

---

## 二、L1 — 独立静态站

### 2.1 产物构成

L1 的成品即 `download-assets.mjs` 的直接产出（见 `03-asset-extraction.md`），无需任何额外处理：

```
.site-replicator/<host>/<page-slug>/clone/
├── index.html          ← 完整页面，所有外部 URL 已重写为本地路径
├── asset-map.json      ← 原 URL → 本地路径映射（download-assets.mjs 产出）
└── assets/
    ├── css/            ← 样式文件
    ├── js/             ← JavaScript 文件
    ├── fonts/          ← Web 字体
    ├── images/         ← 图片
    └── media/          ← 视频、音频等
```

> **整站模式下的 L1 形态**：多页复刻时不再每页一个 `clone/` 目录，而是统一产出 `.site-replicator/<host>/pages-build/`（每页一个 HTML 文件 + 全站共享一份 `assets/`，页间互链已重写为本地文件名），由 `scripts/run-pages.mjs` 生成，详见 `02-site-discovery.md` 第五节。

### 2.2 使用方式

直接在浏览器中打开 `clone/index.html`，或用任意静态文件服务器托管：

```bash
# 方式 1：直接打开（部分浏览器对 file:// 的 CORS 有限制）
open .site-replicator/example.com/home/clone/index.html

# 方式 2：托管后访问（推荐，可用于 dom-diff 对比）
npx serve .site-replicator/example.com/home/clone --listen 3000
```

### 2.3 L1 的局限性

- JS 框架运行时（React、Vue 等）若已内联在 bundle 中，则可正常运行；若原站依赖 SSR 的服务端数据注入，静态 HTML 可能缺少动态数据。
- 对于 Lottie JSON 文件等非标准静态资源（`xhr`/`fetch` 类型），需手动补充下载（见 `06-animation.md` 第三节 3.4）。
- L1 是 L3 的「黄金基准」，L3 重写时所有对比均以 L1 clone 为参照（而非直接对原站），以避免误差叠加。

---

## 三、L2 — 融入目标项目

### 3.1 核心原则

L2 是将 L1 克隆拆解为**宿主项目当前技术栈**的组件，并按宿主项目的约定放置和组织代码。执行 L2 之前，必须先读取宿主项目的 CLAUDE.md，了解其组件、样式、状态管理约定。

### 3.2 宿主项目约定优先

以 `yunuo-web`（宿主项目）的 CLAUDE.md 为例，L2 复刻须遵循以下约定：

**组件组织：**
- 判断复刻结果是否是全局组件（如导航栏、Footer），若是，放在 `src/components/` 下。
- 仅当前页面使用的组件，放在该页面路由目录同级的 `components/` 下。
- 若同路径不同页面共用组件，放在路径目录的 `components/` 下。
- 组件必须以**文件夹形式**创建（`components/HeroSection/index.tsx`），不使用单文件形式（`components/HeroSection.tsx`）。

**样式约定：**
- 页面级样式必须加页面的 `id` 或 `class` 前缀作用域，避免全局污染。
- 全局样式变更前先搜索是否有冲突定义，确认无冲突后才提到全局。

**跨层参数传递：**
- 需要跨越多层级传递的参数（如主题色、断点、用户偏好），使用 React Context，不用 props 层层透传。

### 3.3 L2 拆解流程

1. **区块划分**：对照 L1 clone 的 `dom-tree.json`，识别视觉上独立的区块（Hero、导航、Feature 列表、CTA、Footer 等），每个区块对应一个组件。
2. **JSX/TSX 转写**：将 HTML 结构转为宿主项目使用的 JSX/TSX 格式。
3. **样式迁移**：根据宿主项目现有技术栈选择样式方案（Tailwind、CSS Modules、styled-components 等），将原站 CSS 转换为对应形式。
4. **动效迁移**：按 `06-animation.md` 的方式，在宿主项目惯用的动效库（或原站同款库）中重现动效。
5. **数据结构化**：将原站硬编码的文本、图片路径提取为 props 或配置对象，以便后续维护。

### 3.4 验证

L2 组件集成进宿主项目后，对复刻的路由页面重新运行 `05-visual-verification.md` 的三重对比，确认与 L1 基准（或原站）的相似度：

- `visual-diff score` ≥ 0.98
- `structureScore` ≥ 0.90
- `styleScore` ≥ 0.85

---

## 四、L3 — 固定栈重建

### 4.1 L3 的核心思路：渐进重写 + 双重基准

L3 不是一次性全量重写，而是以区块为单位渐进进行，每个区块重写后立即对比 L1 基准，通过后才继续下一个区块：

```
         L1 黄金基准（clone/index.html）
                │
                │ 划分区块
                ▼
    ┌───────────────────────┐
    │  区块 1：Hero Section  │
    │  HTML → JSX           │
    │  CSS → Tailwind 类     │
    │  动效迁移（见 06）     │
    └──────────┬────────────┘
               │ 区块门禁：shot-el 对 L1 与 L3 同一区块
               │ 选择器各截一张 → visual-diff 元素图 ≥ 0.98
               ├── 否：回修区块 1
               ▼ 是
    ┌───────────────────────┐
    │  区块 2：Navigation    │
    │  ...                  │
    └──────────┬────────────┘
               │ 通过？
               ▼ 是
              ...
               │
               ▼ 所有区块通过
    ┌───────────────────────┐
    │  整页终检（此时才跑全页三重对比）│
    │  ① 对 L1：visual-diff + dom-diff │
    │  ② 对原站：再做一次总对比        │
    └───────────────────────┘
```

**区块门禁为什么必须用元素级对比（shot-el），而不是整页三重对比：**

- 建到第 k 个区块时页面是**半成品**：dom-diff 的线性索引对齐会从缺失区块开始全线错位，structureScore 必然崩，跑了也无法解读。
- visual-diff 的 crop-to-min 恰好裁掉未建部分，看似能用，实则依赖「区块严格自上而下追加」这一未声明前提，且每区块跑一次全页抓取+全图 diff，成本是元素级对比的 10 倍以上。
- 正确姿势：`shot-el.mjs --url <L1 服务> --sel <区块选择器>` 与 `--url <L3 服务> --sel <对应选择器>` 各截一张，`visual-diff.mjs` 比对元素图（≥ 0.98），必要时 `stitch.mjs` 并排目视。**整页 visual-diff + dom-diff 只在全部区块完成后执行**（先对 L1，再对原站）。

**L3 参与对比时用 production 构建**：`next build && next start` 后再截图对比——dev 模式的按需编译、HMR、hydration 时序都会引入与重写质量无关的噪声。

**为何对比 L1 而非直接对比原站：**

每个区块重写时，若直接与原站比较，原站的实时渲染（字体加载、JS 初始化时序、网络延迟）会引入额外误差，导致指标虚低且难以归因。以 L1 静态快照为参照，误差来源单一（仅为重写质量），便于精准定位问题。所有区块通过后，最后再对原站做一次总对比作为最终验收。

### 4.2 重写映射规则

#### HTML → JSX

| 原 HTML | JSX 转写 |
|---|---|
| `class="..."` | `className="..."` |
| `for="..."` | `htmlFor="..."` |
| `<img src="...">` | `<img src="..." alt="..." />` |
| 内联事件 `onclick="..."` | `onClick={() => ...}` |
| 自闭合标签（`<br>`、`<input>`） | 加斜杠（`<br />`、`<input />`） |
| HTML 注释 `<!-- -->` | `{/* */}` |

#### CSS / 内联样式 → Tailwind

优先将所有样式转换为 Tailwind 原子类。**数值换算优先用任意值语法精确还原**（原站 `padding:70px` → `p-[70px]`，而非就近取 scale 的 `p-16`/`p-20`）——就近归一每处差几像素，styleScore 与像素分会被持续吃掉且难以归因；确认视觉一致后如需美化再统一归一到 scale。对以下情况使用 CSS Module 或 global CSS 补充：

- Tailwind 无法表达的复杂 `@keyframes` 动效（写入 `globals.css` 或对应的 CSS Module）。
- 计算值（如 `calc(100vh - 64px)`）——可用 Tailwind 的任意值语法 `h-[calc(100vh-64px)]`，若过于复杂则退回 CSS Module。
- 第三方库的样式覆盖（如自定义 Splide 轮播样式），写在页面级 CSS Module 中并加页面 class 前缀。

#### 设计 Token 提取

从原站 CSS 中提取颜色、字体、间距等设计 token，在 `tailwind.config.ts` 的 `theme.extend` 中声明：

```typescript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          primary: '#1A1A2E',
          accent: '#E94560',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'sans-serif'],
      },
      spacing: {
        '18': '4.5rem',
        '22': '5.5rem',
      },
    },
  },
};
```

#### 动效迁移到栈惯用法

| 原站动效 | L3 Next.js + Tailwind + TS 迁移方式 |
|---|---|
| CSS `@keyframes` | 保留为 `globals.css` 或 Tailwind `theme.extend.keyframes` |
| CSS `transition` | Tailwind `transition-*`、`duration-*`、`ease-*` 原子类 |
| GSAP / ScrollTrigger | 在 `useEffect` 中初始化，组件卸载时 `gsap.killTweensOf()` 清理 |
| AOS | 在 `_app.tsx` 的 `useEffect` 中调用 `AOS.init()`；组件上保留 `data-aos-*` 属性 |
| Framer Motion | 直接在 JSX 中使用 `<motion.div>` 等，详见 `06-animation.md` 第三节 3.3 |
| Lottie | 使用 `@lottiefiles/react-lottie-player` 或 `lottie-react` 封装为组件 |

详细动效迁移方法见 `06-animation.md`。

### 4.3 L3 固定栈配置

L3 默认使用 Next.js + React + Tailwind CSS + TypeScript。

**目录结构（单页复刻示例）：**

```
<project-root>/
├── src/
│   ├── app/
│   │   └── page.tsx              ← 复刻页面入口
│   ├── components/               ← 全局组件（导航、Footer）
│   │   ├── Navigation/
│   │   │   └── index.tsx
│   │   └── Footer/
│   │       └── index.tsx
│   └── page-components/          ← 页面级区块组件
│       ├── HeroSection/
│       │   └── index.tsx
│       ├── FeatureList/
│       │   └── index.tsx
│       └── CTASection/
│           └── index.tsx
├── public/
│   └── assets/                   ← 从 L1 clone/assets/ 迁移的静态资源
├── tailwind.config.ts            ← 包含从原站提取的 design token
└── globals.css                   ← @keyframes 和不可 Tailwind 化的全局样式
```

---

## 五、配置文件格式（site-replicator.config.json）

在工作目录（或 skill 调用参数中）提供 `site-replicator.config.json`，字段如下：

```jsonc
{
  // 输出层级（默认 L1）
  "outputTarget": "L1",          // "L1" | "L2" | "L3"

  // L3 固定栈配置（仅 outputTarget=L3 时生效）
  "l3Stack": {
    "framework": "next",         // "next"（当前唯一支持项）
    "styling": "tailwind",       // "tailwind"（当前唯一支持项）
    "typescript": true           // 是否使用 TypeScript
  },

  // 反混淆级别（默认 tier1）
  "deobfuscation": "tier1",      // "tier1" | "tier2"

  // 截图与对比的断点（px）
  "breakpoints": [1440, 768, 375],

  // 三项分别的验收阈值（与 05-visual-verification.md 一致）
  "fidelityThreshold": {
    "pixel": 0.98,               // visual-diff score ≥ 0.98
    "structure": 0.90,           // dom-diff structureScore ≥ 0.90
    "style": 0.85                // dom-diff styleScore ≥ 0.85
  }
}
```

**注意**：`fidelityThreshold` 使用三个分项的独立阈值（pixel/structure/style），而非单一整体阈值。各项阈值的含义、计算方式、已知噪声源见 `05-visual-verification.md` 第四节。

**命令行参数覆盖**（优先级高于配置文件）：

```bash
# 示例：指定 L3 输出，启用 Tier 2 反混淆
site-replicator https://example.com \
  --output-target L3 \
  --deobfuscation tier2 \
  --breakpoints 1440,768,375
```

---

## 六、三层选择决策指引

在启动复刻任务之前，根据需求快速选择输出层级：

```
需要最快的结果，框架无关，直接浏览器打开？
  → 选 L1

需要把复刻结果集成进已有代码库（如 yunuo-web）？
  → 选 L2（先读宿主项目 CLAUDE.md，按其约定组织代码）

需要一份独立的、可长期维护的固定技术栈代码库？
  → 选 L3（Next.js + Tailwind + TS，渐进区块重写，每区块卡门禁）
```

**三层不是互斥的**：L3 的过程必须先完成 L1（黄金基准），因此 L3 = L1 基础上的渐进重写。L2 也建议先完成 L1 确认视觉还原度后再拆组件，避免在未确认视觉还原的状态下过早投入组件重构。
