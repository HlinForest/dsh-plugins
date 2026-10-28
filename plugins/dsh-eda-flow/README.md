# EDA Flow 0.16.3-beta.17

PCB 的装配面、布线层、零欧跨线、铜区和供电器件距离现为可见输入。详见 [工艺与供电布局流程](docs/pcb-process-workflow.md)。

这是一个面向 DeepSeek Harness 的通用文字驱动 EDA 插件。空白项目和显示板共用同一套七步流程：工程师在页面中看到每一步的实际输入，输入预先显示且可编辑，保存后才会进入本步处理。阶段补充说明、来源事实和应用指导也始终显示在对应步骤中，便于检查、修改和追溯。

显示板是一个通用流程入口。它只预填普通文字输入和各步骤的公开补充说明；这些内容和空白项目一样可见、可编辑。项目创建时不附带规格书正文、提取记录、固定器件库、完整逐线网表或固定坐标，关键资料由工程师在页面外部上传并在阶段 2、3 确认。模型根据任务、来源事实、已确认器件和布局约束合成原理图与排布，历史项目仍可以查看其已有结果。

## 当前流程

原理图到 PCB 的封装资料要求、逐焊盘核对和运行边界见 [PCB 使用流程](docs/pcb-footprint-workflow.md)。第六步可独立上传封装测量资料，模型选择来源表，程序直接读取尺寸；整板位置仍自动生成。

新建项目提供以下入口：

- **空白项目**：从空白文字输入开始。
- **显示板**：使用可见、可编辑的显示板任务书和步骤补充说明开始，组件与空白项目相同；不预置完整网表或 11 个固定坐标。
- **导入固定器件清单**：仅在需要把已有器件清单作为明确输入时使用。

七步流程会记录任务书、供电、接口、装配、原理图约束、验收要求、规格书正文、来源事实、应用指导、阶段补充、模型执行记录和实际生成结果。阶段 2、3 的人工确认是后续设计输入；原理图、BOM、PCB、PDF、ERC/DRC 和交付记录以本次工程输出为准，静态检查通过仍需要工程师确认。未明确位置的器件按功能、引脚方向、连接拓扑、可布线性和板面空间自动排布，明确的机械或位置约束优先。

阶段 2、3 的资料入口支持工程师上传 PDF/DOCX 或直接粘贴正文。附件状态会显示为待上传、已上传或已读取；未读取的文件不会被页面或模型当作已提取事实。阶段 6 的板框、铜层、布线面、制造、孔金属化和 PCB 规则使用独立的可见输入字段。

## 显示板所需的外部资料

关键器件的规格事实由部署方单独提供 PDF，再通过页面上传。内网可以先用几个大器件各自的真实规格书；文件保存在插件目录之外，创建项目后在第二步选择“添加 PDF / DOCX 资料”，随后在第三步绑定型号或位号并核对来源页码。文字提取之外，可选 RapidOCR 可识别嵌入应用图中的文字，并在实际输入中显示页码、图像区域与待复核文字。它不识别接线拓扑，不自动把识别结果当成选型事实；详见 [PDF 图中文字提取](docs/pdf-figure-ocr.md)。未知参数仍保留为待确认。

插件包不内置、不自动附加、也不打包外部 PDF。没有上传时，界面明确显示待上传；任务书中提到的资料只说明需要什么来源，不替代实际 PDF 内容。其余普通器件可由文字约束和本机通用库完成选型，关键器件仍以上传资料中的型号、引脚和机械参数为准。

## 内网安装

安装需要 Windows、Node 22+、已初始化的 Harness profile、KiCad CLI/Python，以及一份由部署方提供的当前版本 TGZ。KiCad、Harness、模型登录和外部 PDF 都不包含在 TGZ 中。先关闭正在运行的电路设计窗口，并在 Harness 中选择允许使用的模型。

安装器接收实际提供的包文件、DSH CLI 路径和 profile；它不依赖包内固定版本或隐含 wrapper：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-intranet.ps1 `
  -SuppliedPackage 'E:\drop\dsh-eda-flow-0.16.3-beta.17.tgz' `
  -DshPath 'C:\Users\Public\AppData\Local\Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd' `
  -Profile desktop `
  -WorkspaceRoot 'D:\EDA' `
  -KicadDirectory 'D:\KiCad\bin'
```

`-WorkDirectory` 默认为 `WorkspaceRoot\eda-flow`，`-DshHomePath` 可指定 Harness 数据根目录，`-DesktopRuntimeSource` 可选地提供已获准的 Electron 解压目录。未显式传入 `-Registry` 时，安装器使用本地 pnpm store 和 `--offline`；安装器不会自行联网或调用模型。只有部署方明确提供 `-Registry` 时，才会使用指定的内网包源。

安装器先备份 profile 的 package、patch 和 lock 文件，再安装 supplied TGZ，并把本插件的 `workspaceRoot`、`workDirectory`、KiCad CLI/Python 路径写入带边界标记的配置段。失败时会恢复原 patch；备份目录和本地验证日志位于工作目录，日志不输出登录信息或模型密钥。完成后重启 Harness，在页面左下角确认页面与后台版本均为 `0.16.3-beta.17`。

如果只需要安装包，也可以使用 Harness 原有插件管理入口直接添加 supplied TGZ；不要把外部 PDF 复制进 TGZ 或插件源码目录。桌面窗口运行时的单独部署步骤见 [桌面窗口说明](docs/desktop-window.md)，当前内网安装流程见 [内网部署说明](docs/intranet.md)。

## 本地开发与验证

```powershell
npm install
npm run build:client
npm test
```

构建产物位于 `client/`。本地测试不需要调用付费模型；Harness 中的真实模型、KiCad 版本、Python 依赖和外部 PDF 仍需在目标内网环境单独核验。

## 范围与限制

- 模型由 Harness 当前 profile 选择和鉴权，插件不保存模型密钥。
- 外部 PDF 的内容、版权、版本和可读取性由部署方负责；扫描页或缺页会保留为待补事项。
- 通用流程会生成可编辑工程并记录实际检查结果，但不能替代工程师对电气、机械、制造和实物性能的批准。
- `docs/` 中带版本号的旧说明用于历史背景，不应作为当前 0.16.3-beta.17 的安装命令或输入约定。


当前局部供电和红外外围的布局机制见 [局部供电布局](docs/local-power-layout.md)。实际工程仍须逐项对照参考设计，ERC 不代表对齐完成。

当前阻容推导与说明更新：见 [联立阻容推导](docs/passive-solving.md)。该能力从现有工作条件求范围和必要器件修改；无法唯一确定的电容组合及阻值仍保留未定。


工程师可在“工程师评审”保存文字、采用意见、重新生成并逐条复核；左侧“环境与安装”检查依赖。详见 [评审与安装指南](docs/engineer-review-and-installation.md)。缺少KiCad时可先用安装脚本的 `-ReviewOnly` 模式；CAD生成仍需补齐本机工具。

路由引擎与联合摆放的使用范围、实验状态及验收边界见 [开源工具说明](docs/open-source-layout.md#pcb-routing-and-candidate-selection)。

单层板的断点与回流铜岛修复边界见 [局部修复说明](docs/native-local-repair.md)。
