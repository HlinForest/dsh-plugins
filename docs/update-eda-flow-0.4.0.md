# 电路设计 0.4.0：内网升级与纯文字试用

适用于已经安装电路设计插件的 Harness 0.2.0-rc.2。保留原项目、工作目录、模型供应商、登录和窗口运行时。新项目使用纯文字需求与规格书正文，经模型调用通用 KiCad MCP 生成原理图；旧项目继续可查看，标记为历史转换工程。

## 获取并更新

本次上传到独立分支 `release/eda-flow-0.4.0`，未修改 `main` 或发布标签。已有仓库可切换到试用分支（工作区有未提交内容时先保留自己的修改）：

```powershell
git fetch origin release/eda-flow-0.4.0
if ($LASTEXITCODE -ne 0) { throw '拉取失败，请先停止更新' }
git switch -c try-eda-flow-0.4.0 --track origin/release/eda-flow-0.4.0
if ($LASTEXITCODE -ne 0) { throw '拉取失败，请先停止更新' }
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-eda-flow.ps1 -Profile desktop -PackageVersion 0.4.0 -DisableModelCalls
if ($LASTEXITCODE -ne 0) { throw '升级失败，请保留报错和备份' }
```

也可下载 [EDA_Flow_Update_0.4.0.zip](../output/packages/EDA_Flow_Update_0.4.0.zip)，复制到内网并解压，在解压目录执行上面的更新脚本，无需拉取仓库。ZIP 内有 `scripts/` 和 `dist/`，请保持目录结构。核对 [SHA-256](../output/packages/EDA_Flow_Update_0.4.0.sha256.txt)。

更新脚本自动生成可恢复备份，位置会打印在结果中。`-DisableModelCalls` 只把电路设计插件的 `allowModelCalls` 设为 `false`，其余配置保持；不会请求模型、覆盖项目或自动退出 Harness。已有 profile 不叫 `desktop` 时替换为原值；自定义安装路径可使用 `-DshHomePath`、`-DshCommand`。默认使用现有 pnpm 离线缓存，缺少其他宿主依赖时可用 `-Registry` 指定获准的内网 npm 源。

## 先查看界面，不请求模型

1. 等当前聊天任务结束，正常退出整个 Harness，再重新打开；只关闭电路设计子窗口可能保留旧后台。
2. 点击侧栏电路设计入口，核对左下角页面与后台均为 **0.4.0**。
3. 新建项目，选择“使用显示板输入”。第一步的完整任务书可查看、编辑、复制或下载。原项目仍在项目列表中。
4. 左侧七步保留，第六步明确为“PCB · 未执行”；其余步骤未执行时显示待处理。
5. 规格书 PDF 当前只登记；第三步可粘贴准确型号、版本、来源和页码的正文。未读取的附件不会标为已读。

也可运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-eda-flow.ps1 -Profile desktop
```

预期 `installedVersion: 0.4.0`、`runningVersion: 0.4.0`、`activation: active`。

## 准备实际模型执行

查看输入不需要安装新增 Python 依赖。实际 MCP 生成需要 KiCad 10、Python 3.10+ 和 `jsonschema`。优先检查原配置的 `kicadPython`；配置了 `mcpPython` 时检查后者：

```powershell
& 'D:\KiCad\bin\python.exe' -c "import sys,jsonschema; print(sys.version); print('jsonschema ready')"
```

若缺少依赖，ZIP 内提供经过离线安装检查的 **Windows x64 / CPython 3.11** 轮子，与本机 KiCad Python 3.11.5 一致。从解压目录执行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-eda-mcp-python.ps1 -PythonExe 'D:\KiCad\bin\python.exe'
```

请换成内网实际路径。脚本检查解释器版本和轮子哈希，再用 `--no-index` 安装；不会联网。其他 Python 版本需要匹配版本的离线轮子，或由内网批准的软件源安装 `jsonschema>=4.18,<5`。不要用 0.3.x 的旧 Python 安装脚本代替本次新增依赖。

确认要进行真实测试后，在原 Harness profile 的 `eda-flow` 配置中将 `allowModelCalls` 改为 `true`，其余配置保持；正常重开使配置生效。在 Harness 选择内网可用模型，再在电路设计中逐步点击执行。安装和查看页面不会自动请求模型，点击生成或助手对话后会使用模型额度。

## 验收与回传

第一步核对并人工确认；第二、三步整理设计依据与器件；第四步实际生成原理图；第五步核对 BOM；第六步保持未执行；第七步核验并下载文件。修改上游文字后，下游状态变为待更新。需要独立再生成时新建另一项目，使用同一最终文字重新执行，不重放固定调用。

本机先完成两次独立 Codex 生成，各 2,395 项比较通过、0 差异；ERC 均为 0 错误、1 条保留警告。精确坐标与特殊连接由任务书提供。插件 34 项后端和 10 项前端测试通过，包括模拟模型、实际 MCP 和 KiCad 导出；随后在实际 Harness 安装打开，182 个包内文件一致，旧项目 83 个文件哈希未变，新增 DSH 请求 0。

**内网安装和 Harness 真实模型全流程仍待验证。** 本机 Codex、模拟模型和工具检查不能代替该验收。没有独立原工程基准时，第七步原工程差异检查应显示未执行；PCB、制造和实物性能不在本轮范围。

遇到问题请保留页面错误、当前步骤及该步的模型/MCP 操作记录，并告知页面与后台版本。分享记录前去除模型凭据和不宜外发的内网资料。不要上传整个 profile 或登录文件。
