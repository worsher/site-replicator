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

`download-assets.mjs` 在处理 `network.json` 时，**下载以下 5 种 resourceType**：

| resourceType | 说明 |
|---|---|
| `stylesheet` | CSS 样式表 |
| `image` | 图片（jpg/png/svg/webp/avif 等） |
| `font` | Web 字体（woff/woff2/ttf/otf 等） |
| `script` | JavaScript 文件 |
| `media` | 视频、音频等媒体文件 |

**扩展名兜底**：resourceType 跨 Playwright 版本/手工整理的 network.json 中不可靠，即使类型不在上表，只要 URL pathname 以静态资源扩展名结尾（css/js/图片/字体/媒体），同样会下载。

以下情况**不下载**：`document`（HTML 文档）与无静态扩展名的 `xhr`/`fetch`/`websocket`/`other` 请求；HTTP 状态码 ≥ 400 的请求同样跳过。

---

## 资源完整性：四项内置保障（务必理解）

只靠 `network.json` 会漏资源——**懒加载图的真图（`data-original`/`data-lazy-src`）和首屏外区块的 CSS 背景图，在抓取时若未滚动到，浏览器从不发起请求**，于是不进 `network.json`，后续无从下载。脚本已内置四道保障，无需手动补救：

| 保障 | 在哪一步 | 解决什么 |
|---|---|---|
| **抓取时自动滚动到底再回顶** | `capture.mjs` | 触发懒加载图与视口外区块背景图的真实请求，使其进入 `network.json`；并把占位 `src` 按 `data-original`/`data-src`/`data-lazy-src`/`data-lazysrc`（及 `data-srcset` 变体）替换为真图 |
| **从 DOM/CSS 解析补抓** | `download-assets.mjs` | 即便仍漏，脚本会扫描 `dom.html` 的 `data-*`/`src`/`srcset` 与已下载 CSS 的 `url()`，把 `network.json` 里没有的引用补抓下来 |
| **请求带 `Referer` + `User-Agent`** | `download-assets.mjs` | 破 CDN 防盗链（裸 `fetch` 常被 403）。`Referer` 优先取 `--referer`，否则从 `network.json` 的 document 请求自动推导 |
| **HTML un-lazy 还原（默认开）** | `download-assets.mjs` | 静态 clone 没有懒加载库/服务端 optimizer 运行时：占位 `src` 恢复为真实 `src`/`srcset`、`<script>`/`<link>` 的 `data-src` 恢复、`type="litespeed/javascript"` 改回 `text/javascript`、剥离 `data-no-optimize` 存根脚本。不还原会表现为图片空白、脚本不执行（WordPress + LiteSpeed/lazysizes 站点的高频坑）。用 `--keep-lazy` 可关闭 |

> **不要**再依赖"先跑一遍、看 diff 发现塌陷、人工往 network.json 补 URL"的旧流程——那是这套保障出现前的兜底。现在一次 capture+download 即应抓全；仍漏的只剩真正运行时拼接的 URL（见下文"已知局限"）。

---

## 二、download-assets.mjs 用法

### 命令格式

```bash
node scripts/download-assets.mjs \
  --network <network.json 路径> \
  --html    <dom.html 路径> \
  --out     <输出目录> \
  --referer <页面 URL>          # 可选：破防盗链；不传则从 network.json 自动推导
  --map     <asset-map.json>    # 可选：站点级共享 map（整站模式跨页去重）
  --html-out <文件路径>          # 可选：重写后 HTML 的输出位置（默认 <out>/index.html）
  --concurrency 8               # 可选：并发下载数（默认 8）
  --keep-lazy                   # 可选：保留懒加载占位标记，跳过 un-lazy 还原
```

| 参数 | 说明 |
|---|---|
| `--html`（可选） | 提供则下载后将 HTML 中的 URL 重写为本地路径并写出（默认 `<out>/index.html`）；不提供则只下载资源、生成 asset-map，不产出 HTML |
| `--referer`（可选） | 目标站 CDN 有防盗链时指定页面 URL 作为请求 `Referer`；通常无需手动传，脚本从 `network.json` 的 document 请求推导 |
| `--map`（可选） | 指向站点级共享 `asset-map.json`：已在 map 且文件已落盘的 URL 跳过下载，新资源追加后写回该文件。多页共用一份 assets/ 的关键（`run-pages.mjs` 即用此参数） |
| `--html-out`（可选） | 多页共享同一 `--out` 时避免 `index.html` 互相覆盖；HTML 内相对路径按该文件所在目录计算 |
| `--concurrency`（可选） | 并发下载数，默认 8。资源多的站点（200+ 文件）显著快于顺序下载 |
| `--keep-lazy`（可选） | 关闭默认的 un-lazy/LiteSpeed 还原（调试对照时用） |

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
{ "ok": true, "downloaded": 42, "mapped": 45, "extra": 3 }
```

`downloaded` 为本次成功写入磁盘的资源数量；`mapped` 为 asset-map 中的总条目数（含 `--map` 预载的历史条目）；`extra` 为从 DOM/CSS 解析补抓到的数量（不在 network.json 中的懒加载图/背景图）。

---

## 三、引用重写机制

资源下载完成后，脚本对 `dom.html` 和所有已下载的 `.css` 文件做文本级别的 URL 重写，将原始 URL 替换为本地相对路径。重写规则如下：

### 1. 按 URL 长度降序排列，避免前缀碰撞

同一页面可能有 `https://cdn.example.com/js/app.js` 和 `https://cdn.example.com/js/app.js.map` 两条记录，前者是后者的前缀子串。按降序处理可保证先替换更长的 URL，不会把短 URL 的替换结果再次误替换。

### 2. 匹配形式（每条映射同时替换）

```
原始完整 URL（绝对 URL）        →  本地相对路径
//host/path（协议相对 URL）     →  本地相对路径（完整 URL 先替换，剩余的即真·协议相对引用）
"<pathname>"（带双引号的路径）  →  "<本地相对路径>"
'<pathname>'（带单引号的路径）  →  '本地相对路径'
url(<pathname>)（CSS url() 裸路径）→  url(本地相对路径)
srcset="<URL 描述符>, ..."      →  逐条目重写（一个属性值里多条 URL+描述符，整体不命中引号形式，需按条目处理；含 data-srcset/data-lazy-srcset）
```

### 3. 带 query 参数的资源用 query 哈希命名

对于 `https://cdn.example.com/css/main.css?v=20240101` 这类 URL，本地文件名为：

```
assets/css/main-<sha1(query 字符串)前8位>.css
```

这样同一路径、不同版本的资源可以并存，不会互相覆盖。

### 3.5 跨 host 同路径自动隔离

两个不同 CDN 域名使用相同文件路径时（如 `cdn-a.com/js/vendor.js` 与 `cdn-b.com/js/vendor.js`），先到者占用 `assets/js/vendor.js`，后到者自动落到 `assets/<host>/js/vendor.js`（host 中的 `:` 替换为 `_`），两条 URL 在 asset-map 中映射到不同本地文件，互不覆盖。

### 4. CSS 文件内的 url() 重写（相对该 CSS 文件目录）

所有下载完成的 `.css` 文件，脚本对其中的字体、背景图 `url()` 重写为本地路径。两个关键点：

- **相对路径按“该 CSS 文件所在目录”计算**，而非 out 根。深层目录的 CSS（如 `assets/.../css/home/en-us/style.css`）若用 out 根相对的 `assets/...`，浏览器会相对 CSS 自身再次解析而 404。脚本用 `path.relative(cssDir, 资源本地路径)` 得出正确的 `../../../images/...`。
- **根绝对路径（`/public/...`）按该 CSS 自身的 host 解析**，不是页面 host——CSS 常托管在 CDN 子域，其根绝对引用指向 CDN 根而非主站根。
- **容忍畸形引号**：原站手写 CSS 常见 `url(/path.png')`（缺前引号或多尾引号）这类笔误，脚本有一道 `url()` 兜底正则按 pathname 匹配，规范写法与畸形写法都能本地化。

---

## 四、已知局限

使用 `download-assets.mjs` 时需注意以下真实存在的限制：

### ① 单个资源 30 秒超时

每个资源使用 `AbortSignal.timeout(30000)` 限制为 30 秒。CDN 慢速响应或超大文件（如未压缩的 3D 模型）可能超时跳过，并在 stderr 打印 `skip (fetch error): <url>`。超时跳过的资源不会写入 `asset-map.json`，HTML 中对应 URL 也不会被重写（仍为原始 CDN 地址）——这类残留会被 Step 4 的资源完整性体检（关卡 0）抓出。

### ② 仍可能漏抓的动态资源

滚动触发 + DOM/CSS 解析补抓已覆盖**懒加载图**和**视口外背景图**。仍会漏的只剩纯运行时生成、静态文本里无迹可寻的资源：

- **运行时拼接 URL**：JS 按配置/环境变量拼出的 URL（`baseURL + '/chunk.' + hash + '.js'`），DOM/CSS 里没有字面量可解析。
- **CSS-in-JS 运行时样式**：Styled-components、Emotion 等注入 `<head>` 的 `<style>`，其引用的背景图/字体只在运行时存在。
- **字体子集化**：Google Fonts 等按 `unicode-range` 动态生成子集，实际文件 URL 与 `@import` 的元 URL 不同。
- **交互触发的 `import()` chunk**：仅在点击/路由切换后才请求的代码分割块（滚动触发不了的那部分）。

**兜底**：以这些为限，用 Step 4 的**资源完整性体检**（`05-visual-verification.md` 关卡 0）主动发现——grep 产物中残留的外链/协议相对/根绝对引用，命中即逐条用 `--referer` 或手动补抓。不要再把这套兜底当成"每次都要人工补一遍"的常规步骤。

> 历史局限说明：早期版本的「顺序下载慢」已由 `--concurrency`（默认 8 并发）解决；「跨 host 同路径互相覆盖」已由自动 host 目录隔离解决（见第三节 3.5）。

---

## 五、大资源处理建议

**3D 模型（`.glb`）、视频文件**等单文件可能达到几十 MB，有以下建议：

- **分批下载**：将大资源 URL 单独提取到一个列表，使用支持断点续传的工具（如 `wget -c` 或 `curl -C -`）分批下载，再手动补充到 `assets/` 目录并更新 `asset-map.json`。
- **跳过并 CDN 保留**：如果大资源在目标站有稳定 CDN 地址且允许跨域访问，可在 `index.html` 中保留原始 CDN URL 不替换，仅下载关键的 CSS/字体/图片。
- **延迟加载视频**：视频文件建议单独用流式下载（`fetch` + stream pipeline）代替一次性 `arrayBuffer()`，避免内存溢出。

---

## 六、整站模式：跨页共享资产去重（已内置）

在复刻整站（多个页面）时，多个页面往往共用同一套 CSS/字体/核心 JS。去重已内置为 `--map` 参数，无需手写合并逻辑：

1. **`--map` 指向站点级 `asset-map.json`**：每页调用时传同一个 map 文件——已在 map 且文件已落盘的 URL 跳过下载，新资源追加后写回。
2. **`--out` 统一传站点级构建目录**（如 `pages-build/`），配合 `--html-out` 为每页指定不同的 HTML 文件名，assets/ 只存一份。
3. **推荐直接用 `scripts/run-pages.mjs`**：它按上述方式编排每页的 `download-assets.mjs` 调用，并额外做页间互链重写与危险链接失活，详见 `02-site-discovery.md` 第五节。

```bash
# 单页手工调用（整站中某一页）的等效形式
node scripts/download-assets.mjs \
  --network .site-replicator/example.com/about/original/network.json \
  --html    .site-replicator/example.com/about/original/dom.html \
  --out     .site-replicator/example.com/pages-build \
  --map     .site-replicator/example.com/pages-build/asset-map.json \
  --html-out .site-replicator/example.com/pages-build/about.html \
  --referer https://example.com/about/
```
