# 分级反混淆

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。反混淆是 `01-page-pipeline.md` 中单页管线的 Step 3，产出物供 Step 4 三重对比和 Step 5 动效复刻使用。

---

## 一、反混淆的目的

现代站点的 JS/CSS 经过构建工具（webpack、Vite、esbuild 等）的压缩、混淆、代码分割后，变量名被缩短为单字母、控制流被打平、字符串被提取到数组中，直接阅读几乎不可能。

反混淆的**唯一目的**是提升可读性，使复刻人员（或 Claude）能够理解驱动动效和视觉效果的关键代码逻辑。反混淆产出**不用于**破解授权逻辑、绕过付费验证或提取加密密钥，这些行为超出授权复刻的范畴，本 skill 不支持、不指导。

---

## 二、分级总览

| Tier | 触发条件 | 处理范围 | 耗时 | 产出规模 |
|---|---|---|---|---|
| **Tier 0** | 恒做（每次必执行） | 所有 JS/CSS 的格式化 + sourcemap 还原 | 低（秒级） | 格式化后全量代码 |
| **Tier 1** | 默认（智能模式） | 仅驱动视觉/动效的核心模块 | 中（分钟级） | 数个关键模块 |
| **Tier 2** | 配置 `deobfuscation: tier2`（或调用参数 `--deobfuscation tier2`）手动启用 | 全量 JS 深度还原 | 高（数十分钟） | 完整还原代码库 |

---

## 三、Tier 0 — 格式化（恒做）

**无论何种情况，Tier 0 必须执行。** 它是后续一切阅读和分析的基础。

### 3.1 JS 格式化

使用 [Prettier](https://prettier.io/) 或 [js-beautify](https://github.com/beautify-web/js-beautify) 对所有下载到 `clone/assets/js/` 下的 `.js` 文件做美化。**原始压缩文件保留在 `clone/assets/` 不动，先复制到 `deobf/` 后再对副本执行格式化。**

```bash
# Tier 0：先把要美化的资源复制到 deobf/，保留 clone/assets/ 原件不动
mkdir -p deobf
cp -r clone/assets deobf/assets

# 美化副本（原地作用于 deobf/ 内的拷贝）
npx prettier --write "deobf/assets/**/*.{js,css}"
# 或对单个 JS 用 js-beautify（同样作用于副本）
npx js-beautify -r deobf/assets/js/app.js
```

美化后的文件位于 `deobf/assets/`，原始压缩版保留在 `clone/assets/` 不覆盖。

### 3.2 CSS 格式化

CSS 与 JS 一并在上一步的 `cp -r` 和 `prettier --write` 中处理（`deobf/assets/**/*.css`），无需单独再执行。格式化后的 CSS 同样位于 `deobf/assets/css/`。

### 3.3 sourcemap 还原（若存在）

**如何判断是否有 sourcemap：**

- 检查格式化后的 JS 文件末尾是否有注释行：
  ```
  //# sourceMappingURL=app.js.map
  //# sourceMappingURL=data:application/json;base64,eyJ2...
  ```
- 检查 `clone/assets/js/` 目录下是否有 `.map` 后缀文件。
- 检查 `network.json` 中是否有 `*.js.map` 请求记录。

**还原步骤：**

使用 [shuji](https://github.com/paazmaya/shuji) 还原源文件。shuji 读取的是 `.map` sourcemap 文件，而非 `.js` bundle 本身。若 sourcemap 尚未下载，需先获取：通过检查 JS 文件末尾的 `//# sourceMappingURL=` 注释找到 `.map` 文件 URL（或内联 data URI），或直接在 `clone/assets/js/` 目录下查找是否已有 `.map` 文件。

```bash
# 若 sourcemap 未被 download-assets.mjs 自动下载，手动获取
curl -o clone/assets/js/app.js.map https://example.com/assets/js/app.js.map

# 使用 shuji 还原（输入 .map 文件，输出到 deobf/src/）
npx shuji clone/assets/js/app.js.map -o deobf/src/
```

成功时，`deobf/src/` 下会出现按原始目录结构组织的源文件（`.ts`、`.vue`、`.jsx` 等）。

> **提示**：sourcemap 若能成功还原，通常无需 Tier 1/2 的进一步处理——源码已经可读。只有 sourcemap 不存在、不完整或加密时，才需要进入 Tier 1 或 Tier 2。

---

## 四、Tier 1 — 智能深度还原（默认模式）

Tier 1 是默认执行的深度反混淆级别，**只处理驱动视觉效果和动效的核心模块**，其余业务逻辑（路由、数据请求、状态管理）保持黑盒不处理。

### 4.1 如何定位核心动效模块

在 Tier 0 格式化后的代码中，搜索以下关键字，定位相关代码块：

| 关键字 | 说明 |
|---|---|
| `requestAnimationFrame` | 原生 JS 驱动的帧动画 |
| `IntersectionObserver` | 元素进入视口时触发的动效 |
| `scroll` | 滚动联动（scroll-linked）动效 |
| `transition` | CSS transition 动态控制（JS 切换类名或 style） |
| `animation` | CSS animation 动态控制 |
| `gsap` / `GSAP` | GSAP 动画库 |
| `ScrollTrigger` | GSAP ScrollTrigger 插件 |
| `transform` | CSS transform 的 JS 驱动变换 |
| `Lottie` / `lottie` | Lottie 动画播放器 |
| `AOS` / `data-aos` | AOS（Animate On Scroll）库 |
| `Splide` | Splide 轮播库 |

```bash
# 在格式化后的代码中批量搜索
grep -rn "requestAnimationFrame\|IntersectionObserver\|ScrollTrigger\|gsap\|Lottie\|Splide" deobf/assets/js/ \
  | awk -F: '{print $1}' | sort -u
```

搜索结果即为需要深度还原的目标文件列表。

### 4.2 Tier 1 还原操作

对定位到的目标文件，进行以下处理：

1. **变量重命名**：将单字母/混淆变量名（如 `a`、`b`、`_0x1a2b`）根据上下文语义重命名为有意义的名称（如 `animTarget`、`scrollOffset`）。可借助 AST 工具或 Claude 直接阅读后人工重命名。

2. **控制流恢复**：混淆器常把 `if/else`、`switch` 改写为条件运算符链、`while(true)` 加 `break` 的状态机等形式，还原为可读的条件结构。

3. **字符串数组解码（仅涉及动效配置时）**：部分混淆器将字符串（如 easing 函数名 `"ease-in-out"`、CSS 属性名）提取到数组并通过下标引用，还原时替换为字面量。

Tier 1 **不处理**：数据接口、权限验证、第三方 SDK 初始化逻辑等非视觉模块。

### 4.3 产出位置

```
deobf/
├── assets/                      ← Tier 0：clone/assets/ 的格式化副本
│   ├── js/                      ← 格式化后的完整 JS（原始压缩版保留在 clone/assets/js/）
│   │   ├── app.js
│   │   └── vendor.js
│   └── css/                     ← 格式化后的 CSS
│       └── main.css
├── src/                         ← Tier 0 sourcemap 还原的源文件（若存在）
└── tier1/                       ← Tier 1 深度还原的核心动效模块
    ├── animation-core.js        ← 变量重命名 + 控制流恢复后
    └── scroll-controller.js
```

原始压缩文件保留在 `clone/assets/` 下，不覆盖，两份并存。

---

## 五、Tier 2 — 全量深度还原（配置 `deobfuscation: tier2`）

### 5.1 启用条件

Tier 2 应在以下情况下才考虑启用：

- Tier 1 定位到的动效模块逻辑过于复杂，仅靠变量重命名和控制流恢复无法理解其工作方式。
- 动效复刻（见 `06-animation.md`）无法仅凭 CSS 提取 + 黑盒复用库来实现，需要完整理解 JS 计算逻辑（如自定义物理引擎、自定义缓动曲线、WebGL shader 参数计算）。
- 用户明确要求「彻底理解整个站点的前端实现」（如出于学习目的）。

### 5.2 全量还原覆盖内容

| 操作 | 工具/方法 |
|---|---|
| 变量重命名（全量） | 编写自定义 Babel AST transform 脚本，或由 Claude 逐模块阅读格式化后代码、根据语义批量重命名——无现成 off-the-shelf CLI 可完成此步骤 |
| 控制流平坦化还原 | 识别 Obfuscator.io 的 switch-case 状态机模式，还原为顺序结构 |
| 字符串数组解码 | 找到字符串数组声明和解码函数，批量替换所有引用位置 |
| 模块拆分 | 将 webpack bundle 按模块边界（`__webpack_module_factory__`/`__d` 等标记）拆为独立文件 |

### 5.3 耗时与产出规模说明

Tier 2 对大型站点（bundle 超过 1MB）的全量处理可能耗时数十分钟，产出数百个文件。请评估以下成本后再决定是否启用：

- **耗时高**：Claude 需逐文件分析，大型 bundle 的处理时间与文件规模近似线性。
- **产出冗余**：大量还原出的非视觉业务逻辑文件对复刻本身无直接价值。
- **不一定精确**：全量还原属于推断性过程，变量语义可能判断有误，需要人工校验。

**何时值得**：Tier 2 适合在动效实现高度依赖自定义 JS 计算逻辑（而非标准动画库），且 Tier 1 已尝试但仍无法理解时才启用。

### 5.4 产出位置

```
deobf/
└── tier2/                       ← Tier 2 全量还原产物
    ├── modules/                 ← 拆分出的各模块文件
    │   ├── animation.js
    │   ├── router.js
    │   └── ...
    └── full-bundle-deobf.js     ← 未拆分的完整还原版本（可选）
```

---

## 六、Tier 升级判定流程

```
        开始（Step 3：反混淆）
               │
               ▼
          执行 Tier 0
    格式化 + 检查 sourcemap
               │
    ┌──────────┴──────────┐
    │ sourcemap 完整可还原？│
    └──────────┬──────────┘
         是 ──►│ 直接使用源码
               │ 无需 Tier 1/2
         否 ──►│
               ▼
          执行 Tier 1
    仅处理动效核心模块
               │
               ▼
      动效复刻（06-animation.md）
               │
    ┌──────────┴──────────┐
    │ 动效可仅凭 CSS 提取   │
    │ 或黑盒复用库实现？    │
    └──────────┬──────────┘
         是 ──►│ 维持 Tier 1，继续
               │
         否 ──►│
               ▼
   升级 Tier 2（配置 deobfuscation: tier2）
   全量还原后重新分析动效逻辑
```

---

## 七、产物目录汇总

反混淆所有产物统一落在工作目录的 `deobf/` 子目录下，与 `clone/`（L1 产物）并列：

```
.site-replicator/<host>/<page-slug>/
├── original/                   ← capture.mjs 产物（原始站快照）
├── clone/                      ← L1 复刻产物（download-assets.mjs 产物）
│   └── assets/js/app.js        ← 保留原始压缩版，不覆盖
└── deobf/                      ← 反混淆产物
    ├── assets/                 ← Tier 0：clone/assets/ 格式化副本（js/、css/ 在其下）
    ├── src/                    ← Tier 0：sourcemap 还原的源文件（若存在）
    ├── tier1/                  ← Tier 1：核心动效模块深度还原
    └── tier2/                  ← Tier 2：全量深度还原（配置 deobfuscation: tier2 时才产出）
```

**原始文件（`clone/assets/`）始终保留**，`deobf/` 存放的是可读版本副本，两者互不覆盖，可随时对照验证。

---

## 八、边界说明

反混淆操作仅服务于**授权复刻的可读性目的**，具体为：

- 理解动效触发逻辑，以便在 clone 中重现。
- 理解字体/样式加载方式，以便修复 L1 clone 的渲染差异。
- 在 `06-animation.md` 要求理解 JS 计算逻辑时提供参考。

以下用途**不在本 skill 的支持范围内**：

- 提取、破解或绕过付费内容、授权验证、DRM 逻辑。
- 还原并复用他人专有算法（如定价模型、推荐算法）。
- 对还原后的代码进行商业发布或二次销售。

如目标站的使用条款明确禁止反向工程，用户须在启动复刻前自行确认合规性；本 skill 不承担法律责任。
