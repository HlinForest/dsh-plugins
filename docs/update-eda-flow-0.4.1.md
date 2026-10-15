# 电路设计 0.4.1：补充入口、JSON 容错与 Harness 多轮调用修复

本次修复内网试用反馈的三处问题：

- 第二步“补充文字要求”现在定位并聚焦填写框；页面另有“补充本步文字”和“补充规格书正文”。从第二步跳去规格书后显示“保存并返回第二步”，已填的文字先保存。完整输入窗口增加明确的返回按钮。
- 第三步偶发回复格式错误：允许单个 JSON 代码块前后的普通说明；JSON 缺损或格式不合规时，最多请求模型修正 2 次，保留输入和原文。仍失败时可查看、下载原始回复。不会用猜测补齐电路数据，多段相互冲突的动作不会直接执行。自动格式修正在用户已发起的处理内进行，会产生最多两次额外模型请求。
- 第四步 `Cannot read properties of undefined (reading 'replayState')`：上一轮 assistant 消息遗漏 `source`，真实 Harness 在第二轮读取消息来源时失败。现改用 Harness 官方消息组装方法，保留 provider、model、reasoning 内容和对应 replayState，覆盖工具结果、格式修正、完成结果被拒绝及历史资料读取四种后续请求。

消息组装辅助代码已随插件打包；实际模型仍通过已安装 Harness 的服务调用，不需要内网额外下载 Node 包。Python 依赖与 0.4.0 相同。

## 已有 0.4.0 如何更新

下载并解压 [EDA_Flow_Update_0.4.1.zip](../output/packages/EDA_Flow_Update_0.4.1.zip)。在解压目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-eda-flow.ps1 -Profile desktop -PackageVersion 0.4.1
if ($LASTEXITCODE -ne 0) { throw '更新失败，请保留报错与备份' }
```

该命令沿用原来的模型调用开关，保留现有项目、配置、登录和窗口运行时，并自动备份原插件与配置。仅想查看界面时加 `-DisableModelCalls`。安装不会发起模型请求或自动重启。

等当前任务结束后，正常退出整个 Harness 再重开，确认页面和后台均为 **0.4.1**。可执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-eda-flow.ps1 -Profile desktop
```

打开原项目即可。第二、三步若已完成确认，保持原结果；在第四步直接重试“生成原理图”，无需重新建项目或重做已确认步骤。失败生成的文件和记录保留在原执行目录，新一次执行使用新的目录。

本次仍发布在原试用分支 `release/eda-flow-0.4.0`，主分支未改；此前按固定提交下载的 0.4.0 ZIP 不会自动变成新版，请下载 **0.4.1** 文件。

## 验证范围

使用真实 Harness 0.2.0-rc.2 运行库和本地模型适配器，先复现相同 `replayState` 报错，再核对修复后的多轮消息、推理块和状态传递。实际 KiCad MCP 创建、读取和导出也继续验证。模型回复来自测试适配器，本机 DSH 付费请求为 0；内网真实模型的生成质量仍由本次内网试用验证。

第二步入口与返回路径通过浏览器实际点击核对。未更新本机已安装 Harness，也没有为发布重启当前宿主。模型偶发 JSON 错误与已确定的消息来源缺失分别记录，不能把后者归因于模型服务。
