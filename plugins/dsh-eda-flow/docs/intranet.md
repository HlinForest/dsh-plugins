# 内网安装与试用

解压 `EDA_Flow_Intranet_0.3.1.zip`，保留目录。安装包已包含显示板输入，无需旧工作台、旧工程目录或开发机路径。

[GitHub 完整离线包与 UI skills](https://github.com/HlinForest/dsh-plugins/releases/tag/eda-flow-v0.3.1)。完整包包含独立窗口运行时、Python 离线依赖与 `skills/megmeet-dsh-plugin-skills`；安装器自动复制随包窗口运行时，不联网下载它。Harness、Node 与 KiCad 仍需预先安装。更新前先关闭电路设计窗口。

先在 Harness 中选好内网可用模型。插件使用该模型，不另填密钥。

在解压目录运行（将工作区与 KiCad 路径换成内网电脑的实际路径）：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-offline-python.ps1 -PythonExe 'D:\KiCad\bin\python.exe'
powershell -ExecutionPolicy Bypass -File .\scripts\check-environment.ps1 -WorkspaceRoot 'D:\EDA' -KicadDirectory 'D:\KiCad\bin'
powershell -ExecutionPolicy Bypass -File .\scripts\install-intranet.ps1 -WorkspaceRoot 'D:\EDA' -KicadDirectory 'D:\KiCad\bin' -Profile desktop
```

工作区需先存在。安装器备份 profile 清单和配置，保留现有模型与登录，默认开启模型处理。安装不会发起模型请求。重启 Harness，点击侧边栏“原理图与 PCB 流程”。

包内 Node 运行依赖已携带；若 profile 中其他依赖没有离线缓存，可给安装器加 `-Registry` 指向允许的内网 npm 源。DSH 不在默认安装位置时使用 `-DshCommand` 指定 dsh.cmd。

也可手动执行：

```powershell
dsh plugin --profile desktop add .\plugin\dsh-eda-flow-0.3.1.tgz
```

将该插件配置为：

```yaml
- id: eda-flow
  config:
    workspaceRoot: 'D:/EDA'
    workDirectory: 'D:/EDA/eda-flow'
    kicadPython: 'D:/KiCad/bin/python.exe'
    kicadCli: 'D:/KiCad/bin/kicad-cli.exe'
    allowModelCalls: true
```

按 [桌面窗口说明](desktop-window.md) 部署独立运行时后，点击电路设计图标打开独立桌面窗口；悬停可查看入口名称。未部署运行时时使用 Edge 回退。“新建项目”选择显示板输入或空白输入。第一步可人工确认，其他生成阶段调用真实模型；错误按服务实际返回分类。文件选择会将资料复制到当前项目目录。

UI skills 是供开发助手复用的界面规范，不是运行插件的必要依赖。可直接阅读随包 `skills/megmeet-dsh-plugin-skills/SKILL.md`；在 Codex 使用时把整个文件夹复制到本机技能目录，然后指定 `$megmeet-dsh-plugin-skills`。它包含通用 UI spec、显示板流程约定及实拍参考。

试用记录在 `workDirectory/projects/<项目ID>/steps/<步骤>/<运行ID>`：`model-log.json` 是实际模型输入、读取、输出与错误；`commands.json` 是本次工具执行；`result.json` 是结果；原工程和规格书快照也在对应步骤。第 7 步提供工程 ZIP 与完整冻结记录 ZIP。

内网验收重点：确认选中的真实模型能读到默认数据，执行七步，并核对模型名、请求日志、图纸、BOM、PCB、差异报告。空目录重放使用已记录方案，因此不重新消耗模型额度。它验证工具执行可复现，不能代替真实模型能力验证。

本机验证不调用付费模型；随包验证报告明确标出模拟接口和真实 KiCad 的各自范围。
