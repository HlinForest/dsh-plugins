# 工程工作台 0.6.0 更新说明

适用于已经安装工程工作台的 Windows x64 电脑。工程工作台 `dsh-engineering-workbench 0.6.0` 和电路设计 `dsh-eda-flow 0.3.1` 是两个插件，本次仅更新工程工作台。

## 1. 取得文件

首次拉取，在准备存放仓库的位置打开 PowerShell：

```powershell
git clone --depth 1 https://github.com/HlinForest/dsh-plugins.git
cd dsh-plugins
```

已经有仓库，在原仓库目录执行：

```powershell
git pull --ff-only origin main
```

如果有自己的未提交修改，先保存到自己的提交或暂存区，再拉取；不要用强制重置覆盖本地改动。

本次仓库包含插件 TGZ、升级 ZIP、更新脚本及 Windows 独立窗口运行时的四个分卷（约 158 MB）。分卷是普通 Git 文件，不需要 Git LFS，不需要再从 Release 下载运行时。安装脚本会校验并自动合并；已有完整运行时则直接沿用。

`git clone` 不会下载 GitHub Release 附件。电路设计 0.3.1 的源码、TGZ 和 UI skills 已在仓库中，但其包含 Python 离线依赖的完整 ZIP 仍是 [Release 附件](https://github.com/HlinForest/dsh-plugins/releases/tag/eda-flow-v0.3.1)。不要把“拉取源码”当成已经安装插件。

## 2. 使用原工作目录更新

在 Harness 的工程工作台插件设置中查看 **workDirectory**，复制原来的值；也确认正在使用的 profile（桌面版通常为 `desktop`）。不要新建工作目录来代替原值。

在仓库根目录执行，替换下方路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-workbench.ps1 -WorkDirectory "D:\原工作台数据目录" -Profile desktop
```

脚本会：

1. 校验 0.6.0 安装包；缺少独立窗口运行时时合并、校验并安装随仓库提供的运行时。
2. 在原工作目录创建 `upgrade-backup-时间-编号`，备份旧插件、profile 清单、锁文件和覆盖配置。
3. 使用带 SHA-256 的新安装路径更新，避免同路径安装包缓存导致继续使用旧版。
4. 恢复原 `cordis.patch.yml`，保留原项目路径、模型与登录配置，写入 `installation.json`。

脚本不删除项目、不调用模型，也不会关闭正在使用的 Harness。默认通过既有 pnpm 缓存离线安装；若缺少依赖，可使用公司允许的内网 npm 源：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-workbench.ps1 -WorkDirectory "D:\原工作台数据目录" -Profile desktop -Registry "https://你的内网npm源"
```

非默认安装位置可增加 `-DshCommand "D:\实际位置\dsh.cmd"`；非默认配置根目录可增加 `-DshHomePath "D:\实际DSH配置目录"`。这些参数均不会改写模型配置。

本脚本用于已有安装升级。首次安装请按[插件安装说明](../plugins/dsh-engineering-workbench/docs/intranet.md)配置工作目录及 KiCad/Python；本次 UI 更新沿用原有工程工具环境。

## 3. 确认安装与生效

安装结束后，应打印：`Installed 0.6.0 / 32b84f0902abfb3f`。

默认 profile 的磁盘版本可检查：

```powershell
(Get-Content -LiteralPath "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-engineering-workbench\package.json" -Raw | ConvertFrom-Json).version
Get-Content -LiteralPath "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-engineering-workbench\src\build.json"
```

然后在 Harness 中重新加载工程工作台插件；若不能重新加载，保存正在进行的操作，在方便时正常退出并重新打开 Harness。**磁盘安装完成不等于正在运行的旧后端已更新。** 重新打开工程工作台，在“执行记录”末尾核对 **0.6.0 / 32b84f0902abfb3f**。

若仍是旧版，依次核对：执行命令的仓库是否已拉到最新、目标 profile 是否正确、上面的磁盘版本是否正确、Harness 后端是否已重新加载。不要反复创建新项目或删除 profile。

## 4. 不使用 Git 的下载方式

在 [0.6.0 Release](https://github.com/HlinForest/dsh-plugins/releases/tag/workbench-v0.6.0) 下载：

- `Engineering_Workbench_0.6.0.zip`：插件、升级脚本、说明和本机验证截图。
- `Engineering_Workbench_Runtime_win32_x64.zip`：独立窗口运行时，原电脑未安装工作台独立运行时时需要。
- `SHA256SUMS.txt`：上述文件及 TGZ 的校验值。

两个 ZIP 分别解压后，按照升级 ZIP 内的“开始使用.md”执行。完整运行时 ZIP 与 Git 分卷合并所得 ZIP 的 SHA-256 相同。

## 5. 回退

备份位于原工作目录的 `upgrade-backup-*`。先正常退出 Harness，使用备份 `package.json` 中指向的旧 TGZ 重新安装，再恢复备份的 `cordis.patch.yml`；具体命令见[窗口及升级说明](../plugins/dsh-engineering-workbench/docs/window-0.6.md)。不要删除或替换原工程数据目录。
