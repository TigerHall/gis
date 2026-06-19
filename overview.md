# 2026-06-19 工作概览

## 范围
OGV 项目侧边栏全面重构与交互优化，涉及 6 个文件的大规模改动。

## 关键变更

### 架构层面
1. **侧边栏骨架从 JS 移到 HTML** — 不再依赖 JS 构建面板结构
2. **CSS Checkbox Hack 替代 JS 面板开关** — 面板开合在 HTML 解析完成后即可用
3. **模块化面板系统** — `.panel-module` 统一管理间距和视觉规范

### 交互层面
4. **声明式 `data-dialog` 绑定** — HTML 属性替代手动 JS 事件
5. **面板开合状态持久化** — `[data-persist-details]` 自动保存恢复
6. **统一图层展开逻辑** — `expandToLayerGroup()` 覆盖所有勾选场景
7. **搜索持久化** — 搜索勾选的图层刷新后可恢复

### CSS 层面
8. 约 150 行样式从 `geojsonloader.css` 迁移到 `main.css`
9. 复选框恢复自定义 `appearance` + `--layer-color` 专属颜色
10. localStorage key 前缀统一为 `dupal_`

### 文件变更统计
- **index.html**: 侧边栏骨架完整重写
- **main.css**: 新增约 80 行，删除约 50 行
- **dialog.js**: 新增 `data-dialog` 自动绑定，完善文档
- **dialog.css**: MD 渲染排版优化
- **geojsonloader.js**: 精简约 120 行，新增 `expandToLayerGroup()` / `initDetailsPersistence()`
- **app.js**: 删除 toggleSection 持久化和自动折叠逻辑
- **geojsonloader.css**: 精简约 150 行重复样式
- **docs/**: 新增 2 个帮助文档 + 更新 CHANGELOG
