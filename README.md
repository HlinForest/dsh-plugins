# DSH Plugins

为 DeepSeek Harness 提供独立工程插件与可视化工作台，目标运行时为 **DSH 0.2.0-rc.2**，要求 **Node.js ≥ 22.19.0**。

| 插件 | 版本 | 用途 |
| --- | --- | --- |
| [dsh-megmeet](plugins/dsh-megmeet/README.md) | 0.2.0 | 需求解析、资料库检索、工况校验与可追溯报告 |
| [dsh-pcb-review](plugins/dsh-pcb-review/README.md) | 0.1.2 | Altium / KiCad 导出数据评审、器件检查清单与变更提醒 |
| [dsh-schematic-sync](plugins/dsh-schematic-sync/README.md) | 0.1.2 | KiCad 原理图目标对比、候选修改、验证与回退 |
| [dsh-kicad-workflow](plugins/dsh-kicad-workflow/README.md) | 0.1.1 | KiCad MCP 接入、设计与重建流程、检查及交付打包 |
| [dsh-eda-flow](plugins/dsh-eda-flow/README.md) | 0.3.3 | 三栏独立窗口、显示板完整输入、Harness 模型处理、人工确认、真实生成及重放 |
| [dsh-engineering-workbench](plugins/dsh-engineering-workbench/README.md) | 0.6.0 | 独立窗口与 Harness 风格 UI；保留读手册、产品方案、评审、比较、编辑、资料提取与复原流程 |

## 工程工作台 0.6.0：拉取后直接更新

[更新步骤与命令](docs/update-workbench-0.6.0.md) · [Release](https://github.com/HlinForest/dsh-plugins/releases/tag/workbench-v0.6.0) · [升级 ZIP](output/packages/Engineering_Workbench_0.6.0.zip) · [插件 TGZ](dist/dsh-engineering-workbench-0.6.0.tgz) · [验证记录](plugins/dsh-engineering-workbench/evals/ui-0.6.0.json)

工作台改为独立窗口，宿主仅保留图标入口；保留原业务导航与操作顺序，标题栏、圆角和分隔对齐 Harness。窗口关闭后保留草稿并暂停界面轮询，后台任务继续；重复点击恢复已有窗口。正式流程继续使用 Harness 当前模型与登录。

已有仓库，在仓库根目录执行以下命令。**工作目录必须替换为原工作台配置中的 workDirectory**，桌面版 profile 通常为 `desktop`：

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-workbench.ps1 -WorkDirectory "D:\原工作台数据目录" -Profile desktop
```

首次拉取使用 `git clone --depth 1 https://github.com/HlinForest/dsh-plugins.git`，再 `cd dsh-plugins` 执行更新命令。本次仓库包含安装包及约 158 MB 的运行时分卷，脚本自动校验、合并并安装，**不需要从 Release 补下载 0.6.0 的窗口运行时**。分卷是普通 Git 文件，不依赖 Git LFS。

升级自动备份旧插件和配置，保留原项目、模型与登录设置；使用带哈希的新包路径避开旧缓存。安装后重新加载插件或在方便时重启 Harness，在工作台“执行记录”核对 **0.6.0 / 32b84f0902abfb3f**。脚本不会强行关闭 Harness，也不调用模型。

本机验证：68 项 Node 测试通过，10 个页面在五种宽度下检查；独立窗口、缩放、全屏、失败重试及配置保留已检查。模型状态使用模拟响应，付费模型请求为零。

## 独立工程流程 dsh-eda-flow 0.3.3

0.3.3 核对页面与实际运行后台版本，确认返回不完整时读取已保存状态，并增加默认资料与待确认项入口。已有安装直接更新，无需填写原工作目录：

```powershell
git pull --ff-only origin main
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\update-eda-flow.ps1 -Profile desktop
```

[0.3.3 Release 与升级包](https://github.com/HlinForest/dsh-plugins/releases/tag/eda-flow-v0.3.3) · [更新说明](docs/update-eda-flow-0.3.3.md) · [0.3.3 插件 TGZ](dist/dsh-eda-flow-0.3.3.tgz)。更新保留项目、窗口运行时、模型和登录配置。**安装更新不等于旧窗口已加载新版**：在方便时正常退出并重开 Harness，页面左下角的“电路设计”和“运行后台”均应为 0.3.3。只读检查：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\check-eda-flow.ps1 -Profile desktop
```

0.3.3 的验证记录见 [确认与输入入口测试](plugins/dsh-eda-flow/evals/validation-0.3.3.json)。真实模型生成质量留到内网验证，本机仅使用模拟模型。此前 [0.3.2 验证记录](plugins/dsh-eda-flow/evals/validation-0.3.2.json)保留显示板七步 KiCad 生成、28 类内容比较和空目录重放结果。

[首次安装完整离线包 0.3.1](https://github.com/HlinForest/dsh-plugins/releases/tag/eda-flow-v0.3.1) · [插件安装包](dist/dsh-eda-flow-0.3.1.tgz) · [安装说明](plugins/dsh-eda-flow/docs/intranet.md) · [UI skills](skills/megmeet-dsh-plugin-skills/SKILL.md) · [UI Spec](skills/megmeet-dsh-plugin-skills/references/ui-spec.md) · [验证记录](plugins/dsh-eda-flow/evals/validation-0.3.1.json)

新建设计和显示板示例使用同一套七步流程，无需工程工作台。第一步可由工程师直接确认；后续生成使用 Harness 当前模型，再由工具生成原理图、BOM、PCB 和预览。规格书按页读取并绑定器件；默认输入可查看，阶段确认后再进入下游。

从宿主图标进入三栏独立窗口，保持聊天可用。标题栏为 40px，与顶栏同色，圆角及分隔对齐 Harness；重复打开、执行和重试不会新增项目。正式安装使用真实模型，本机测试使用模拟响应。

已有仓库执行 `git pull --ff-only` 获取源码、插件 TGZ 及 UI skills。`git clone` 不会下载 Release 附件：首次内网安装电路设计 0.3.1 时，可另外下载上述 Release 的 `EDA_Flow_Intranet_0.3.1.zip`，其中包含对应的 Electron 窗口运行时、Python 离线依赖和 UI skills，完整包的安装器会自动部署。上方 0.6.0 自动更新命令仅针对工程工作台，不会更新或替换电路设计插件。

0.3.1 的 14 项 Node 测试及图标交互模拟检查通过；独立窗口、系统按钮、聊天共存及 UI skills 有单独验证记录。此前的真实 KiCad 两个空目录重放和 28 类工程内容比较作为历史工程验证保留；本次 UI 发布没有重跑生成链。真实模型生成质量留到内网验收，本机没有付费模型请求。

工程保留源设计的背面布线和两个铜层设置；生产铜层数与通孔金属化单独待确认。正面阅读预览已增强，实际线宽不变。完整安装包带默认数据和离线依赖，无需历史成品。

## 历史工程复原内网试用版 0.5.0

[完整内网安装包（约 20.6 MB）](output/packages/Engineering_Workbench_Intranet_0.5.0.zip) · [安装与试用说明](plugins/dsh-engineering-workbench/docs/intranet.md) · [SHA-256](output/packages/Engineering_Workbench_Intranet_0.5.0.sha256.txt) · [检查范围与限制](plugins/dsh-engineering-workbench/evals/intranet-0.5.0.json)

已有仓库可执行 `git pull --ff-only`。将完整 ZIP 复制到内网并解压，按说明配置本机路径；安装后打开 **工程工作台 → 工程复原 → 直接读取本机原始文件**。插件内置 Node 运行依赖，ZIP 另带 Windows x64 Python 依赖轮子、安装器及环境检查脚本；Harness 和 KiCad 需预先安装。

当前直接提取支持单页、无层级的 Altium 原理图和一块 PCB，可读取本机 PDF 并绑定器件资料。转换由当前 Harness 模型执行，插件负责资料、独立核验和重放。完整 1:1 与公司正式签核仍需逐项验收，已知差异不会被标成通过。本包不包含账号、原始工程或历史复原答案，模型连接沿用本机 Harness 设置。

工作台源码开发所需的 `dsh-megmeet-0.2.1.tgz` 也在 `dist/` 中，供锁文件安装和回归测试使用；该模块源码的其他改动不在本次发布范围。

2026-10-13 发布前已在独立目录重新安装依赖并完成构建：工作台 65 项 Node 测试、23 项 Python 测试全部通过，安装包与源码及文件哈希一致。

## 工程能力与历史验证

工程工作台按任务独立使用。KiCad 原生 ERC/DRC、两图比较、实际对象编辑、多页候选包及保存回退已实现并测试；AD 支持离线工程读取与候选编辑。**AD 25/26 软件内修改及原生回执仍待接入验收，覆盖 AD 原工程禁用。10 份手册的人工黄金集验收也未完成。**

[六项独立任务分步演示](plugins/dsh-engineering-workbench/docs/independent-demo.md)包含小工程、点击顺序、预期结果和回退方法；[验证与待验收项](plugins/dsh-engineering-workbench/docs/validation.md)列出实际覆盖。旧版演示材料仍保留，使用新版请优先看六项任务文档。

## 安装

克隆本公开仓库后，在仓库根目录按需安装 `dist/` 中的包。`web` 替换为实际使用的 DSH profile。已有工程工作台请优先使用上方的更新脚本，以保留配置并部署独立窗口运行时。

```powershell
git clone https://github.com/HlinForest/dsh-plugins.git
cd dsh-plugins
dsh plugin --profile web add ./dist/dsh-megmeet-0.2.0.tgz
dsh plugin --profile web add ./dist/dsh-pcb-review-0.1.2.tgz
dsh plugin --profile web add ./dist/dsh-schematic-sync-0.1.2.tgz
dsh plugin --profile web add ./dist/dsh-kicad-workflow-0.1.1.tgz
dsh plugin --profile web add ./dist/dsh-engineering-workbench-0.6.0.tgz
```

按各插件 README 设置目录、KiCad CLI / Python / MCP Server 等本机配置，然后重新加载对应 profile。源码 README 保留了原开发机的路径示例；换机器或移动目录后需要调整。插件没有另设模型登录入口。

## 源码开发与打包

各插件分别管理依赖和锁文件。在对应目录安装、测试与打包，例如：

```powershell
cd plugins/dsh-megmeet
npm ci --ignore-scripts
npm test
npm pack --pack-destination ../../dist
```

`dsh-megmeet` 的测试命令会先编译 TypeScript；生成的 `lib/` 不纳入源码版本控制，但已包含在安装包中。其他插件使用 JavaScript 源码。`npm pack` 会执行各自的 `prepack` 检查。

`verify:live`、桌面安装和模型对比演示依赖本机 DSH / KiCad 环境；普通单元与运行时测试不代替这些实际联调。

### 2026-10-10 历史版本验证

2026-10-10 在 Windows、Node.js 24.19.0、npm 11.17.0 环境完成检查：

| 插件 | 通过 | 失败 / 跳过 |
| --- | --- | --- |
| dsh-megmeet | 42 | 0 / 0 |
| dsh-pcb-review | 21 | 0 / 0 |
| dsh-schematic-sync | 22 | 0 / 0 |
| dsh-kicad-workflow | 15 | 0 / 0 |
| dsh-engineering-workbench | 38 | 0 / 0 |
| 合计 | 138 | 0 / 0 |

`dist/` 安装包从通过检查的源码生成，SHA256 见 [dist/SHA256SUMS.txt](dist/SHA256SUMS.txt)。旧版压缩包保留供回退，安装时使用上表对应的新版本。

此前 0.2 系列工作台在实际 DSH 0.2.0-rc.2 原生 Web 界面完成 24 个业务动作联调：真实 48V 客户需求解析、检索、复核、报告三格式导出及 HTML 筛选/资料链接；工程导出、器件网络、检查清单、输入快照、监听启停；文字、原生 KiCad 和 PDF 目标、多项修改、前后图、ERC、确认写回和回退。另检查草稿保留、过期结果失效、浮动面板和窄屏显示。浏览器无页面异常。

写回与回退只在独立测试工程执行，回退后文件逐字节一致，原工程 SHA256 未变。此前四个业务插件共有 30 个原生工具，新版工作台另提供独立 engineering_task 工具，另可接入 KiCad MCP；注册数量不代表每个硬件操作均已实测。自动视觉识别现在接入 DSH 当前默认图片模型，沿用登录；也支持显式配置独立视觉接口。纯文字模型、配置不完整或识别失败会显示原因，未知项继续阻止写回。已用实际 JPEG 在本机 DSH 登录下完成图片识别和工作台草稿回填；识别值仍需逐条人工核对，模型不会代替用户勾选确认。

工作台 0.2.2 修复 SVG 焦点外框随坐标缩放造成的器件放大，以及空白点击和异步旧查询造成的残留选择。原生浏览器回归覆盖 100% / 200% 缩放、键盘、取消选择和乱序查询。原理图增加实际修改清单、导线 / 标注高亮、两侧分别定位、同步缩放 / 拖动、全屏与目标原件对照；已在实际 DSH 中验证。

## 三个插件的独立演示

[15 页分步演示手册](output/pdf/DSH三个插件独立演示手册.pdf)包含实测截图、点击顺序、预期结果、现场讲解参考和复位方法。三个案例可以分别开始：真实需求选型、四器件 PCB 评审、独立原理图改值及回退。

[完整演示材料包](output/packages/DSH三个插件独立演示材料包.zip)包含手册、输入文本、KiCad 小工程、预制修正版、插件安装包、选型资料原件和启动入口。解压后阅读“开始这里.txt”，双击“打开演示工作台.cmd”即可使用独立 DSH 演示配置。需要本机已安装兼容的 DSH、KiCad 和 Python；当前开发机已准备完成。

可编辑材料和复现脚本位于 [demos/independent](demos/independent)。实跑结果：提高负载和温度后保留 4 个满足已列条件的候选；PCB 由 1 项需处理变为 2 项局部检查符合；原理图两处改值后目标差异为 0、ERC 为 0 错误及 0 警告，回退恢复文件逐字节一致。小板尚未布线，用于教学展示，不作为生产设计。

## 收录范围

本仓库于 2026-10-10 从本地四个插件项目整理，并新增原生工程工作台。保留源码、测试、依赖锁文件、配置示例、脚本、许可证，以及资料库演示使用的公开资料、快照、静态演示页和报告。

本机依赖、登录/profile 文件、原始会话与运行记录、临时工作目录、权限恢复备份和历史压缩包不收录。演示文档中的 `records/`、`runs/`、`verification/` 等历史证据路径属于原本地交付目录；需要这些记录的实验汇总或页面重建步骤，应先在自己的环境重新生成。演示页中的旧绝对路径也可能需要调整。

`dsh-megmeet/success-demo/materials/` 和 `snapshots/` 是真实资料校验测试的输入，必须一起保留。打包的插件只包含各自 `package.json` 声明的运行文件；使用真实资料库时，将所需资料保留在本机，并通过管理员配置指定资料库路径。

## 许可证

各插件源代码沿用各目录中的 MIT 许可证。演示中的厂家 PDF、网页摘录与其他第三方资料保留原来源和权利归属，不适用插件代码的 MIT 授权。
