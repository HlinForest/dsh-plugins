# 0.11.3-beta.1 内网部署与使用

本文描述当前插件包的部署方式。部署方需要准备一份 `dsh-eda-flow-0.11.3-beta.1.tgz`、Harness CLI 的 `dsh.cmd`、一个已初始化的 Harness profile、KiCad CLI/Python 和可写的工程工作区。插件包不包含 Harness、KiCad、模型登录、外部 PDF 或桌面 Electron 运行时。

显示板与空白项目共用通用七步文字流程。显示板预填页面中可见的普通文字输入和步骤补充；没有内置规格书、提取记录、原理图、PCB 或固定器件库。本轮演示分别上传 TM1616、LED 显示模块、IRM-3638M3-X 和 6Pin 连接器的四份外置 PDF。内网测试在相同入口上传对应型号的厂家原始规格书；文件名和数量没有限定。文件保存在插件目录之外，创建项目后通过第二步的“添加 PDF / DOCX 资料”上传，在第三步绑定型号或位号并核对来源页码。其他普通器件按文字约束和通用库选型。

## 安装前检查

1. 关闭正在运行的电路设计窗口，保留现有 Harness profile 和项目数据。
2. 在 Harness 中选择内网允许使用的模型；插件沿用该选择，不另存密钥。
3. 确认 `WorkspaceRoot` 已存在，`KicadDirectory` 中有 `python.exe` 和 `kicad-cli.exe`。
4. 准备 supplied TGZ 和 DSH CLI 的实际路径。安装器不会从插件目录猜测包文件，也不会寻找旧版固定包名。

## 使用当前安装器

从完整交付 ZIP 解压后的根目录运行。若从插件源码目录运行，将下面的 `install` 目录改为 `scripts`：

```powershell
powershell -ExecutionPolicy Bypass -File .\install\install-intranet.ps1 `
  -SuppliedPackage 'E:\drop\dsh-eda-flow-0.11.3-beta.1.tgz' `
  -DshPath 'C:\Users\Public\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' `
  -Profile desktop `
  -WorkspaceRoot 'D:\EDA' `
  -KicadDirectory 'D:\KiCad\bin'
```

参数说明：

- `SuppliedPackage`：部署方实际提供的 `.tgz` 文件，可以位于插件目录之外。
- `DshPath`：要使用的 Harness DSH CLI 文件路径。
- `Profile`：目标 Harness profile，默认是 `desktop`；安装器要求该 profile 已初始化。
- `WorkspaceRoot`：项目工作区根目录。
- `KicadDirectory`：包含 KiCad CLI/Python 的目录。
- `WorkDirectory`：可选，默认是 `WorkspaceRoot\eda-flow`。
- `DshHomePath`：可选，默认是当前用户的 `.dsh` 目录。
- `DesktopRuntimeSource`：可选，指向已获准的 Electron 解压目录；详见 [桌面窗口说明](desktop-window.md)。
- `Registry`：可选，只有明确允许使用内网 npm 源时才传入；省略时使用已有本地 pnpm store 和 `--offline`。

安装器会：

- 校验 supplied TGZ、DSH CLI 和 KiCad 可执行文件的本地路径；
- 把 TGZ 按 SHA-256 缓存在 `WorkDirectory\plugin-cache`，重复运行会复用相同文件；
- 备份 profile 的 package、patch 和 lock 文件；
- 通过 Harness CLI 安装 supplied TGZ，并只更新带 `eda-flow-intranet managed config` 标记的配置段；
- 写入 `workspaceRoot`、`workDirectory`、`kicadCli`、`kicadPython` 和 `allowModelCalls`；
- 在工作目录保存备份、安装记录和本地 profile 验证日志。

它不会复制登录信息、打印配置内容、发起模型请求或默认联网。配置验证失败时会恢复原 patch；保留备份目录，便于人工恢复。安装完成后重启 Harness，并确认页面左下角的页面版本和后台版本都为 `0.11.3-beta.1`。

## 环境检查与试用

安装前可运行只读环境检查；它只验证工作区、KiCad、Python 依赖和本地 PDF 读取器，不连接模型：

```powershell
powershell -ExecutionPolicy Bypass -File .\install\check-environment.ps1 `
  -WorkspaceRoot 'D:\EDA' `
  -KicadDirectory 'D:\KiCad\bin'
```

安装后从 Harness 的电路设计入口打开窗口，新建“空白项目”或“显示板”。显示板中的普通输入和每一步补充说明应当直接显示并可编辑；未上传外部 PDF 时，第二、三步应显示待上传状态。上传资料后，核对文件名、状态、正文字符数、绑定对象和来源页码，再进行模型处理。

试用记录位于 `WorkDirectory\projects\<项目ID>`，具体步骤、模型请求、工具执行和生成文件以页面的操作记录及交付下载为准。真实模型能力、KiCad 输出和外部 PDF 事实仍需内网工程师验收；本地安装脚本本身不代表模型或量产验证已通过。
