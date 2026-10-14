---
name: megmeet-dsh-plugin-skills
description: "Build or refine Megmeet DeepSeek Harness plugin frontends using the agreed window chrome, icon entry, visual tokens and workflow conventions. Use when creating a DSH plugin UI or aligning an existing plugin with Harness; EDA-specific pages apply only to the circuit-design plugin."
---

# Megmeet DSH 插件 UI

复用用户在 2026-10-14 确认的插件前端。这里保存的是本项目约定，后续用户明确的修改要求优先。

## 工作方式

1. 读取 [UI Spec](references/ui-spec.md)，检查当前插件入口、窗口容器、已确认布局和本机 Harness 的实际样式。窄范围视觉修改保留流程及布局；其他插件沿用视觉与窗口规范，不自动套用电路设计的七步业务。
2. 调整宿主入口或窗口时，确保入口不挤压相邻插件，窗口独立且重复打开复用实例。标题栏与页面顶栏须在原生窗口截图中核对；浏览器页面截图不能证明系统标题栏已经匹配。
3. 修改原理图与 PCB 插件时，另读 [显示板流程约定](references/eda-flow.md)，据此保留工程身份、输入来源、人工确认和真实模型边界。
4. 本机使用模拟响应验证请求状态；默认不发起付费模型请求。检查本次改动涉及的尺寸、悬停、键盘焦点、失败重试及宿主聊天。仅声明实际验证通过的项目。
5. 保存修改后的源码与实际截图；交付时说明是否已同步到已安装插件。需要更新本规范时，同时更新数值与适用范围，避免只追加相互冲突的历史要求。

## 参考实现

仓库副本位于 `skills/megmeet-dsh-plugin-skills`，插件参考实现位于 `plugins/dsh-eda-flow`：

- `client.js`：只注入宿主图标入口，不注入整个工程工作区。
- `desktop/main.cjs`、`desktop/preload.cjs`：独立窗口和最小呈现桥接。
- `frontend/WindowTitlebar.jsx`、`frontend/styles.css`：标题栏、视觉变量及响应式布局。
- `src/window.js`：插件专用回环服务；模型配置及登录保留在 Harness。

这些是参考实现的相对位置；迁移到其他工作区时先定位仓库，不依赖开发机绝对路径。
