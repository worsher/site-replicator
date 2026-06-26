# 整站发现与批量调度

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。整站模式在单页管线（见 `01-page-pipeline.md`）的基础上增加「页面发现 → 去重分组 → 用户确认 → 批量调度」四个前置步骤。

---

## 一、整站模式总流程

```
  目标站根 URL
       │
       ▼
┌──────────────────────┐
│  Step 0              │
│  三路并行页面发现     │
│  ① sitemap.xml       │
│  ② 首页内链爬取       │
│  ③ 用户手动 URL 列表  │
└──────────┬───────────┘
           │ 合并去重
           ▼
┌──────────────────────┐
│  URL 模板归类         │
│  /product/123  ┐      │
│  /product/456  ┤ → /product/:id │
│  /product/789  ┘      │
│  列表/详情取 1~2 代表  │
└──────────┬───────────┘
           │ 展示页面清单
           ▼
   ┌─────────────────┐
   │  用户勾选确认    │
   └────────┬────────┘
            │ 逐页跑单页管线
            ▼
┌───────────────────────┐
│  批量调度              │
│  对每页执行 01-page-pipeline │
│  跨页共享 asset-map    │
└───────────┬───────────┘
            │
            ▼
     整站汇总报告
```

---

## 二、三路并行页面发现

### ① 解析 sitemap.xml / robots.txt

**第一步：获取 robots.txt，找 Sitemap 声明**

```
GET https://<host>/robots.txt
```

robots.txt 中通常有一行或多行：

```
Sitemap: https://example.com/sitemap.xml
Sitemap: https://example.com/sitemap-index.xml
```

用浏览器 MCP 或 `fetch` 获取该文件，提取所有 `Sitemap:` 行的 URL。若 robots.txt 无 Sitemap 声明，则尝试以下常见路径：

```
https://<host>/sitemap.xml
https://<host>/sitemap-index.xml
https://<host>/sitemap_index.xml
https://<host>/sitemap.xml.gz
```

**第二步：解析 sitemap**

sitemap 格式为 XML，有两种类型：

- **sitemap-index**（索引文件）：包含多个子 sitemap 的 URL，需递归获取每个子 sitemap。
  ```xml
  <sitemapindex>
    <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
    <sitemap><loc>https://example.com/sitemap-products.xml</loc></sitemap>
  </sitemapindex>
  ```

- **urlset**（URL 集合）：直接列出页面 URL。
  ```xml
  <urlset>
    <url><loc>https://example.com/</loc><priority>1.0</priority></url>
    <url><loc>https://example.com/about</loc></url>
    <url><loc>https://example.com/products/foo</loc></url>
  </urlset>
  ```

用 `page.evaluate()` 或 Node.js XML 解析提取所有 `<loc>` 内容，过滤掉非同域 URL，得到候选 URL 列表。

**使用浏览器 MCP 获取 sitemap 的参考步骤：**

```javascript
// Playwright MCP：navigate 到 sitemap URL，evaluate 提取 loc 列表
const locs = await page.evaluate(() =>
  [...document.querySelectorAll('loc')].map(el => el.textContent.trim())
);
```

---

### ② 首页内链爬取（浏览器 MCP 优先）

**目的**：捕获 sitemap 之外、通过导航菜单和页脚链接可达的页面。

**操作步骤：**

1. 用浏览器 MCP 导航到目标站首页（`https://<host>/`）。
2. 在 `<nav>`、`<header>`、`<footer>` 等结构性容器内查找所有 `<a href="...">` 链接。
3. 限定：只保留同域 URL（`href` 的 hostname 与目标站一致），排除 `#`、`mailto:`、`tel:` 等非页面链接。
4. 对第一层收集到的 URL，若爬取深度未达限制（**默认深度 2 层**），继续对每个 URL 重复步骤 2~3。

**无浏览器 MCP 时的兜底**：用 `scripts/extract-links.mjs --url <页面> --sel <nav/footer 选择器>` 批量提取容器内链接（输出每条的 text/href/img），再按上面的同域 / 深度规则筛选。同理 `extract-imgs.mjs`、`dump-text.mjs`、`inspect-blocks.mjs` 可在无 MCP 时分别盘点区块的图片、文案、结构（详见 SKILL.md 脚本速查表的「辅助脚本」）。

**爬取深度说明：**

| 层级 | 来源 |
|---|---|
| 第 0 层 | 首页（`/`） |
| 第 1 层 | 首页内链（nav/footer/内联锚点） |
| 第 2 层 | 第 1 层各页面的内链（**默认最深**） |

超出深度 2 的 URL 不自动爬取，但用户可通过手动列表（见 ③）补充。

**礼貌策略**：每次页面请求之间加入 500ms~1s 随机延迟，避免短时间内发出大量请求对目标站造成压力。

---

### ③ 用户手动提供 URL 列表

用户可在调用时提供一份文本文件或直接列举 URL，格式如下：

```
https://example.com/special-event
https://example.com/landing/summer-2024
https://example.com/docs/getting-started
```

手动列表中的 URL 无需通过同域/深度检查，直接合并进候选集，**但需确认仍在目标站域名下**（防止误操作复刻第三方站点）。

---

## 三、合并去重与 URL 模板归类

### 合并去重

将三路来源的 URL 合并为一个集合，去掉重复项（以完整规范化 URL 为主键，忽略末尾 `/` 差异和 `#fragment`）：

```javascript
function normalise(u) {
  const url = new URL(u);
  url.hash = '';                     // 去除 fragment
  url.pathname = url.pathname.replace(/\/$/, '') || '/'; // 统一末尾斜杠
  return url.toString();
}
const urlSet = new Set(allUrls.map(normalise));
```

### URL 模板归类

许多站点包含大量「列表/详情」类型的动态页面，如：

```
/product/123
/product/456
/product/789
/blog/how-to-setup
/blog/best-practices
```

对 URL 列表做模板归类，将数字、UUID、slug 识别为参数占位符，归为同一模板：

**归类规则（按优先级）：**

1. 纯数字段（`/123`）→ 替换为 `:id`
2. UUID 格式（`/a1b2c3d4-...`）→ 替换为 `:uuid`
3. 其余由字母数字加连字符组成的段（`/how-to-setup`）与该层其他路径存在多个时 → 替换为 `:slug`

归类示例：

| 原始 URL | 归类模板 |
|---|---|
| `/product/123` | `/product/:id` |
| `/product/456` | `/product/:id` |
| `/blog/getting-started` | `/blog/:slug` |
| `/blog/best-practices` | `/blog/:slug` |
| `/about` | `/about`（唯一路径，不归类） |

对于归入同一模板的 URL，**只取 1~2 个代表页**（优先取 sitemap 中 `<priority>` 最高的，或取第一个和最后一个）。

---

## 四、页面清单展示与用户勾选

完成归类后，向用户呈现一份「页面清单 + 模板分组」，供用户勾选要复刻的页面。格式示例：

```
========================================
 整站页面清单 — example.com（共 28 个模板）
========================================

[必选]
  ✓  /                          首页
  ✓  /about                     关于我们

[自动发现 — 按模板分组]
  ☐  /product/:id               商品详情（代表：/product/123, /product/456）
  ☐  /blog/:slug                博客文章（代表：/blog/getting-started, /blog/tips）
  ☐  /category/electronics      分类列表（Electronics）
  ☐  /category/clothing         分类列表（Clothing）
  ☐  /cart                      购物车
  ☐  /checkout                  结算
  ☐  /contact                   联系页面

[用户手动添加]
  ☐  /special-event             手动指定

输入要复刻的页面编号（多选用逗号分隔，全选输入 all）：
```

用户确认后，所有勾选的 URL（模板组用代表页 URL）进入批量调度队列。

---

## 五、批量调度

### 执行顺序

对每个选中的页面 URL，依次执行 `01-page-pipeline.md` 中的完整单页管线（Step 1~5）：

1. `capture.mjs` 抓取原始站快照（dom.html、network.json、三断点截图）
2. `download-assets.mjs` 下载静态资源、生成 L1 clone
3. 反混淆（见 `04-deobfuscation.md`）
4. 三重对比验证（dom-diff + visual-diff，见 `05-visual-verification.md`）
5. 动效复刻（见 `06-animation.md`）

工作目录结构：

```
.site-replicator/<host>/
├── asset-map.json          ← 全局共享（跨页去重，详见下方）
├── assets/                 ← 全局共享静态资源
├── home/                   ← 首页（slug: home）
│   ├── original/
│   ├── clone/
│   └── dom-report.json
├── about/
│   ├── original/
│   ├── clone/
│   └── dom-report.json
├── product-123/            ← /product/:id 代表页
│   ├── original/
│   └── clone/
└── site-report.html        ← 整站汇总报告
```

### 跨页共享 asset-map（资源去重）

整站各页面往往共用同一套 CSS/字体/核心 JS。为避免重复下载，维护一份**站点级全局 `asset-map.json`**（路径：`.site-replicator/<host>/asset-map.json`）。

操作流程：

1. 第一个页面正常调用 `download-assets.mjs`，产出的 `asset-map.json` 升级为全局文件，`assets/` 目录也提升至站点级。
2. 后续每个页面在调用 `download-assets.mjs` 之前，先加载全局 `asset-map.json` 与本页 `network.json` 做对比——已在全局 map 中的 URL 跳过下载，只追加新资源。
3. 每个页面的 `clone/index.html` 中的引用路径统一指向站点级 `assets/` 目录（调整相对路径或统一用根路径 `/assets/`）。

详细去重策略见 `03-asset-extraction.md` 第六节。

---

## 六、整站汇总报告（site-report.html）

批量调度全部完成后，生成一份站点级汇总报告，内容包含：

### 页面总览表

| 页面 URL | pixel score (1440) | pixel score (768) | pixel score (375) | structureScore | styleScore | 状态 |
|---|---|---|---|---|---|---|
| `/` | 0.991 | 0.987 | 0.983 | 0.921 | 0.872 | 通过 |
| `/about` | 0.975 | 0.971 | 0.968 | 0.903 | 0.856 | 通过 |
| `/product/123` | 0.942 | 0.937 | 0.921 | 0.881 | **0.843** | **未达标** |
| `/blog/getting-started` | 0.988 | 0.981 | 0.976 | 0.912 | 0.867 | 通过 |

各分项阈值与判定方法见 `05-visual-verification.md` 第四节。

### 未达标页清单

汇总所有未通过阈值的页面，注明具体不达标的指标和差值：

```
未达标页面（需回修）：
  /product/123
    styleScore: 0.843（门控 ≥0.85，差 0.007）
    → 建议：检查 dom-report.json mismatches 中 prop=color 的条目，优先修复商品详情区域
```

### 报告归档位置

报告文件落在 `.site-replicator/<host>/site-report.html`，包含所有页面的热力图链接（相对路径指向各页面目录下的 `diff-*.png`）和 DOM 报告链接。

---

## 七、礼貌与边界约束

整站爬取必须遵守以下约束，**不得绕过**：

### 1. 仅同域

所有抓取、爬取、资源下载操作**只针对目标站的根域名**（含子域名需用户明确授权）。跳出域名的外链不跟踪，不下载外域资源（CDN 资源除外，CDN 资源由 `download-assets.mjs` 统一处理）。

### 2. 爬取深度限制

内链爬取默认不超过 **2 层**。如需更深，用户须显式指定 `--depth 3`（最大建议不超过 3 层），并理解爬取时间会显著增加。

### 3. 限速

相邻页面请求之间加入 500ms~1s 随机延迟。不对同一域名发起并发浏览器实例（每次只打开一个 Playwright 页面）。

### 4. 尊重 robots.txt

在 ① 中获取 robots.txt 后，解析 `Disallow:` 规则，**过滤掉被禁止爬取的 URL 路径**。若整站根路径被 `Disallow: /`，则整站发现不可自动进行，须提示用户手动确认。

```javascript
// 简单规则检查示例
function isDisallowed(pathname, rules) {
  return rules.some(rule => pathname.startsWith(rule));
}
```

### 5. 不绕过登录/付费墙

若目标页面需要登录后才能访问（302 跳转到 `/login`、返回 401/403），**不自动尝试登录**。用户可提供有效的 Cookie 字符串或 localStorage token，由浏览器 MCP 的 `context.addCookies()` 注入后再访问，整个凭据来源须由用户明确提供，不猜测、不暴力破解。

### 6. 不触发有破坏性的操作

爬取时只执行 `GET` 类请求（页面导航、资源下载）。不触发表单提交、支付、账户操作等有副作用的交互。
