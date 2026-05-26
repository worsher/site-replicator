# 动效复刻

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。动效复刻是 `01-page-pipeline.md` 中单页管线的 Step 5，在 Step 4 三重对比（见 `05-visual-verification.md`）通过后执行。

---

## 一、动效复刻总策略：先提取，提不出再反推

动效复刻遵循「优先低成本、降级到高成本」的原则：

```
         ┌─────────────────────────────┐
         │  Step 1：提取 CSS 动效       │
         │  @keyframes / transition /   │
         │  animation（最低成本）        │
         └──────────────┬──────────────┘
                        │ 提取失败或不完整
                        ▼
         ┌─────────────────────────────┐
         │  Step 2：识别动画库并复用    │
         │  GSAP / AOS / Framer Motion │
         │  Lottie / Splide             │
         └──────────────┬──────────────┘
                        │ 无法复用（深度定制/无法识别库）
                        ▼
         ┌─────────────────────────────┐
         │  Step 3：浏览器 MCP 录制反推  │
         │  帧序列截图 + performance     │
         │  trace → 重写实现            │
         └──────────────┬──────────────┘
                        │ JS 计算逻辑复杂、无法反推
                        ▼
         ┌─────────────────────────────┐
         │  Step 4：升级反混淆 Tier 2   │
         │  理解 JS 逻辑后重写          │
         │  详见 04-deobfuscation.md    │
         └─────────────────────────────┘
```

---

## 二、Step 1：提取 CSS 动效

### 2.1 扫描 @keyframes

在 `deobf/css/`（Tier 0 格式化后的 CSS，见 `04-deobfuscation.md`）中搜索所有 `@keyframes` 声明：

```bash
grep -n "@keyframes" deobf/css/main.css
```

找到后，将完整的 `@keyframes` 块复制到 clone 的 CSS 中，并确认对应元素上的 `animation` 属性（名称、时长、缓动、播放次数、延迟、填充模式）是否完整保留。

**完整 animation 属性要素清单：**

```css
.hero-title {
  animation:
    fadeInUp              /* @keyframes 名称 */
    0.8s                  /* 时长 */
    cubic-bezier(0.25, 0.46, 0.45, 0.94)  /* 缓动函数 */
    0.2s                  /* 延迟 */
    1                     /* 播放次数（infinite = 无限） */
    forwards;             /* 填充模式：forwards 保留最终帧状态 */
}
```

### 2.2 扫描 transition

对有 hover、focus、active 等状态切换效果的元素，检查 `transition` 属性：

```bash
grep -n "transition" deobf/css/main.css | grep -v "transition:" | grep -v "@"
```

常见形式：

```css
.button {
  transition: background-color 0.3s ease, transform 0.2s ease-out;
}
```

确保 clone 的对应元素上保留了完整的 `transition`，并且对应的状态变化（`:hover`、`.active` 类）也正确复制。

---

## 三、Step 2：识别动画库并复用

现代站点通常使用成熟的动画库而非纯手写 CSS 动效。识别库后，**直接复用其配置和时间线**，无需重写底层实现。

### 3.1 GSAP（含 ScrollTrigger）

**识别特征：**

```javascript
// bundle 中出现以下任意一种
import gsap from 'gsap'
import { ScrollTrigger } from 'gsap/ScrollTrigger'
gsap.to(element, { ... })
gsap.timeline({ ... })
ScrollTrigger.create({ ... })
window.gsap                    // 全局变量注入
```

或在 `network.json` 中出现 `gsap.min.js`、`ScrollTrigger.min.js` 的请求记录。

**复用要点：**

1. 确认 GSAP 版本（从 `network.json` URL 或 bundle 内 `gsap@3.x.x` 字符串中找）。
2. 在 clone 中引入相同版本的 GSAP CDN 或本地文件：
   ```html
   <script src="assets/js/gsap.min.js"></script>
   <script src="assets/js/ScrollTrigger.min.js"></script>
   ```
3. 从 Tier 1 还原的代码中提取 `gsap.to()`/`gsap.timeline()` 调用的完整参数：目标选择器、`x/y/opacity/scale` 等属性、时长、缓动、delay、stagger。
4. 对 ScrollTrigger，提取 `trigger`、`start`、`end`、`scrub`、`pin`、`markers`（调试时用，复刻后移除）等关键参数。
5. 在 clone 中原样重现这些调用，绑定到复刻后的 DOM 节点。

**ScrollTrigger 常见配置示例（供参考）：**

```javascript
gsap.to('.hero-text', {
  y: -50,
  opacity: 1,
  duration: 0.8,
  ease: 'power2.out',
  scrollTrigger: {
    trigger: '.hero-section',
    start: 'top 80%',    // 元素顶部到达视口 80% 位置时触发
    end: 'bottom 20%',
    scrub: 1,            // 与滚动位置联动
  },
});
```

---

### 3.2 AOS（Animate On Scroll）

**识别特征：**

- HTML 元素上有 `data-aos` 属性：
  ```html
  <div data-aos="fade-up" data-aos-duration="800" data-aos-delay="200">
  ```
- `network.json` 中有 `aos.js`/`aos.css` 请求，或 bundle 中有 `AOS.init()` 调用。

**复用要点：**

1. 下载并引入 AOS 的 CSS 和 JS（`download-assets.mjs` 通常已下载）。
2. 找到原站的 `AOS.init()` 调用，提取初始化参数（`duration`、`easing`、`once`、`offset` 等）。
3. 确保 clone 的 HTML 元素上保留了所有 `data-aos-*` 属性。
4. 在 clone 的 JS 中加入相同参数的 `AOS.init()` 调用。

```javascript
AOS.init({
  duration: 800,
  easing: 'ease-in-out',
  once: true,       // 只触发一次，滚动回来不重播
  offset: 100,      // 触发偏移（px）
});
```

---

### 3.3 Framer Motion

**识别特征：**

- bundle 中出现 `framer-motion`、`motion.div`、`AnimatePresence`、`useAnimation`。
- 通常出现在 React/Next.js 项目中。

**复用要点：**

1. Framer Motion 是 React 组件库，**仅适用于 L2/L3 输出**（L1 静态 HTML 不支持）。
2. 从原站 bundle 中（或 Tier 1 还原代码中）提取 `motion.xxx` 组件的 `initial`/`animate`/`exit`/`transition` props。
3. 提取 `whileHover`、`whileInView`、`viewport` 等交互型 props。
4. 在 clone 的 React 组件中使用相同的 Framer Motion 配置复现。

```jsx
<motion.div
  initial={{ opacity: 0, y: 20 }}
  whileInView={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.6, ease: 'easeOut' }}
  viewport={{ once: true, amount: 0.3 }}
>
  内容
</motion.div>
```

---

### 3.4 Lottie

**识别特征：**

- `network.json` 中有 `.json` 文件请求，内容为 Lottie 动画数据（JSON 文件通常较大，5KB~500KB，含 `v`、`fr`、`ip`、`op`、`layers` 等字段）。
- bundle 中出现 `lottie-web`、`lottie.loadAnimation()`、`@lottiefiles/react-lottie-player`、`<dotlottie-player>`。

**复用要点：**

1. `download-assets.mjs` 会将 Lottie JSON 文件作为 `fetch` 或 `xhr` 类型跳过（**非 static 资源类型**），需手动补充下载：
   ```bash
   curl -o clone/assets/lottie/animation.json \
     https://example.com/assets/lottie/animation.json
   ```
2. 从原站提取 `lottie.loadAnimation()` 的参数：`path`（JSON 路径）、`renderer`（svg/canvas/html）、`loop`、`autoplay`、`speed`。
3. 在 clone 中引入 lottie-web 并使用相同参数：
   ```html
   <script src="assets/js/lottie.min.js"></script>
   <script>
   lottie.loadAnimation({
     container: document.getElementById('lottie-hero'),
     renderer: 'svg',
     loop: true,
     autoplay: true,
     path: 'assets/lottie/animation.json',
   });
   </script>
   ```

---

### 3.5 Splide（轮播）

**识别特征：**

- HTML 中有 `class="splide"` 的容器结构：
  ```html
  <div class="splide">
    <div class="splide__track">
      <ul class="splide__list">
        <li class="splide__slide">...</li>
      </ul>
    </div>
  </div>
  ```
- `network.json` 中有 `splide.min.js`/`splide.min.css` 请求。
- bundle 中出现 `new Splide()`。

> **注意**：宿主项目（如本 skill 当前工作的 yunuo-web）可能已经使用 Splide，复刻时应与宿主项目使用相同版本，避免版本冲突。

**复用要点：**

1. 提取 `new Splide(selector, options)` 中的完整 options 对象：`type`（loop/slide/fade）、`perPage`、`perMove`、`gap`、`autoplay`、`interval`、`speed`、`easing`、`pagination`、`arrows` 等。
2. 确保 clone HTML 结构使用标准 Splide 类名（`.splide`/`.splide__track`/`.splide__list`/`.splide__slide`）。
3. 在 clone 中引入相同版本的 Splide CSS 和 JS，初始化时传入提取的配置。

---

## 四、Step 3：浏览器 MCP 录制反推

当 CSS 提取不完整、或库无法识别/复用时，用浏览器 MCP 录制动效的实际表现。

### 4.1 帧序列截图（关键时间点）

对时间型动效（如 hover 后渐入、页面加载后飞入），在动效的关键时间点截图：

| 时间点 | 含义 |
|---|---|
| 触发前（0%） | 动效的初始状态（`opacity: 0`、`transform: translateY(20px)` 等） |
| 中途（50%） | 动效进行到一半的过渡状态 |
| 完成后（100%） | 动效结束状态（`opacity: 1`、`transform: none`） |

用浏览器 MCP 操作：

```javascript
// 触发前截图
await page.screenshot({ path: 'anim-frame-0.png' });

// 触发 hover 并在 200ms 后截图（假设动效时长 400ms）
await page.hover('.button');
await page.waitForTimeout(200);
await page.screenshot({ path: 'anim-frame-50.png' });

// 等待动效完成后截图
await page.waitForTimeout(300);
await page.screenshot({ path: 'anim-frame-100.png' });
```

### 4.2 Performance Trace 读取时序

使用 Chrome DevTools MCP 的 performance trace 功能，捕获动效的精确时序数据：

1. 在浏览器 MCP 中启动 performance trace（`mcp__ChromeDevTools__performance_start_trace`）。
2. 触发目标动效（scroll、hover、click）。
3. 停止 trace（`mcp__ChromeDevTools__performance_stop_trace`），分析 trace 中的关键帧数据：
   - **时长（duration）**：从动效开始帧到结束帧的时间差。
   - **缓动函数**：从 Compositing 层的矩阵变换序列中推算（匀速 → linear，先快后慢 → ease-out，先慢后快 → ease-in，S 型 → ease-in-out）。
   - **触发时机**：记录 IntersectionObserver 回调或 scroll 事件的触发时刻与视口位置的关系。

### 4.3 根据录制结果重写实现

有了时长、缓动、关键帧数据后，在 clone 中用 CSS `@keyframes` + `animation` 或等效的动画库 API 重写实现，**不依赖原始 JS 代码**。

---

## 五、滚动触发类动效的还原要点

滚动触发（scroll-linked）和视口进入（IntersectionObserver）动效需要特别注意以下参数的精确还原：

### 5.1 触发阈值

`IntersectionObserver` 的 `threshold` 参数控制元素需要进入视口多少比例后才触发动效。常见值：

- `0`：元素刚露出一个像素即触发（最早）。
- `0.3`：元素 30% 进入视口时触发（默认感觉最自然）。
- `1`：元素完全进入视口才触发（最晚，高元素可能永远不触发）。

从原站代码中找到 `new IntersectionObserver(callback, { threshold: X })` 的具体值后，在 clone 中保持一致。

### 5.2 缓动函数

自定义缓动通常用 `cubic-bezier(x1, y1, x2, y2)` 表示。从原站 CSS 或 GSAP 配置中提取精确值，而非用近似的 `ease`/`ease-in-out` 代替——细微的缓动差异在视觉对比中会导致像素 score 下降。

常见映射关系：

| GSAP easing | CSS 等效 |
|---|---|
| `power2.out` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` |
| `power3.inOut` | `cubic-bezier(0.645, 0.045, 0.355, 1.0)` |
| `back.out(1.7)` | `cubic-bezier(0.34, 1.56, 0.64, 1.0)` |

### 5.3 视差（Parallax）

视差效果通常将元素的 `translateY` 与 `scrollY` 线性绑定，公式为：

```
translateY = scrollY × parallaxFactor
```

`parallaxFactor` 通常在 0.1~0.5 之间（正值向下、负值向上移动）。从 Tier 1 还原的 scroll 事件处理函数中提取这个系数，在 clone 中用 `requestAnimationFrame` + CSS transform 实现：

```javascript
window.addEventListener('scroll', () => {
  requestAnimationFrame(() => {
    const offset = window.scrollY * 0.3; // parallaxFactor = 0.3
    parallaxEl.style.transform = `translateY(${offset}px)`;
  });
});
```

---

## 六、动效验证

### 6.1 关键时间点截图比对

动效因时间不确定性，不适合在随机时刻做像素对比——截图时机稍有偏差，像素 score 会虚低。正确做法是在**受控的关键时间点**分别截图，再走 `visual-diff.mjs` 逐帧比对。

具体流程：

1. 在**原始站**，用浏览器 MCP 在动效的 0%/50%/100% 时间点截图（保存为 `orig-anim-0.png`、`orig-anim-50.png`、`orig-anim-100.png`）。
2. 在 **clone** 中，用相同的时序触发相同时间点的截图（保存为 `clone-anim-0.png`、`clone-anim-50.png`、`clone-anim-100.png`）。
3. 对每个时间点运行 `visual-diff.mjs`：
   ```bash
   for FRAME in 0 50 100; do
     node scripts/visual-diff.mjs \
       --orig  orig-anim-${FRAME}.png \
       --clone clone-anim-${FRAME}.png \
       --out   diff-anim-${FRAME}.png \
       --threshold 0.1
   done
   ```
4. 检查各帧的 `score` 是否均 ≥ 0.98（阈值详见 `05-visual-verification.md` 第四节）。

### 6.2 动画帧比对的特殊说明

- **不用单帧像素阈值死卡中间帧**：动效的 50% 帧因浏览器渲染时序偏差，像素 score 通常低于静态帧。建议对 0% 和 100%（静止态）严格卡 ≥ 0.98，对 50%（过渡态）可放宽至 ≥ 0.90。
- **高度差异处理**：若动效导致页面高度变化（如展开/收起），需注意 `visual-diff.mjs` 的 crop-to-min 行为（详见 `05-visual-verification.md` 第二节），底部区域需人工目视确认。

---

## 七、与反混淆的关系

当动效无法通过 CSS 提取（Step 1）或库识别复用（Step 2）实现，需要理解 JS 计算逻辑时，升级反混淆 Tier 级别：

| 动效复杂度 | 对应反混淆 Tier |
|---|---|
| 纯 CSS 动效（@keyframes/transition） | 无需反混淆 |
| 标准动画库（GSAP/AOS/Lottie/Splide） | Tier 0（仅格式化，用于定位配置参数） |
| 自定义 JS 动效但逻辑可读 | Tier 1（仅还原动效模块） |
| 深度混淆的自定义 JS 计算逻辑 | Tier 2（全量还原，见 `04-deobfuscation.md` 第五节） |

升级到 Tier 2 后，重新理解动效逻辑，据此在 clone 中用标准 API（`requestAnimationFrame`、Web Animations API、GSAP）重写实现，**不直接复用原站混淆后的 JS**（避免潜在的授权问题和维护困难）。
