# 电路设计 0.9.5-beta.1 内网试用包

完整包也已放入仓库：[获取分卷并自动合并](../intranet/eda-flow-0.9.5-beta.1/README.md)，无需访问 Release。

从 Harness 新建“显示板演示 · 默认需求与模拟 PDF”，逐步执行自然语言需求、PDF 正文提取、器件与电气设计、原理图、BOM 和交付检查。输入可编辑；PCB 本轮不执行。

包内提供原始插件 TGZ、Windows x64 独立窗口运行时、Python 3.11 离线依赖及七步演示回放。Harness、Node 和 KiCad 需事先安装。模型使用 Harness 已配置的账号或内网模型服务；安装包不含账号。

## 环境

- Windows x64；DeepSeek Harness 0.2.0-rc.2；Node.js ≥22.19。
- KiCad 10.0.6（含符号库、CLI 和 Python 3.11 x64）。
- 安装脚本使用 KiCad 的 Python 创建独立排版环境，不修改 KiCad 自身的 Python 依赖。离线轮子适用于 Python 3.11 x64。
- 首先正常打开 Harness，使目标 profile 初始化完成。默认 profile 为 desktop。

## 已安装电路设计：更新

正常退出 Harness，将本 ZIP 完整解压，在解压目录执行。把示例路径改为实际路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-offline-python.ps1 -PythonExe "D:\KiCad\bin\python.exe" -EnvironmentDirectory "D:\EDA-Python-095"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-eda-flow.ps1 -Profile desktop -McpPython "D:\EDA-Python-095\Scripts\python.exe"
```

更新入口备份旧包和配置，保留工作目录、模型、登录及已有项目，并将 mcpPython 指向本次独立排版环境。默认使用原 pnpm 离线缓存；其他已安装插件若缺少缓存，可用 `-Registry "https://你的内网npm地址"` 指定内网源。更新后重新启动整个 Harness。

## 首次安装电路设计

先执行上面的 Python 依赖安装命令，然后创建实际工作目录并安装：

```powershell
New-Item -ItemType Directory -Force "D:\EDAWorkspace" | Out-Null
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-intranet.ps1 -WorkspaceRoot "D:\EDAWorkspace" -KicadDirectory "D:\KiCad\bin" -Profile desktop -McpPython "D:\EDA-Python-095\Scripts\python.exe"
```

`KicadDirectory` 指包含 python.exe 和 kicad-cli.exe 的 bin 目录。若 Harness 不在默认安装位置，添加 `-DshCommand "实际的dsh.cmd路径"`。已有安装请优先使用更新入口，以保留现有设置。

## 验证和演示

启动 Harness → 点击电路设计 → 新建显示板演示 → 逐步处理、查看资料、确认；不要导入旧 AD 工程。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-eda-flow.ps1 -Profile desktop
```

确认 installedVersion 与 runningVersion 均为 0.9.5-beta.1。解压 Harness-DisplayBoard-Live-Demo.zip，打开 demo.html，可查看本机实际演示的每一步输入、PDF 内容、图纸、BOM 和检查记录。

本次现场演示生成 41 行 BOM，ERC 0 错误、0 警告。发现 DS1 的原封装标识 UV 和 electrical 分类在模型整理阶段遗漏，自动核验未拦截；交付阶段没有确认。回放保留实际结果，便于测试复现。

本包根目录的 scripts 是本次安装入口；插件源码内部保留的旧版部署说明属于历史记录。
