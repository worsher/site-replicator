# 资源提取与本地化

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。

---

## 一、资源来源：network.json 筛选规则

`scripts/capture.mjs` 执行时，Playwright 监听页面所有 `response` 事件，将每条请求记录为：

```json
{
  "url": "https://cdn.example.com/fonts/inter.woff2",
  "method": "GET",
  "resourceType": "font",
  "status": 200,
  "contentType": "font/woff2"
}
```

`download-assets.mjs` 在处理 `network.json` 时，**只下载以下 5 种 resourceType**：

| resourceType | 说明 |
|---|---|
| `stylesheet` | CSS 样式表 |
| `image` | 图片（jpg/png/svg/webp/avif 等） |
| `font` | Web 字体（woff/woff2/ttf/otf 等） |
| `script` | JavaScript 文件 |
| `media` | 视频、音频等媒体文件 |

以下类型**不下载**：`document`（HTML 文档）、`xhr`、`fetch`（接口请求）、`websocket`、`other` 等。HTTP 状态码 ≥ 400 的请求同样跳过。

---

## 资源完整性：三项内置保障（务必理解）

只靠 `network.json` 会漏资源——**懒加载图的真图（`data-original`）和首屏外区块的 CSS 背景图，在抓取时若未滚动到，浏览器从不发起请求**，于是不进 `network.json`，后续无从下载。脚本已内置三道保障，无需手动补救：

| 保障 | 在哪一步 | 解决什么 |
|---|---|---|
| **抓取时自动滚动到底再回顶** | `capture.mjs` | 触发懒加载图与视口外区块背景图的真实请求，使其进入 `network.json`；并把占位 `data-original` 替换为真图 |
| **从 DOM/CSS 解析补抓** | `download-assets.mjs` | 即便仍漏，脚本会扫描 `dom.html` 的 `data-original`/`src`/`srcset` 与已下载 CSS 的 `url()`，把 `network.json` 里没有的引用补download下来 |
| **请求带 `Referer` + `User-Agent`** | `download-assets.mjs` | 破 CDN 防盗链（裸 `fetch` 常被 403）。`Referer` 优先取 `--referer`，否则从 `network.json` 的 document 请求自动推导 |

> **不要**再依赖"先跑一遍、看 diff 发现塌陷、人工往 network.json 补 URL"的旧流程——那是这套保障出现前的兜底。现在一次 capture+download 即应抓全；仍漏的只剩真正运行时拼接的 URL（见下文"已知局限"）。

---

## 二、download-assets.mjs 用法

### 命令格式

```bash
node scripts/download-assets.mjs \
  --network <network.json 路径> \
  --html    <dom.html 路径> \
  --out     <输出目录> \
  --referer <页面 URL>      # 可选：破防盗链；不传则从 network.json 自动推导
```

`--html` 参数可选——若提供，脚本在下载完资源后会将 HTML 文件中的 URL 重写为本地路径，并将结果写入 `<out>/index.html`；若不提供，只下载资源、生成 `asset-map.json`，不产出 `index.html`。

`--referer` 参数可选——目标站 CDN 有防盗链时，用它指定页面 URL 作为请求 `Referer`；通常无需手动传，脚本会从 `network.json` 的 document 请求推导。

### 示例

```bash
node scripts/download-assets.mjs \
  --network .site-replicator/example.com/home/original/network.json \
  --html    .site-replicator/example.com/home/original/dom.html \
  --out     .site-replicator/example.com/home/clone
```

### 产出文件

执行完成后，`--out` 目录下产生：

```
<out>/
├── assets/                  ← 下载的所有静态资源，保留原始路径结构
│   ├── fonts/inter.woff2
│   ├── css/main.css         ← CSS 文件内的 url() 引用也一并重写
│   ├── images/hero.jpg
│   └── js/app.js
├── asset-map.json           ← URL → 本地相对路径的完整映射
└── index.html               ← L1 克隆：dom.html 的所有 URL 替换为本地路径
```

`asset-map.json` 内容示例：

```json
{
  "https://cdn.example.com/fonts/inter.woff2": "assets/fonts/inter.woff2",
  "https://cdn.example.com/css/main-abc123.css?v=2": "assets/css/main-abc123-a1b2c3d4.css",
  "https://example.com/images/hero.jpg": "assets/images/hero.jpg"
}
```

脚本最后向 stdout 打印一行 JSON：

```json
{ "ok": true, "downloaded": 42 }
```

`downloaded` 为成功写入磁盘的资源数量。

---

## 三、引用重写机制

资源下载完成后，脚本对 `dom.html` 和所有已下载的 `.css` 文件做文本级别的 URL 重写，将原始 URL 替换为本地相对路径。重写规则如下：

### 1. 按 URL 长度降序排列，避免前缀碰撞

同一页面可能有 `https://cdn.example.com/js/app.js` 和 `https://cdn.example.com/js/app.js.map` 两条记录，前者是后者的前缀子串。按降序处理可保证先替换更长的 URL，不会把短 URL 的替换结果再次误替换。

### 2. 三种匹配形式

对每条 `URL → localPath` 映射，同时替换三种形式：

```
原始完整 URL（绝对 URL）    →  本地相对路径
"<pathname>"（带双引号的路径）→  "<本地相对路径>"
'<pathname>'（带单引号的路径）→  '本地相对路径'
url(<pathname>)（CSS url() 裸路径）→  url(本地相对路径)
```

### 3. 带 query 参数的资源用 query 哈希命名

对于 `https://cdn.example.com/css/main.css?v=20240101` 这类 URL，本地文件名为：

```
assets/css/main-<sha1(query 字符串)前8位>.css
```

这样同一路径、不同版本的资源可以并存，不会互相覆盖。

### 4. CSS 文件内的 url() 重写（相对该 CSS 文件目录）

所有下载完成的 `.css` 文件，脚本对其中的字体、背景图 `url()` 重写为本地路径。两个关键点：

- **相对路径按“该 CSS 文件所在目录”计算**，而非 out 根。深层目录的 CSS（如 `assets/.../css/home/en-us/style.css`）若用 out 根相对的 `assets/...`，浏览器会相对 CSS 自身再次解析而 404。脚本用 `path.relative(cssDir, 资源本地路径)` 得出正确的 `../../../images/...`。
- **根绝对路径（`/public/...`）按该 CSS 自身的 host 解析**，不是页面 host——CSS 常托管在 CDN 子域，其根绝对引用指向 CDN 根而非主站根。
- **容忍畸形引号**：原站手写 CSS 常见 `url(/path.png')`（缺前引号或多尾引号）这类笔误，脚本有一道 `url()` 兜底正则按 pathname 匹配，规范写法与畸形写法都能本地化。

---

## 四、已知局限

使用 `download-assets.mjs` 时需注意以下真实存在的限制：

### ① 顺序下载，速度受限

脚本对所有资源**逐个顺序下载**（`for...of` 循环，非并发），站点资源数量多时（如 200+ 个文件），下载时间会线性增长，整体较慢。目前没有并发控制或进度条，需耐心等待。

### ② 单个资源 30 秒超时

每个资源使用 `AbortSignal.timeout(30000)` 限制为 30 秒。CDN 慢速响应或超大文件（如未压缩的 3D 模型）可能超时跳过，并在 stderr 打印 `skip (fetch error): <url>`。超时跳过的资源不会写入 `asset-map.json`，`index.html` 中对应 URL 也不会被重写（仍为原始 CDN 地址）。

### ③ 仍可能漏抓的动态资源

滚动触发 + DOM/CSS 解析补抓已覆盖**懒加载图**和**视口外背景图**。仍会漏的只剩纯运行时生成、静态文本里无迹可寻的资源：

- **运行时拼接 URL**：JS 按配置/环境变量拼出的 URL（`baseURL + '/chunk.' + hash + '.js'`），DOM/CSS 里没有字面量可解析。
- **CSS-in-JS 运行时样式**：Styled-components、Emotion 等注入 `<head>` 的 `<style>`，其引用的背景图/字体只在运行时存在。
- **字体子集化**：Google Fonts 等按 `unicode-range` 动态生成子集，实际文件 URL 与 `@import` 的元 URL 不同。
- **交互触发的 `import()` chunk**：仅在点击/路由切换后才请求的代码分割块（滚动触发不了的那部分）。

**兜底**：以这些为限，用 Step 4 的**资源完整性体检**（`05-visual-verification.md`）主动发现——grep 产物中残留的外链/根绝对路径，命中即逐条用 `--referer` 或手动补抓。不要再把这套兜底当成"每次都要人工补一遍"的常规步骤。

### ④ 跨 host 同路径资源命名冲突

`localPathFor()` 函数只使用 URL 的 `pathname`（去掉 `host` 部分）生成本地路径。如果两个不同域名的 CDN 使用了相同的文件路径（如 `cdn-a.com/js/vendor.js` 和 `cdn-b.com/js/vendor.js`），本地路径会相同，后下载的会覆盖先下载的文件，且 `asset-map.json` 中两条 URL 会映射到同一本地路径，造成引用错误。目前没有自动去冲突机制，需人工处理。

---

## 五、大资源处理建议

**3D 模型（`.glb`）、视频文件**等单文件可能达到几十 MB，有以下建议：

- **分批下载**：将大资源 URL 单独提取到一个列表，使用支持断点续传的工具（如 `wget -c` 或 `curl -C -`）分批下载，再手动补充到 `assets/` 目录并更新 `asset-map.json`。
- **跳过并 CDN 保留**：如果大资源在目标站有稳定 CDN 地址且允许跨域访问，可在 `index.html` 中保留原始 CDN URL 不替换，仅下载关键的 CSS/字体/图片。
- **延迟加载视频**：视频文件建议单独用流式下载（`fetch` + stream pipeline）代替一次性 `arrayBuffer()`，避免内存溢出。

---

## 六、整站模式：跨页共享资产去重

在复刻整站（多个页面）时，多个页面往往共用同一套 CSS/字体/核心 JS。推荐以下去重策略：

1. **维护一份全局 `asset-map.json`**：放在站点级目录（如 `.site-replicator/example.com/asset-map.json`），各页面的 `download-assets.mjs` 运行前先加载此文件，已存在的 URL 直接跳过下载，只追加新的 URL。

2. **`assets/` 目录共享**：各页面克隆的 `index.html` 中的引用路径统一指向站点级 `assets/` 目录（调整 `--out` 参数为站点级目录），避免同一字体文件在每个页面目录下各存一份。

3. **相同 URL 不重复下载**：脚本内部使用 `seen` Set 去重（同一次运行内去重），跨页去重需在调用层面共享同一份 `network.json` 的合并结果，或在外部脚本中先合并多页 `network.json`，再统一调用一次 `download-assets.mjs`。
