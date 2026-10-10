# DSH Plugins

为 DeepSeek Harness 开发的四个工程插件与一个可视化工作台，目标运行时为 **DSH 0.2.0-rc.2**，要求 **Node.js ≥ 22.19.0**。

| 插件 | 版本 | 用途 |
| --- | --- | --- |
| [dsh-megmeet](plugins/dsh-megmeet/README.md) | 0.2.0 | 需求解析、资料库检索、工况校验与可追溯报告 |
| [dsh-pcb-review](plugins/dsh-pcb-review/README.md) | 0.1.1 | Altium / KiCad 导出数据评审、器件检查清单与变更提醒 |
| [dsh-schematic-sync](plugins/dsh-schematic-sync/README.md) | 0.1.0 | KiCad 原理图目标对比、候选修改、验证与回退 |
| [dsh-kicad-workflow](plugins/dsh-kicad-workflow/README.md) | 0.1.1 | KiCad MCP 接入、设计与重建流程、检查及交付打包 |
| [dsh-engineering-workbench](plugins/dsh-engineering-workbench/README.md) | 0.2.0 | 三个插件完整操作入口、真实需求选型、工程评审、原理图写回与回退 |

## 安装

克隆本私有仓库后，在仓库根目录按需安装 `dist/` 中的包。`web` 替换为实际使用的 DSH profile。

```powershell
git clone https://github.com/HlinForest/dsh-plugins.git
cd dsh-plugins
dsh plugin --profile web add ./dist/dsh-megmeet-0.2.0.tgz
dsh plugin --profile web add ./dist/dsh-pcb-review-0.1.1.tgz
dsh plugin --profile web add ./dist/dsh-schematic-sync-0.1.0.tgz
dsh plugin --profile web add ./dist/dsh-kicad-workflow-0.1.1.tgz
dsh plugin --profile web add ./dist/dsh-engineering-workbench-0.2.0.tgz
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

### 本次上传验证

2026-10-10 在 Windows、Node.js 24.19.0、npm 11.17.0 环境完成检查：

| 插件 | 通过 | 失败 / 跳过 |
| --- | --- | --- |
| dsh-megmeet | 42 | 0 / 0 |
| dsh-pcb-review | 21 | 0 / 0 |
| dsh-schematic-sync | 15 | 0 / 0 |
| dsh-kicad-workflow | 15 | 0 / 0 |
| dsh-engineering-workbench | 14 | 0 / 0 |
| 合计 | 107 | 0 / 0 |

`dist/` 安装包从通过检查的源码生成，SHA256 见 [dist/SHA256SUMS.txt](dist/SHA256SUMS.txt)。旧版压缩包保留供回退，安装时使用上表对应的新版本。

新版工作台在实际 DSH 0.2.0-rc.2 原生 Web 界面完成 24 个业务动作联调：真实 48V 客户需求解析、检索、复核、报告三格式导出及 HTML 筛选/资料链接；工程导出、器件网络、检查清单、输入快照、监听启停；文字、原生 KiCad 和 PDF 目标、多项修改、前后图、ERC、确认写回和回退。另检查草稿保留、过期结果失效、浮动面板和窄屏显示。浏览器无页面异常。

写回与回退只在独立测试工程执行，回退后文件逐字节一致，原工程 SHA256 未变。当前插件共有 30 个原生工具，另可接入 KiCad MCP；注册数量不代表每个硬件操作均已实测。自动视觉识别需要另行配置原理图插件的视觉服务，未配置时仍可逐页查看原件并手动录入证据。

## 收录范围

本仓库于 2026-10-10 从本地四个插件项目整理，并新增原生工程工作台。保留源码、测试、依赖锁文件、配置示例、脚本、许可证，以及资料库演示使用的公开资料、快照、静态演示页和报告。

本机依赖、登录/profile 文件、原始会话与运行记录、临时工作目录、权限恢复备份和历史压缩包不收录。演示文档中的 `records/`、`runs/`、`verification/` 等历史证据路径属于原本地交付目录；需要这些记录的实验汇总或页面重建步骤，应先在自己的环境重新生成。演示页中的旧绝对路径也可能需要调整。

`dsh-megmeet/success-demo/materials/` 和 `snapshots/` 是真实资料校验测试的输入，必须一起保留。打包的插件只包含各自 `package.json` 声明的运行文件；使用真实资料库时，将所需资料保留在本机，并通过管理员配置指定资料库路径。

## 许可证

各插件源代码沿用各目录中的 MIT 许可证。演示中的厂家 PDF、网页摘录与其他第三方资料保留原来源和权利归属，不适用插件代码的 MIT 授权。
