---
name: update-changelog
description: 完成修改后自动整理变更要点，写入工作记忆 (MEMORY.md / daily log) 并更新 docs/CHANGELOG.md 项目更新记录；若改动了数据图层清单，还要同步 docs/static-vector-help.md。适用于 OGV 项目中任何非平凡的修改任务后。
agent_created: true
---

# Update Changelog

## Overview

专门的 OGV 项目更新记录技能。每次完成实质性修改后自动提炼变更要点、写入工作记忆、更新 CHANGELOG，**必要时同步数据图层帮助文档**。

当用户明确要求"把修改写进记忆"、"更新 CHANGELOG"、"整理今天的修改"时触发。也可在完成大型修改（8+ 次工具调用、或涉及多个文件的关键修复/重构）后主动调用。

## Workflow

### Step 1: 提取变更要点

回顾当前会话中所有修改，按以下维度组织：

- **文件变更清单** — 修改/新建/删除的文件路径
- **功能改动** — 每个改动的目的和实现方式
- **关键决策** — 为什么选择这个方案、放弃了哪些方案
- **已知问题 / 后续** — 遗留问题或未来优化方向
- **CSS 类名 / 选择器变更** — 如果涉及重命名，记录新旧映射

### Step 2: 判断要不要同步「数据图层帮助文档」

**触发条件（命中任一即做）**：本轮改了 `assets/geo-config.js` 第 ③ 段 `window.geoJsonGroups`：

- 新增 / 删除图层
- 图层改名
- **把图层在组之间挪动**（最容易漏！）
- 改 `hidden`（可见性变了）
- 改了会影响用户理解的字段：`labelField` / `icon` / `colorMode` / `source` / `selectable`

**目标文件**：`docs/static-vector-help.md`
—— 就是面板里「📑 数据图层」标题旁那个 `?` 打开的文件（`index.html` 的 `data-dialog="docs/static-vector-help.md"`）。
⚠️ `docs/` 随站点一起发布，改了就等于对用户可见，跟 CHANGELOG 一样属于"入库即上线"。

**写法约定**：

- 章节顺序 = `geoJsonGroups` 的组顺序；组标题用 `###`，与 `groupName` 一致
- **只写实际能看到的组与图层**（面板不渲染 `hidden` 的组/项）→ 隐藏项统一收进「暂未开放」一节
- 每条写「面板显示名 + 一句话说明」，标注字段/颜色/图标这类用户看得见的差异可以顺带写

**核对手段（必做，别凭记忆）**：

```bash
node .workbuddy/artifacts/dump-layers.js
```

按组打印全部图层及其 `labelField / color / icon / colorMode / hidden / selectable / searchPriority`。
拿它的输出与文档逐条对账：

- 文档里**不能出现已删除的图层名**
- 文档里不能出现被 `hidden` 掉的图层（除非写在「暂未开放」一节）
- 可见组数 / 项数要对得上（2026-09-17 时点：**8 组 / 59 项**）

### Step 3: 写入工作记忆

按以下规则写入：

1. **日级日志** `.workbuddy/memory/YYYY-MM-DD.md`（完整路径 `c:\Users\hehu\Documents\GitHub\gis\.workbuddy\memory\`）
   - 存在则**追加到文件末尾**，不存在则先创建目录与文件
   - 用 `##` 二级标题分隔每个独立改动
   - ⚠️ 日志是 **append-only 且按时间正序**（最早在上、最新在底部）——
     不要重排、不要覆盖、不要把新内容插到顶部
   - 同一天多轮改动按 `## 2026-09-12（b）— 标题` 的序号后缀逐条往下加

2. **长期记忆** `.workbuddy/memory/MEMORY.md`
   - 只记录跨会话有用的持久性知识（架构决策、命名约定、关键修复）
   - 不记录临时搜索、路径、工具报错
   - ⚠️ 该文件有注入体积上限（约 10 KB），**超了尾部会被截断**。
     已做过一次精编（31 KB → 16 KB）。新增内容尽量**改在已有条目里**而不是另起小节；
     若确实膨胀了，先合并去重再说

3. **用户偏好** `~/.workbuddy/MEMORY.md`
   - 跨项目的用户偏好才写到这里

### Step 4: 更新 CHANGELOG

文件路径：`docs/CHANGELOG.md`

**照抄文件里既有条目的样子**，不要自创格式。实际约定：

```markdown
## YYYY-MM-DD（x）— 一句话标题

> 可选引言（版本号说明、取代了哪一条等）

### 起因 / 为什么要改

- 用 `- ` 列表描述改动，文件路径、类名、函数名一律反引号
- 关键技术细节、（含单位的）实测数字放正文；能用表格就用表格

### 验证

### 变更文件

---

## YYYY-MM-DD（x-1）— 上一条
```

- **新条目插到文件最上面**（紧跟 `# 更新记录` 与空行之后），老条目自然往下沉
- 同一天多条用全角括号序号：`（b）`、`（c）`、`（d）`…（首条可不写序号）
- 惯用小节：`### 起因` / `### 修复` / `### 实测` / `### 验证` / `### 变更文件` / `### 待定`
- 条目之间用 `---` 分隔
- `### 变更文件` 要逐个列全（含 `service-worker.js` 的 `CACHE_NAME` 变化）
- 版本号唯一真源是 `service-worker.js` 的 `CACHE_NAME`；**未提交/未发布的版本
  不必为新改动二次 bump**（改动随该版本一起发出即可）。
  ⚠️ **例外**：若被改动的文件是 **SW 预缓存资源**（`geojsonloader.js` / `geo-utils.js` /
  `geo-config.js` / CSS 等）**且浏览器已经加载并缓存过上一版**（本地联调时基本必然发生），
  则**必须再 bump 一次** —— SW 对同源预缓存是 cache-first，`CACHE_NAME` 不变就继续吐旧文件，
  普通刷新（F5）看不到修复。判定口径：**「用户是不是已经在自己的浏览器里跑过上一版」**，
  是 → bump；否则不必。bump 时在条目引言里写明为什么破例（2026-09-13 连续两次踩到）。
- ⚠️ **新增文件必须同步进 `service-worker.js` 的 `STATIC_ASSETS`**
  （`assets/*.js`、`assets/*.css` 一律预缓存；漏了 = 离线打不开、且不会报错）

#### 截图（如有）

- 截图统一放 `docs/shots/`，正文用 `![说明](shots/xxx.png)` 相对路径引用 ——
  `assets/dialog.js` 的 `resolveRelativeImages` 会按**文档所在目录**补前缀，
  所以 App 弹窗内与 GitHub 上**同时生效**
- 惯用 `### 截图（弹窗内点击可放大）` 小节，放在条目最后（`### 验证` 之后）
- ⚠️ **别把尺寸悬殊的两张图放进同一张表格**：`max-width:100%` 下表格列宽按原图比例
  分配（1440 与 408 并排 → 408 那张只剩 **132px**，等于白截）。只有尺寸相近才并排
- 小控件（宽 <300px）的细节图用 `deviceScaleFactor: 2` **重新渲染**截取
  （`elementHandle.screenshot()`），不要对位图放大 —— 必糊
- ⚠️ **全屏地图截图一律用 JPEG（`type:"jpeg", quality:78`），别存 PNG**：同一张 1165×745 的
  地图（含地形/标注噪声）PNG **1.17 MB**、JPEG **136 KB**，差 8.6 倍。`docs/shots/` 全部
  15 张 PNG 加起来才 1.6 MB —— 一张地图 PNG 就能把它翻倍。`.jpg` 已在 `.gitattributes`
  里声明 binary，不用改。UI/控件类小图仍用 PNG（文字边缘才锐）
- 引用完要核对：`docs/shots/` 下**不应有未被引用的孤儿图**，反之也不该有指向不存在文件的死链

### Step 5: 收尾

- ⚠️ **必须与历史条目对账**：同一个症状可能已经修过好几次、但每次根因都不同。
  典型：弹窗「缩放至 / 详情」按钮失效在 2026-09-13 一天之内出现了 **3 次**
  （（c）v2.6.1 = `popupopen` 时序；（d）v2.6.2 = 数据里的 HTML 撑坏标记；
  （e）v2.6.3 = 重渲染抹掉 `onclick` + Canvas 要素缺 geometry），三者**毫无因果关系**。
  —— 编号会随新条目改动，**引用时以 `docs/CHANGELOG.md` 里的实际标题为准**，别照抄旧记录。
  新条目里要点名"这条与上一条是两回事"，否则下次会把旧结论当前提、查错方向。
- 修 bug 的条目要给出**修复前/后实测对照表**（真实数字、含单位），不要只写"已修复"
- 若本轮顺带产出了可复用的调试流程，另存为独立 skill 并在本条目 `### 变更文件` 后提一句
  （例：Leaflet 弹窗类问题 → `leaflet-popup-debug`）
- 本技能无 bundled resources（`scripts/` `references/` `assets/` 已清空）——
  不要再往里放示例文件
- ⚠️ **不要执行任何 git 操作**（`add` / `commit` / `push` / `tag`）—— 用户自己来。
  但要在报告里点名「哪些新文件还没入库」（如 `docs/shots/`），方便他自己 add
- 完成后向用户报告：改了哪些文件、关键坑、遗留待定项

## 常用辅助脚本（都在 `.workbuddy/artifacts/`）

| 脚本 | 用途 |
|---|---|
| `dump-layers.js` | 按组打印 `geoJsonGroups` 全部图层 + 关键字段（**同步帮助文档时必跑**） |
| `check-geoconfig.js` | 在最小 DOM 桩里跑一遍 `geo-config.js`，只校验语法与分组计数（不做 git/浏览器） |

浏览器侧（Playwright，需先起 `python -m http.server 8899`）脚本也都放这个目录，
文件头要 `module.paths.push("C:/Users/hehu/.workbuddy/binaries/node/workspace/node_modules")`。

## ⚠️ 本机工具链

- **Bash 工具的 PATH 为空** → 命令前必须加：
  `export PATH="/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/usr/bin:/c/Users/hehu/.workbuddy/binaries/PortableGit/versions/1.2.0/bin"`
  （`/usr/bin:/bin` 里**没有 `head`/`ls`/`curl`**；`python` 也不在 PATH 上）
- node 用绝对路径 `"C:/Users/hehu/.workbuddy/binaries/node/versions/22.22.2-3/node.exe"` +
  `NODE_PATH="C:/Users/hehu/.workbuddy/binaries/node/workspace/node_modules"`
- python 用 `"C:/Users/hehu/.workbuddy/binaries/python/versions/3.13.12/python.exe"`
