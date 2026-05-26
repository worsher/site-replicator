# 视觉验证与三重对比

> **路径约定**：`scripts/<name>.mjs` 均相对于 skill 根目录（`~/.claude/skills/site-replicator/`）。

---

## 一、三断点 × 三项对比总览

完整验证需在 **1440 / 768 / 375** 三个断点下，分别执行以下三类对比：

| 对比类型 | 脚本 | 核心指标 | 建议门控阈值 |
|---|---|---|---|
| 像素对比（visual diff） | `scripts/visual-diff.mjs` | `score` | ≥ 0.98 |
| DOM 结构对比 | `scripts/dom-diff.mjs` | `structureScore` | ≥ 0.90 |
| 计算样式对比 | `scripts/dom-diff.mjs` | `styleScore` | ≥ 0.85 |

---

## 二、visual-diff.mjs — 像素级对比

### 命令格式

```bash
node scripts/visual-diff.mjs \
  --orig  <原始站截图.png> \
  --clone <克隆站截图.png> \
  --out   <差异热力图输出.png> \
  [--threshold 0.1]
```

`--threshold` 是 pixelmatch 的**单像素颜色容差**参数（YIQ 色彩空间，范围 0~1，默认 0.1），越大则越宽松——轻微颜色偏差的像素会被视为匹配。这**不是整体通过/失败的门控阈值**，不要与 `score` 门控混淆。

### 三断点完整命令

```bash
# 假设原始站截图在 original/screenshots/，克隆站截图在 clone-cap/screenshots/
for BP in 1440 768 375; do
  node scripts/visual-diff.mjs \
    --orig  .site-replicator/example.com/home/original/screenshots/${BP}.png \
    --clone .site-replicator/example.com/home/clone-cap/screenshots/${BP}.png \
    --out   .site-replicator/example.com/home/diff-${BP}.png \
    --threshold 0.1
done
```

### stdout 输出字段

脚本向 stdout 打印一行 JSON：

```json
{
  "score": 0.9923,
  "mismatched": 1543,
  "width": 1440,
  "height": 5200,
  "origHeight": 5200,
  "cloneHeight": 5280,
  "origWidth": 1440,
  "cloneWidth": 1440
}
```

| 字段 | 含义 |
|---|---|
| `score` | `1 - mismatched / (width × height)`，即像素匹配率。范围 0~1，越接近 1 越好 |
| `mismatched` | 差异像素数量（pixelmatch 判定为不匹配的像素个数） |
| `width` | 实际参与比对的图像宽度（= `min(origWidth, cloneWidth)`） |
| `height` | 实际参与比对的图像高度（= `min(origHeight, cloneHeight)`） |
| `origHeight` | 原始站截图的实际高度（像素） |
| `cloneHeight` | 克隆站截图的实际高度（像素） |
| `origWidth` | 原始站截图的实际宽度（像素） |
| `cloneWidth` | 克隆站截图的实际宽度（像素） |

### 重要：crop-to-min 行为

当两张截图尺寸不同时，脚本**裁剪到较小的公共尺寸（左上对齐）**后再比较。**被裁掉的区域不计入 `mismatched`**，因此如果 `origHeight ≠ cloneHeight`，被裁掉的高度差部分不会反映在 `score` 里，可能掩盖底部区域的布局差异。

**操作建议**：运行后务必检查 `origHeight` 与 `cloneHeight` 是否一致。若差值超过 100px，需人工打开 diff 热力图和两张截图底部区域目视确认，不能仅凭 `score` 通过就认为复刻完成。

---

## 三、dom-diff.mjs — DOM 结构与样式对比

### 命令格式

```bash
node scripts/dom-diff.mjs \
  --orig  <原始站 URL（必须是可访问的 http/https）> \
  --clone <克隆站 URL（必须是可访问的 http/https）> \
  --out   <报告输出.json>
```

注意：`--orig` 和 `--clone` 均为 **URL**，不是文件路径。克隆站需用 `npx serve` 或其他 HTTP 服务托管后再传入。

### 三断点说明

`dom-diff.mjs` 使用 Playwright 在固定视口下抓取 DOM，**脚本本身不接受断点参数**。如需多断点对比，需修改 Playwright context 的 `viewport` 或分三次调用（每次修改环境）。实践中通常以桌面端（1440）的 DOM 对比为主，配合 `visual-diff` 的三断点截图覆盖移动端。

### stdout 输出（终端摘要）

```json
{ "structureScore": 0.923, "styleScore": 0.871, "mismatches": 47 }
```

### report.json 完整结构

```json
{
  "structureScore": 0.923,
  "styleScore": 0.871,
  "origCount": 312,
  "cloneCount": 315,
  "mismatches": [
    {
      "path": "body/div[0]/header[0]/nav[0]/ul[1]/li[3]",
      "type": "structure",
      "orig": "li",
      "clone": "div"
    },
    {
      "path": "body/div[0]/section[2]/h2[0]",
      "type": "style",
      "prop": "font-family",
      "orig": "Inter, sans-serif",
      "clone": "Arial, sans-serif"
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| `structureScore` | 结构匹配率：`structMatch / max(origCount, cloneCount)`，范围 0~1 |
| `styleScore` | 样式匹配率：`styleMatch / (节点对数 × 16个检测属性)`，范围 0~1 |
| `origCount` | 原始站序列化节点总数 |
| `cloneCount` | 克隆站序列化节点总数 |
| `mismatches[].path` | 差异节点路径，格式为 `tag[index]/tag[index]/…` |
| `mismatches[].type` | `"structure"`（标签/层级差异）或 `"style"`（计算样式差异） |
| `mismatches[].prop` | 仅 `type=style` 时存在，差异的 CSS 属性名 |
| `mismatches[].orig` | 原始站的值（标签名或属性值） |
| `mismatches[].clone` | 克隆站的值（标签名或属性值） |

检测的 16 个 CSS 属性为：`display`、`position`、`color`、`background-color`、`font-size`、`font-weight`、`font-family`、`margin`、`padding`、`width`、`height`、`flex-direction`、`justify-content`、`align-items`、`text-align`、`border`。

---

## 四、分项阈值说明

### 像素 score：建议门控 ≥ 0.98

高保真静态站可设更高（如 0.99）。动效活跃或有大量图片懒加载的站可适当调低至 0.95。`--threshold 0.1` 的单像素容差默认值已足够容忍轻微的抗锯齿/次像素渲染差异，通常无需调整。

### structureScore：建议门控 ≥ 0.90

**语义**：`structMatch / max(origCount, cloneCount)`，其中 `structMatch` 是按列表下标线性对齐时，`tag` 和 `path` 均一致的节点数。

**已知限制 — 级联错位导致虚低**：算法按索引线性对齐两份节点列表，不做智能树对齐。如果 clone 在早期（如第 3 个节点处）多一个或少一个节点（常见原因：第三方 analytics/chat widget 注入了额外的 `<script>` 容器或 `<div>`），则此后所有节点的索引全部偏移，造成大规模假阳性结构 mismatch，`structureScore` 会系统性虚低。

**应对策略**：对有第三方注入的站点，可将门控调低至 0.80，或在运行 `dom-diff` 前先在 clone 的 `index.html` 中删除已知的第三方注入节点（analytics、chat widget、cookie banner 等），再比对。

### styleScore：建议门控 ≥ 0.85

**已知噪声源，会系统性压低 styleScore**：

1. **font-family 解析值差异**：原站加载了 web font（如 Inter），clone 尚未正确加载时，计算样式中 `font-family` 的 resolved 值会不同（如 `"Inter, sans-serif"` vs `"Arial, sans-serif"`），即便视觉上字体已正确渲染，DOM diff 仍会记为 mismatch。

2. **border 简写不稳定**：`border` 简写属性（如 `1px solid #eee`）在不同渲染环境或浏览器版本间，`getComputedStyle()` 返回的序列化格式可能不同（如 `"1px solid rgb(238, 238, 238)"` vs `"1px solid #eee"`），导致误报。

3. **width/height 亚像素 rounding**：两次独立的 Playwright 实例（原站和克隆站各启动一次浏览器）在布局引擎的浮点计算上可能存在微小差异，导致 `width`/`height` 有 0.5px 级别的偏差。

这些噪声不代表视觉问题，故 `styleScore` 门控不宜设太高（≥ 0.85 为合理区间）。排查 style mismatch 时，应优先关注 `prop` 为 `color`、`background-color`、`display`、`position`、`font-size` 的条目，而非 `font-family`、`border`、`width`、`height`。

---

## 五、report.html 模板

将三断点的像素对比结果和 DOM 对比结果汇总到单页报告。以下为完整可用的 HTML 模板，占位注释格式为 `<!-- {{字段名}} -->`，填入数据时替换对应注释及其相邻内容：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>复刻验证报告 — <!-- {{targetUrl}} --></title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f5f5f5; color: #222; }
  .header { background: #1a1a2e; color: #fff; padding: 24px 32px; }
  .header h1 { font-size: 20px; font-weight: 600; }
  .header .meta { font-size: 13px; color: #aaa; margin-top: 6px; }
  .section { background: #fff; border-radius: 8px; margin: 20px 32px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  .section h2 { font-size: 16px; font-weight: 600; margin-bottom: 16px; border-bottom: 1px solid #eee; padding-bottom: 10px; }
  .scores { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 20px; }
  .score-card { background: #f8f9fa; border-radius: 6px; padding: 16px 24px; min-width: 160px; }
  .score-card .label { font-size: 12px; color: #666; text-transform: uppercase; letter-spacing: .5px; }
  .score-card .value { font-size: 28px; font-weight: 700; margin-top: 4px; }
  .score-card.pass .value { color: #16a34a; }
  .score-card.fail .value { color: #dc2626; }
  .score-card.warn .value { color: #d97706; }
  .bp-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .bp-card { border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
  .bp-card .bp-label { background: #f3f4f6; padding: 8px 14px; font-size: 13px; font-weight: 500; display: flex; justify-content: space-between; align-items: center; }
  .bp-card .bp-score { font-weight: 700; }
  .bp-card .bp-score.pass { color: #16a34a; }
  .bp-card .bp-score.fail { color: #dc2626; }
  .bp-card img { width: 100%; display: block; }
  .bp-card .size-warn { font-size: 11px; color: #d97706; padding: 4px 14px; background: #fffbeb; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #f3f4f6; text-align: left; padding: 8px 12px; font-weight: 600; color: #555; }
  tbody tr:nth-child(even) { background: #fafafa; }
  tbody td { padding: 8px 12px; vertical-align: top; border-bottom: 1px solid #f0f0f0; }
  td.path { font-family: monospace; font-size: 11px; color: #555; max-width: 280px; word-break: break-all; }
  td.type-structure { color: #7c3aed; font-weight: 600; }
  td.type-style { color: #0369a1; font-weight: 600; }
  td.value-orig { color: #16a34a; }
  td.value-clone { color: #dc2626; }
  .empty { color: #999; font-style: italic; }
  .footer { text-align: center; font-size: 12px; color: #aaa; padding: 24px; }
</style>
</head>
<body>

<div class="header">
  <h1>复刻验证报告</h1>
  <div class="meta">
    目标站：<!-- {{targetUrl}} --> &nbsp;|&nbsp;
    克隆站：<!-- {{cloneUrl}} --> &nbsp;|&nbsp;
    生成时间：<!-- {{generatedAt}} -->
  </div>
</div>

<!-- DOM 对比汇总 -->
<div class="section">
  <h2>DOM 对比（dom-diff）</h2>
  <div class="scores">
    <div class="score-card <!-- {{structureScoreClass: pass/fail/warn}} -->">
      <div class="label">Structure Score</div>
      <!-- 门控 ≥0.90；低于此值标 fail，0.90~0.95 标 warn，≥0.95 标 pass -->
      <div class="value"><!-- {{structureScore}} --></div>
      <div class="label" style="margin-top:4px">节点对比 <!-- {{origCount}} --> vs <!-- {{cloneCount}} --></div>
    </div>
    <div class="score-card <!-- {{styleScoreClass: pass/fail/warn}} -->">
      <div class="label">Style Score</div>
      <!-- 门控 ≥0.85；低于此值标 fail，0.85~0.90 标 warn，≥0.90 标 pass -->
      <div class="value"><!-- {{styleScore}} --></div>
      <div class="label" style="margin-top:4px">mismatch 数：<!-- {{mismatchCount}} --></div>
    </div>
  </div>

  <!-- mismatches 表格（最多显示前 100 条） -->
  <table>
    <thead>
      <tr>
        <th>节点路径</th>
        <th>类型</th>
        <th>属性</th>
        <th>原始站</th>
        <th>克隆站</th>
      </tr>
    </thead>
    <tbody>
      <!-- 遍历 mismatches 数组，每条生成一行 <tr>：
           path → td.path
           type → td class="type-{{type}}" 显示 structure 或 style
           prop → 仅 type=style 时显示，否则空
           orig → td.value-orig
           clone → td.value-clone
      -->
      <!-- {{#each mismatches}} -->
      <tr>
        <td class="path"><!-- {{this.path}} --></td>
        <td class="type-<!-- {{this.type}} -->"><!-- {{this.type}} --></td>
        <td><!-- {{this.prop}} --></td>
        <td class="value-orig"><!-- {{this.orig}} --></td>
        <td class="value-clone"><!-- {{this.clone}} --></td>
      </tr>
      <!-- {{/each}} -->
      <!-- 如果 mismatches 为空，插入以下行 -->
      <!-- {{#if mismatchesEmpty}} -->
      <tr><td colspan="5" class="empty">无差异记录，对比通过。</td></tr>
      <!-- {{/if}} -->
    </tbody>
  </table>
</div>

<!-- 像素对比 — 三断点 -->
<div class="section">
  <h2>像素对比（visual-diff）— 三断点</h2>
  <div class="bp-grid">

    <!-- 断点 1440 -->
    <div class="bp-card">
      <div class="bp-label">
        <span>1440px（桌面）</span>
        <span class="bp-score <!-- {{vScore1440Class}} -->">score: <!-- {{vScore1440}} --></span>
      </div>
      <!-- 如果 origHeight1440 ≠ cloneHeight1440，插入以下警告 -->
      <!-- {{#if heightMismatch1440}} -->
      <div class="size-warn">
        高度差异：原始 <!-- {{origHeight1440}} -->px vs 克隆 <!-- {{cloneHeight1440}} -->px，底部区域需人工确认
      </div>
      <!-- {{/if}} -->
      <img src="diff-1440.png" alt="1440px diff heatmap">
    </div>

    <!-- 断点 768 -->
    <div class="bp-card">
      <div class="bp-label">
        <span>768px（平板）</span>
        <span class="bp-score <!-- {{vScore768Class}} -->">score: <!-- {{vScore768}} --></span>
      </div>
      <!-- {{#if heightMismatch768}} -->
      <div class="size-warn">
        高度差异：原始 <!-- {{origHeight768}} -->px vs 克隆 <!-- {{cloneHeight768}} -->px，底部区域需人工确认
      </div>
      <!-- {{/if}} -->
      <img src="diff-768.png" alt="768px diff heatmap">
    </div>

    <!-- 断点 375 -->
    <div class="bp-card">
      <div class="bp-label">
        <span>375px（移动端）</span>
        <span class="bp-score <!-- {{vScore375Class}} -->">score: <!-- {{vScore375}} --></span>
      </div>
      <!-- {{#if heightMismatch375}} -->
      <div class="size-warn">
        高度差异：原始 <!-- {{origHeight375}} -->px vs 克隆 <!-- {{cloneHeight375}} -->px，底部区域需人工确认
      </div>
      <!-- {{/if}} -->
      <img src="diff-375.png" alt="375px diff heatmap">
    </div>

  </div>
</div>

<!-- 终判区域 -->
<div class="section">
  <h2>终判</h2>
  <div class="scores">
    <div class="score-card <!-- {{overallClass: pass/fail}} -->">
      <div class="label">自动指标</div>
      <div class="value"><!-- {{overallAutoResult: 通过 / 未通过}} --></div>
    </div>
    <div class="score-card <!-- {{humanClass: pass/pending}} -->">
      <div class="label">人工确认</div>
      <div class="value"><!-- {{humanResult: 已确认 / 待确认}} --></div>
    </div>
  </div>
  <!-- 未通过时说明原因，如 "structureScore 0.82 < 0.90 门控；请根据 mismatches[].path 修复 clone 后重跑" -->
  <!-- {{failureNote}} -->
</div>

<div class="footer">
  site-replicator · 自动生成，需配合人工目视确认方可归档
</div>

</body>
</html>
```

---

## 六、完整三断点验证命令（可复制执行）

以下为完整的三断点验证流程，从原始站截图和克隆站 URL 出发，生成所有对比结果：

```bash
cd ~/.claude/skills/site-replicator

# 变量定义
ORIG_URL="https://example.com"
CLONE_URL="http://localhost:3000"
BASE=".site-replicator/example.com/home"

# Step A：抓取原始站截图（已在 page-pipeline 步骤 1 完成，此处复用）
# node scripts/capture.mjs $ORIG_URL --out $BASE/original --breakpoints 1440,768,375

# Step B：抓取克隆站截图（三断点）
node scripts/capture.mjs $CLONE_URL \
  --out $BASE/clone-cap \
  --breakpoints 1440,768,375

# Step C：三断点像素对比
for BP in 1440 768 375; do
  echo "=== visual-diff ${BP}px ==="
  node scripts/visual-diff.mjs \
    --orig  $BASE/original/screenshots/${BP}.png \
    --clone $BASE/clone-cap/screenshots/${BP}.png \
    --out   $BASE/diff-${BP}.png \
    --threshold 0.1
done

# Step D：DOM 结构 + 样式对比（以桌面端为主）
echo "=== dom-diff ==="
node scripts/dom-diff.mjs \
  --orig  $ORIG_URL \
  --clone $CLONE_URL \
  --out   $BASE/dom-report.json

# Step E：查看汇总
echo "--- DOM diff summary ---"
node -e "
  const r = JSON.parse(require('fs').readFileSync('$BASE/dom-report.json', 'utf8'));
  console.log('structureScore:', r.structureScore.toFixed(4), r.structureScore >= 0.90 ? '✓' : '✗ (<0.90)');
  console.log('styleScore:    ', r.styleScore.toFixed(4),     r.styleScore     >= 0.85 ? '✓' : '✗ (<0.85)');
  console.log('mismatches:    ', r.mismatches.length);
"
```

---

## 七、终判双关卡

复刻通过必须同时满足以下两个关卡，**缺一不可**：

### 关卡 1：自动指标全部达标

| 指标 | 门控 |
|---|---|
| visual-diff `score`（1440px） | ≥ 0.98 |
| visual-diff `score`（768px） | ≥ 0.98 |
| visual-diff `score`（375px） | ≥ 0.98 |
| dom-diff `structureScore` | ≥ 0.90 |
| dom-diff `styleScore` | ≥ 0.85 |

任一指标未达标，需按回修闭环（见 `01-page-pipeline.md` 第四节）修复 clone 后重跑验证。

### 关卡 2：人工目视确认

打开 `report.html`，逐一检查：

1. 三张热力图（`diff-1440.png`、`diff-768.png`、`diff-375.png`）无明显红色区域（亮红色 = 高差异）。
2. 若 `origHeight ≠ cloneHeight`，手动打开截图对比底部区域。
3. 导航栏、Hero 区域、核心 CTA 按钮、Footer 的视觉排布与原站一致。
4. 字体、颜色、间距无肉眼可见偏差。

两个关卡均通过后，方可在 `report.html` 中标记「人工确认：已确认」，并将报告归档。
