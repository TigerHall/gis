# 2026-06-19 v3 改版概览

## ① CSS 变量体系

`main.css` / `dialog.css` 引入约 70 个 CSS 自定义属性（`--panel-bg`、`--section-*`、`--text-*`、`--dlg-*`），彻底解耦颜色定义与选择器。

## ② 深色模式重设计

- 背景色从 `#222226` → `#1c1c20`（更深更中性）
- 文字从 `#ddd` → `#e0e0e0`（更高对比）
- 绿色强调从 `#5aaa5a` → `#6aae6a`（更柔和）
- 新增 `--panel-shadow` 变量，阴影随主题切换

## ③ 35+ 硬编码颜色 → `var()`

| 元素                        | 原来                           | 改为                                                |
| --------------------------- | ------------------------------ | --------------------------------------------------- |
| 状态灯 (idle/loading/error) | `#ddd` / `#f0c040` / `#e5534b` | `var(--status-*)`                                   |
| Tooltip/Popup 边框          | `#4a8c4a`                      | `var(--accent)`                                     |
| 版本号文字                  | `rgba(0,0,0,0.3)`              | `var(--text-faint)`                                 |
| 刷新菜单按钮                | `#e8e8ed`                      | `var(--content-checked-bg)`                         |
| 折叠区切换按钮              | `#8ab88a` / `#f0f6f0`          | `var(--accent-lighter)` / `var(--content-hover-bg)` |

## ④ pointdrop 样式分离

- 新建 `assets/pointdrop.css` — 15 个 `.pd-*` 类
- `pointdrop.js` 完全移除 20 处 `style.cssText`
- `geojsonloader.css` 删除 50 行旧投点样式

## 文件变更

| 文件                       | 变更                        |
| -------------------------- | --------------------------- |
| `assets/pointdrop.css`     | 🆕 新建（投点编辑器专用）    |
| `assets/pointdrop.js`      | 🔄 内联样式全部替换为 class  |
| `assets/main.css`          | 🔄 CSS 变量 + 35 处修复      |
| `assets/dialog.css`        | 🔄 深色模式配色同步          |
| `assets/geojsonloader.css` | 🔄 3 处颜色修复 + 删除 50 行 |
| `index.html`               | ➕ 引入 pointdrop.css        |
| `docs/CHANGELOG.md`        | 📝 更新                      |
