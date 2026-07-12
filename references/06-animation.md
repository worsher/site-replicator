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

## ⚠️ 前置：先拆运行态快照的「冻结」与「隐藏」

`capture.mjs` 存的是 `page.content()`——**运行后的 DOM 快照**。JS 组件已经把运行态写进了 DOM，静态复刻时若不还原，会表现为「**模块在原站好好的，在 clone 里消失或错位**」。这往往被误判成资源缺失，实则是组件状态没处理。动效还原之前**先排查这两类**：

### 轮播 / 滑块（Slick、Swiper、Splide 等）

- **症状**：宽度错乱（如 slide 宽 1280 而容器 1710）、出现重复幻灯片、不自动播放。
- **根因**：DOM 里已有库生成的克隆节点和内联冻结尺寸（基于抓取时的视口），`transform: translate3d(...)`、`width: 1280px` 等被定格；重新加载时库在新视口初始化，与定格值打架。
- **识别信号**：`*-initialized` / `*-cloned` 类名；`slick-track` / `swiper-wrapper` 上的内联 `transform`/`width`。
- **处理**：把库生成的 DOM 剥离，**恢复成干净的原始 slide 列表**（去掉 clone 节点、内联尺寸、`*-initialized` 类），让库在页面加载时按当前视口重新初始化（原站的初始化脚本通常已随 JS 一起下载）。

### 滚动揭示（AOS、ScrollReveal、WOW 等）

- **症状**：整块内容在 clone 里**永久不可见**（最易被误报为"丢了一个模块"）。
- **根因**：元素被库打上初始隐藏态（`opacity:0`、`transform: translateY(..)`、`data-aos`/`data-scroll-reveal`），等滚动事件触发才显现；静态快照定格在隐藏态，触发器未接管就一直隐藏。
- **识别信号**：大块内容不可见且元素 `opacity:0` 并带 `data-aos` / `data-scroll-reveal` / `wow` 等属性/类。
- **处理**：若不还原入场动画，最稳的是注入覆盖样式直接显示终态：
  ```css
  [data-aos],[data-scroll-reveal],.wow{opacity:1!important;transform:none!important;-webkit-transform:none!important;}
  ```
  若要保留动画，则确保库脚本随站加载并能在 clone 上重新绑定。

### SSR + 运行时动画（framer-motion / Headless UI 等，⚠️ 无 data-属性可识别）

- **症状**：与 scroll-reveal 相同（整块永久不可见），但元素上**没有** `data-aos`/`wow` 等库标识，只有内联 `style="opacity: 0"` 或定格在中间值的内联 `transform`（如 `width: 92.47%`、`rotateX(-65deg)`）。
- **根因**：framer-motion 的 `whileInView` 默认 `once:false`——capture 滚动采集触发了显现，但**回到顶部序列化时，离开视口的元素又回退到初始隐藏态**，快照落盘的就是 `opacity: 0`。滚动进度驱动的元素（`useScroll`/`useTransform`）则定格在序列化那一刻的插值上。
- **最险的陷阱**：**基线截图与 clone 共享同一定格缺陷**——原站截图也是在同一运行态下拍的，两边"一样地错"，像素/结构/样式三项全部通过，任何分数都发现不了。只有对照活的原站（或用户反馈）才会暴露。
- **处理**：做下面的「运行态定格审计」，逐项归类后要么恢复终态、要么复刻驱动逻辑（见第 1.5 节动效清单）。

### 运行态定格审计（必做，grep 即可，离线可用）

对 clone 序列化 DOM 扫描以下模式，**每一条命中都必须归类处置**，不允许"分数过了就不管"：

```bash
# 1. 定格在隐藏态的元素（最高优先级：这些在 clone 里是隐形的，且像素对比发现不了）
grep -oE 'style="[^"]*opacity: ?0[^"]*"' clone/index.html | sort | uniq -c
# 2. 定格在中间值的内联 transform / 百分比宽度（滚动进度驱动的痕迹）
grep -oE 'style="[^"]*(rotate[XYZ]?\(|translate[XY]?\([^"]*%|width: ?[0-9]+\.[0-9]+%)[^"]*"' clone/index.html | sort | uniq -c | head -20
# 3. 空 canvas（粒子/图表等运行时绘制的内容，序列化后必为空白）
#    注意：序列化 DOM 常为单行，grep -c 数的是行数会恒报 1，必须用 -o | wc -l 数个数
grep -oE '<canvas' clone/index.html | wc -l
```

归类三选一并记录：① **reveal 初始态** → 恢复终态或复刻触发逻辑；② **进度驱动定格** → 归到动效清单里复刻；③ **本就如此的静态样式**（如装饰性随机倾斜）→ 在 bundle 里确认来源后放行。

> **本审计的覆盖边界**：定格在**文本内容**里的动效（计数器停在 "1,283"、打字机停在半句）没有任何样式特征，DOM 审计抓不到——这类只能由下面 1.5 节的 bundle 原语扫描（`requestAnimationFrame`/`setTimeout`）兜底，两份清单必须都跑。

> 一句话：**“消失的模块”先怀疑 scroll-reveal 隐藏、“错位的轮播”先怀疑冻结 DOM**；React/Next 站没有库标识，直接跑「运行态定格审计」。确认不是这几类，再进入下面的动效提取。

---

## 一.5、动效清单：bundle 原语扫描（必做，复刻完成的核销依据）

**为什么必做**：靠浏览器逐个探索原站动效必然有遗漏（hover 类、定时器类、canvas 类都不在滚动路径上）；且原站可能随时不可达。已下载的 JS bundle 是**动效的完整、有限、离线可查的清单来源**。

对 `clone/assets/` 下所有 JS chunk 扫描以下原语，每个命中都是一个待核销的动效：

```bash
C=clone/assets/_next/static/chunks   # 按实际路径调整；Next 的路由目录含 () 元字符，统一用 find 递归，避免 globstar/引号问题
for pat in 'whileHover' 'whileTap' 'whileInView|useInView' 'useScroll|scrollYProgress' \
           'setInterval' 'AnimatePresence' 'animate:\{' 'variants:' \
           'enterFrom|leaveTo' 'IntersectionObserver' 'particle|canvas' 'onMouseEnter' \
           'animationend|animationstart' 'transitionend' 'requestAnimationFrame' \
           'addEventListener\("scroll"|onScroll' 'mousemove|pointermove' \
           '\.animate\(\[|\.animate\(\{' 'registerProperty' 'startViewTransition' \
           'lenis|locomotive|smooth-scroll' 'lottie|\.riv|spline' 'typed|SplitType|splitting'; do
  echo "== $pat =="; find "$C" -name '*.js' -exec grep -lE "$pat" {} + 2>/dev/null
done
# 对每个命中文件，提取参数上下文：
grep -oE '.{150}whileHover.{250}' <chunk>   # 窗口按需放大
```

**排除库文件本身**：framer-motion / tsparticles 等库 chunk（体积大、命中密集但无业务字面量如类名/文案）里的原语是库实现，不算站点动效；业务动效集中在含 Tailwind 类名字符串、站点文案的 chunk 里。

**压缩别名兜底**：生产 bundle 会把 `AnimatePresence` 压成 `X.M` 之类的命名空间成员，字面量扫不到。补充特征：`children:` 里的条件挂载 `xxx===s&&(0,t.jsx)(...)` 配合 `initial:{opacity:0`、以及 `exit:{`（exit 只在 AnimatePresence 内有意义）。同理 `useInView` 常以 hook 别名出现——DOM 审计里发现了 reveal 定格但清单里找不到 `whileInView` 时，按 `initial:{opacity:0` / `exit:{` / IntersectionObserver 反查。

**原语 → 动效类型对照**：

| 原语 | 动效类型 | 典型实现 |
|---|---|---|
| `useScroll`/`useTransform` + `offset:[...]` | 滚动进度驱动（视差/转正/渐显渐隐） | 读出映射区间，rAF + 分段线性插值复刻 |
| `whileHover`/`whileTap` + `variants` | 悬停/按压变体 | mouseenter/leave + CSS 过渡 |
| `whileInView` / `useInView` | 进入视口触发（压缩后常只剩 hook 别名，见上方兜底特征） | IntersectionObserver |
| `setInterval` | 自动轮播/定时切换 | 原样复刻间隔与切换逻辑 |
| `enterFrom/enterTo/leaveFrom/leaveTo`（Headless UI Transition） | 类驱动过渡 | 直接搬 Tailwind 过渡类 + 定时器 |
| `AnimatePresence` + `initial:!1` | 展开/折叠、挂载卸载动画 | 高度/透明度过渡 |
| `onMouseEnter`+`useState` | tooltip / 悬浮卡 | 事件 + 节点增删 |
| `particleDensity`/canvas 绘制 | 粒子/程序化图形 | 轻量 canvas 重写 |
| `animate:{x1/y1...}`（SVG 属性） | 渐变光束/描边动画 | rAF 改 SVG 属性 |
| `addEventListener("animationend"...)` | **CSS 单次动画 + JS 重启循环**（流星/扫光类：keyframes 无 `infinite`，靠 JS 在结束时随机化 CSS 变量并 `animation:'none'`+reflow 重启）。⚠️ 症状：clone 里动画跑一次后停住不消失——CSS 部分正常工作反而掩盖了 JS 缺失 | 原样复刻 end/start 监听器 |

**核销表**：每项动效登记「位置 / 驱动方式 / 参数来源(chunk) / 处置：已复刻｜静态可接受｜放弃(理由)」，全部核销后 Step 5 才算完成。数据（文案、价格、人名等）通常与动效代码同 chunk 或在相邻 chunk 的数组字面量里，一并提取，**不要凭截图肉眼抄**。

**注入实现的两个坑**（把动效脚本写回 clone 时）：

1. `String.replace('</body>', 补丁)` 的替换串里若含 `$'`、`$\``（如价格拼接 `'$' +`），会被当作特殊替换模式展开导致脚本损坏——**始终用函数形式** `html.replace('</body>', () => 补丁)`。
2. 用 JS 模板字符串包裹注入脚本时，`\$`、`\\` 等转义会被模板字符串先消费一层（`/\$/` 送达后变成 `/$/`，守卫恒真）——正则守卫改用 `indexOf` 等无反斜杠写法，或对反斜杠双重转义。

### 一.5.1 动画形式全景（常见类型之外的盲区，逐类核对）

上面的原语表覆盖 React/framer 生态最常见的形态。换一个技术栈的站点，还有以下四大类，**每次复刻都过一遍这张清单**：

**① JS 原语类（已并入上方扫描列表，症状与处置）**

| 原语 | 动效类型 | ⚠️ 陷阱 |
|---|---|---|
| `requestAnimationFrame` 业务循环 | 数字滚动计数器、打字机、canvas 图表/场景 | 计数器会定格在快照瞬间的中间值（如 "1,283"），静态看毫无异常 |
| `setTimeout` 递归 | 打字机、逐字/逐行错峰入场 | 同上，文字定格在半句 |
| `transitionend` 接力 | transition 链循环（与 animationend 重启同族） | 跑一段后停住 |
| `addEventListener('scroll')` 原生监听 | 非 framer 站的视差/吸顶/进度条 | 无库特征，只能靠原语 grep |
| `mousemove`/`pointermove` | 鼠标跟随光斑（spotlight）、3D 倾斜卡（tilt）、自定义光标 | 静态快照完全不可见，纯交互态 |
| `element.animate([...])`（WAAPI） | 无库的 JS 动画 | 剥离 JS 后无任何 CSS 痕迹 |
| `CSS.registerProperty`（Houdini） | 渐变角度/自定义属性的 transition | **CSS 里写着 transition 却不动**：属性注册在 JS 里，剥离后 CSS 过渡静默失效，极难察觉。判定口径：CSS 里发现自定义属性参与 transition/animation 时，先 grep CSS `@property`——命中即存活（纯 CSS）；未命中则 grep bundle `registerProperty`——命中即需在 clone 里补一段注册代码 |
| `startViewTransition` | SPA 页面切换过渡 | 单页克隆可放弃，记录即可 |

**② CSS 原生类（剥离 JS 后仍存活，但有各自注意点）**

| 形式 | 识别 | 注意点 |
|---|---|---|
| CSS 滚动驱动动画 `animation-timeline: scroll()/view()` | grep CSS：`animation-timeline\|view-timeline` | 纯 CSS 免复刻；但 capture 冻结样式会定格它，截图基线注意 |
| `@property` 声明在 CSS 里 | grep CSS：`@property` | 与 JS 注册版区分：CSS 版存活，JS 版死亡（见①） |
| `<details>/<summary>`、`:checked` 手风琴 | DOM 里有对应标签/input | 原生交互，免复刻；序列化的 open 状态要还原初始态 |
| SVG SMIL（`<animate>`/`<animateTransform>`/`<animateMotion>`） | grep DOM：`<animate` | 声明式，序列化后原生运行；`begin="click"` 等交互触发需测 |

**③ 动画资产类（动的不是 DOM，是资产本身）**

| 形式 | 识别 | 处置 |
|---|---|---|
| `<video autoplay loop muted>` 背景 | DOM `<video>` + network.json media 类型 | 视频文件必须本地化（大文件注意）+ poster 图 |
| GIF / APNG / 动图 WebP·AVIF | `file` 探测资产真实类型（"animated"字样） | 静态截图只有一帧，像素 diff 全绿但内容在动——资产照搬即可，登记确认 |
| Lottie（`lottie-web`/`<lottie-player>`/`.json`/`.lottie`）、Rive（`.riv`）、Spline（`spline-viewer`） | bundle/DOM/network 三处 grep | 运行时 + 动画数据文件都要本地化；web component 注意 ④ 的 shadow DOM 坑 |

**④ 结构陷阱类（不是动画形式，但会吞掉动画）**

| 陷阱 | 后果 | 检测与处置 |
|---|---|---|
| **Shadow DOM**（`<swiper-container>`、`<lottie-player>` 等 web component） | `page.content()` **不含 shadowRoot 内容**——组件内部 DOM/样式/动画在快照里整体消失 | capture 前 evaluate：`[...document.querySelectorAll('*')].filter(e=>e.shadowRoot).map(e=>e.tagName)`；命中则必须让组件库 JS 在 clone 里重建，或手工展开为 light DOM |
| iframe 嵌入（视频播放器/地图/codepen） | 独立文档，capture 不进入 | 单独抓取或保留外链并登记 |
| 平滑滚动劫持（lenis / locomotive-scroll / smooth-scrollbar） | 所有滚动动效的时序被库接管；clone 剥离后滚动手感/触发点不一致 | grep bundle：`lenis\|locomotive`；决定复刻滚动容器或接受原生滚动并重校触发点 |
| `prefers-reduced-motion` 分支 | 原站对减动效用户走另一套样式 | 验证时两种模式各跑一遍 |

---

## 二、Step 1：提取 CSS 动效

### 2.1 扫描 @keyframes

在 `deobf/assets/css/`（Tier 0 格式化后的 CSS，产物路径见 `04-deobfuscation.md` 第七节）中搜索所有 `@keyframes` 声明：

```bash
grep -rn "@keyframes" deobf/assets/css/
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
grep -rnE "transition[-a-z]*\s*:" deobf/assets/css/
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

---

## 八、动效落地后的复检（归档前必做）

Step 5 会实实在在地改动 clone：恢复 scroll-reveal 的初始隐藏态、重初始化轮播、引入 GSAP/Lottie/AOS 等新资产。**Step 4 时生成的验收报告不再代表最终产物**，归档前必须复检：

1. **重跑关卡 0（资源完整性体检）**：动效阶段新增的库文件（`gsap.min.js`、`lottie.min.js`、Lottie JSON、AOS CSS 等）必须与其他资源一样本地化——若以 CDN 引用留在 clone 里，关卡 0 会命中，按 `05-visual-verification.md` 处理。
2. **重跑静止态像素对比**：用 `capture.mjs`（默认冻结动画：有限动画快进到终态、无限动画取消）重新截图 clone，与 original 截图跑 `visual-diff.mjs`，各断点仍需 ≥ 0.98。冻结语义下「动画终态」即静止态，恢复了入场动画的元素不会被误截成 `opacity:0` 空白。
3. 通过后，report.html 以**复检结果**归档；未过则回到本文档对应小节修复。

> **截图与动效验证的分工**：`capture.mjs` 默认冻结 CSS/WAAPI 动画，服务于像素对比的可复现性；验证动效本身（帧序列、时序）时用浏览器 MCP 截帧（见第四节），或给 capture 加 `--keep-motion` 保留运行态。JS 定时器驱动的 UI（轮播自动播、rAF 位移）无法冻结，属像素对比的固有噪声——差异集中在这类区块时，按本文档「冻结与隐藏」处理或用 `shot-el.mjs` 对区块单独核对。
