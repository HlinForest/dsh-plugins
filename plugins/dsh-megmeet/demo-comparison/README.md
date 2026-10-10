# DSH 麦格米特插件对照演示

双击 `index.html` 即可离线演示，推荐从“共同输入 → 原始输出 → 逐项校验 → 演示说明”展开。文件中两份报告是 2026-10-09 真实运行的未改写回答。

本次两组均正确分类五个虚构型号。有插件组增加了 8 次实际工具调用、11 条带原文依据的约束和完整参数来源记录，累计 token 用量也更高。完整对比见 `comparison.md`。

## 复现

当前机器已经具备独立的官方 rc.2 CLI runtime、本机 DSH 登录状态及两个演示 profile。无需另填 API Key：

```powershell
& 'D:\VisualBoard\dsh-megmeet\demo-comparison\reproduce.ps1'
```

脚本将新运行保存到 `replays/时间戳`，保留当前演示原件。原始回答、事件流、完整工具结果与元数据全部另存。每次创建新会话，复用相同模型、prompt 与共享配置。未来模型措辞、工具调用次数、耗时与用量可能变化；自动验证与人工评审应分别记录。

在新机器上安装独立 CLI runtime 与 Node 后，将 rc.2 安装到本项目 `.verification/dsh-host`：

```powershell
npm install --prefix 'D:\VisualBoard\dsh-megmeet\.verification\dsh-host' --ignore-scripts '@deepseek-ai/dsh@0.2.0-rc.2'
```

还需要 pnpm，以及通过官方 DSH 登录完成的本机账号。`collect-evidence.mjs` 需要项目开发依赖 `js-yaml`（项目根目录执行 `npm ci --ignore-scripts`）。`build_demo.py` 使用本机 Python 的 `mistune`，将当前记录生成 HTML；输出构建验证针对本次实际 8 次调用，复现后的调用次数变化时应人工复核，而不是强制改写原始输出。

所有凭据保留在 DSH 自己的账号存储中，演示包不包含账号凭据、认证头或完整私有会话日志。只导出本次虚构演示的工具调用、工具结果、模型标识及 prompt 哈希。原始 stderr 和事件流为本次演示模型日志。

## 运行证据

`verification.json` 验证同一 prompt、同一实际模型、两条独立会话、唯一插件配置差异、产品库一致，以及回答与原始事件流一致。`runs/tool-results.full.json` 保存 8 份完整工具结果，避免 headless JSON 事件流的长字段截断。`experiment.json` 记录运行条件、实际会话 ID、用量和限制。

这是 headless 运行对照，未改动当前桌面 profile。单次演示不等同于整体准确率或性能评测；参数和来源全部为虚构 DEMO-1 数据。
