# dsh-kicad-workflow

将 **KiCad MCP 工程操作 + 保留未知项的照片复刻流程 + 原生检查与交付导出** 接入 DeepSeek Harness。目标运行时为本机安装的 **DSH 0.2.0-rc.2、KiCad 10.0.6、KiCAD-MCP-Server 2.7.0**。

插件调用真实 KiCad，复用 Harness 的模型和工具权限管线。无需单独模型 API Key，不修改 Harness 核心，不自动下载或替换 KiCad/MCP Server。默认 SWIG 文件模式；IPC 必须以 `get_backend_state` 的实际结果为准。

## 安装

发行包包含 `dsh-kicad-workflow-0.1.1.tgz`、源码、配置示例和安装脚本。当前机器的实际路径已填入 `examples/local.config.json`，换机需调整这些绝对路径。

```powershell
& 'D:\VisualBoard\dsh-kicad-workflow\scripts\install.ps1'
```

默认装入 `desktop` profile。指定其他 profile：

```powershell
.\scripts\install.ps1 -Profile web -ConfigFile 'D:\config\kicad.json'
```

脚本通过 DSH 官方 `plugin add` 安装 tarball，再添加本插件配置块；保留原有插件和配置，修改前备份到本目录 `.verification/install-backup-*`。不会强制重启或中断现有聊天。安装后重新打开/重载对应 Harness profile。

手动安装：

```powershell
dsh plugin --profile desktop add .\dsh-kicad-workflow-0.1.1.tgz --ignore-scripts
```

再在该 profile 的 `cordis.patch.yml` 设置 `id: kicad-workflow` 的完整 config（见示例）。只有安装、没有配置时，六个工作流工具仍可查看，但不会连接 MCP。

卸载使用 `dsh plugin --profile desktop remove dsh-kicad-workflow`，并删除 profile patch 中 `# BEGIN DSH_KICAD_WORKFLOW` 至 `# END DSH_KICAD_WORKFLOW` 的本插件配置块。工程文件和 KiCad 安装保持保留。

## 能力

DSH 官方 `@deepseek-ai/dsh-mcp-client` 负责协议与工具注册。本机 MCP 实测注册 **233 个** `mcp__kicad__*` 工具，包括新建/打开工程、符号与封装操作、布局布线、保存读回、ERC/DRC 和格式导出。实际工具集取决于配置的服务器版本。

插件另外提供六个原生工具：

| 工具 | 用途 |
| --- | --- |
| `kicad_workflow_capabilities` | 配置状态、MCP 工具数量、能力和边界；不伪造后端连接状态 |
| `kicad_workflow_begin` | 新建独立工作目录；仅显式指定 `baselineProject` 时复制旧工程 |
| `kicad_workflow_status` | 源文件 revision、复用来源、未知项、检查报告是否过期 |
| `kicad_workflow_record_unknown` | 追加未知连接、器件或尺寸记录；保留 unresolved 状态 |
| `kicad_workflow_checkpoint` | 原生 CLI ERC、DRC、原理图/PCB 一致性、网表及哈希记录 |
| `kicad_workflow_deliver` | 核对 revision，重新检查，导出完整参考工程与校验 ZIP |

`begin` 不会偷偷选取此前的工程。复制时记录来源、文件列表和 SHA256，保留本地符号库、封装库、模型、reference、面贴 artwork，以及已有连接证据。继承旧工作流的未知项。原板资料中的 `%TSD-Header-` 包装文件标记为不可直接作为文本使用。

工具中的资料路径限制在管理员指定的 `workspaceRoot` 内。输入源文件单个最多 64 MiB，工程依赖最多 5000 个文件/512 MiB。自定义的其他依赖目录、外部绝对模型路径、KiCad 全局库需另外移入工作副本并核对；插件不声称已解决所有外部依赖。

`record_unknown` 是追加记录工具，不提供“模型一键确认全部未知项”。实测确认后由工程师在修订副本中更新记录和连接，再重新检查。不能通过删除未知项、添加无依据的 NC 或屏蔽规则制造通过结果。

## 在 Harness 中使用

先做连接检查：

> 调用 kicad_workflow_capabilities 和 mcp__kicad__get_backend_state，报告真实工具数量和 SWIG/IPC 状态。

从零设计：

> 使用 KiCad 工作流，新建一个 30×20 mm 的低压 LED 指示板。mode=design，不指定 baselineProject。先明确器件与引脚依据，然后实际用 MCP 创建、绘制、保存并读回；完成后运行 checkpoint 并导出参考交付包。

继续本次照片复刻：

> 使用 kicad_workflow_begin，name=MD50PG_next，mode=replica，baselineProject=D:/VisualBoard/MD50PG_Replica_P3/MD50PG_Replica_P3.kicad_pro。明确说明这是复用 P3 的新副本。保留原器件和焊盘几何；被遮挡连接继续待核实。用 MCP 打开副本操作，保存读回后关闭 MCP 工程，运行 checkpoint。只导出 B.Cu、B.Mask、B.SilkS、F.SilkS、Edge.Cuts。

提供新照片时，使用 Harness 现有附件/视觉能力解读，`sourcePaths` 可保存输入副本。**插件自身不包含 OCR、隐藏走线识别或自动完成电路推理的模型。** 这些判断由宿主模型和人工测量提供。之前 P3 的专用生成脚本没有被硬编码成适用于所有板子的通用生成器。

## 交付文件与真实含义

交付目录包含原生 `.kicad_pro/.kicad_sch/.kicad_pcb`、所复制的本地依赖、原理图/PCB PDF、BOM、位号 CSV、Gerber、钻孔及孔图、VRML、ERC/DRC、网表、命令执行证据、未知项和 SHA256 清单。ZIP 使用 Python 标准库打包，并逐成员验证 CRC 与 SHA256。

导出前必须保存并读回 MCP 的编辑，关闭该 MCP 工程，确保 GUI 也没有未保存的修改。检查基于磁盘文件；输入在检查/导出期间改变会拒绝最终交付。每次生成新目录，不覆盖此前报告和 ZIP。

报告分别列出 ERC、几何 DRC、未布线、原理图/PCB 一致性和报告中已有排除项。规则本身是否完整仍需审查。即使这些计数为零，也只代表相应静态检查结果。v0.1.1 的制造文件固定放在 `manufacturing_REFERENCE_ONLY`，`productionRelease=false`，不自动批准打样或下单。PDF 与 3D 还需视觉核对，电气/机械仍需实测。

## 运行与权限边界

- 所有模型调用使用 DSH 工具注册表和原有权限管线；不创建新的登录/模型服务。
- MCP Server 作为本机进程运行。`workspaceRoot` 只约束本插件六个文件工作流工具，**不会沙箱化原生 MCP 工具或 KiCad 的外部文件引用**。面向可信单用户桌面；多租户部署需要隔离进程、目录和账号。
- 同一实例只有一个活动 PCB。调用串行执行，打开/新建后由当前聊天持有，成功 `close_project` 后才允许其他聊天接管。插件重新加载会关闭它启动的 MCP 进程；先保存未落盘的更改。
- `scripts/mcp-launcher.mjs` 立即转发握手和工具发现，但等待上游 `KiCAD MCP SERVER READY` 后再转发实际工具调用，解决“工具已列出、Python 后端尚未启动”的竞态。180 秒仍未就绪会失败，不返回假成功。
- SWIG 是默认值，适合批处理。不要与 GUI 同时保存同一板子。IPC 需另行启用并实测；没有连接时不要宣称实时同步。
- 本包只配置本地 stdio。rc.2 官方 MCP peer 使用的 SDK 2.0.0 有上游 OAuth 安全通告；该 HTTP/OAuth 路径不在本插件使用范围，本包没有改动 Harness 的共享依赖。生产直接依赖审计为零；全依赖审计仍会报告该 peer 开发树风险。

## 开发与验证

```powershell
npm ci --ignore-scripts
npm test
$env:KICAD_TEST_BASELINE = 'D:\VisualBoard\MD50PG_Replica_P3\MD50PG_Replica_P3.kicad_pro'
npm run verify:live
npm pack
```

自动测试使用真实 rc.2 `ToolRuntime`，覆盖加载/卸载、参数校验、取消、复用记录、越界与 junction、失败报告、旧 revision、跨聊天占用及启动就绪。真实集成测试通过 Harness 工具管线调用 MCP 创建测试板、保存并重新打开，另用 pcbnew 校验板框中心线尺寸；再对 P3 的独立副本检查和导出 ZIP。

测试不调用模型 API，所以不宣称已经做过 DeepSeek 模型的端到端自主设计验收。工具联通、原生工程读写和导出均为实测。

上游 `get_board_info` 的外接矩形包含 Edge.Cuts 线宽；30×20 mm 中心线板框可能返回 30.1×20.1 mm，测试同时保留此原始输出和独立中心线测量。

来源：[DSH 官方插件打包](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)、[DSH 官方 MCP 客户端](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/mcp/mcp-client)、[KiCAD-MCP-Server](https://github.com/mixelpixx/KiCAD-MCP-Server)。兼容依据为本机锁定版本的实际代码和测试，不自动追随 master。
