# 图层组重构 + 侧边栏优化 + 弹窗增强

## 改动概览

### 1. 间距调整
- `.layer-panel` `gap: 6px → 3px`（搜索栏上方更紧凑）
- `details.layer-group` 添加 `margin-bottom: 6px`（图层组之间保持呼吸感）
- 搜索栏和上面标题行的间距通过 gap 3px 自然收窄

### 2. PWA 更新弹窗显示版本号
- 提取 `_appVersion` 全局变量（从 service-worker.js 读取 CACHE_NAME）
- 弹窗文案从 "📦 新版本可用" → "新版本 v1.6.20 已就绪"（动态读取 SW 中的版本）

### 3. Dialog 遮罩点击关闭
- `_mdDialog` 元素创建时添加 `click` 监听器
- `e.target === dialog` 判断点击的是遮罩（backdrop）而非内容区
- 点击遮罩即 `dialog.close()`，与 X 按钮等效

### 4. ⓘ 关于链接改为弹窗渲染 README
- 原来：`<a href="about.html" target="_blank">` → 跳转页面
- 改为：调用 `showMarkdown("README.md", "关于本站")` → 弹出 dialog 渲染项目 README
- 基于 `marked.js`（已引入本地 `./assets/marked.min.js`）

### 5. 新增 marked.js 依赖
- `index.html` 在 `dialog.js` 前加载 `./assets/marked.min.js`
- 本地已有此文件（test.html 也在使用）
