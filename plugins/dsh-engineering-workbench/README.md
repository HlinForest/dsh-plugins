# DSH 工程工作台

为三个工程插件提供完整的原生操作入口，适配 DSH 桌面版和 Web `0.2.0-rc.2`。侧栏打开 **工程工作台**，右下角的可拖动面板显示真实任务步骤与耗时。

## 功能覆盖

| 工作区 | 已接入的插件能力 |
| --- | --- |
| 产品方案 | 资料库信息、真实需求解析、复杂条件补充、类别筛选、候选搜索、指定候选复核、方案生成、HTML / Markdown / JSON 导出 |
| PCB 评审 | 12 类器件检查清单、项目与逐脚网络查询、规则评审、外部快照评审、报告导出、监听状态、运行中开启/停止监听 |
| 原理图同步 | 能力说明、创建/恢复任务、原生图/图片/PDF/文字目标读取、带证据目标条目、图纸/对象查询、差异比较、候选修改、ERC 验证、确认写回、备份回退 |
| 执行记录 | 三个插件的工作台操作，以及聊天中的工程工具和 KiCad MCP 调用；耗时、步骤和错误如实显示 |

24 个业务动作均调用当前 DSH profile 中已安装的插件，沿用其实际资料库、工程规则、导出目录和验证限制。工作台另外提供工程文件选择、任务恢复、图纸预览及写回确认。

## 使用

### 真实需求选型

1. 在「产品方案」粘贴客户原文，或载入 TXT / Markdown。首次打开为空，可选示例不会自动填入。
2. 点击「解析需求」，核对条件、原文依据和待确认项。复杂条件可手动补充，但依据必须逐字来自原文。
3. 选择类别、展示数量及是否显示不满足项，然后检索候选。打开型号可查看逐项结果、原文证据和资料原件。
4. 指定要纳入方案的候选，再生成或导出报告。报告导出时重新校验资料版本；修改需求或筛选条件后旧结果失效。

支持插件中声明的全部参数，不限于负载和温度。没有给出的电压、裕量、安装方向等条件不会自动补入。未知资料保留为待确认。HTML 报告包含筛选交互，在 DSH 打开时原件链接经过受控文件接口；本地导出文件保留相对原件链接。

### PCB 与网络评审

「工程与网络」读取配置项目的导出快照，可按位号查询实际引脚网络并定位器件。「从已保存 KiCad 工程更新」重新导出网表、坐标与图纸，备份并更新评审项目清单，不修改原生原理图或 PCB。

另外提供器件检查清单、调用者输入的 JSON 快照评审、报告导出和变更监听。监听的是导出文件，两次稳定读取后提示问题变化；界面调整监听设置只影响当前运行会话，重启后恢复配置值。

### 原理图目标同步

1. 选择当前原理图，再选择原生目标图、图片/PDF、TXT/Markdown 或直接输入要求。
2. 原生图直接比较网表和绘图结构。文字/图像目标需要保存带证据的检查条目，覆盖元件属性、元件不存在、引脚连接和断开；未知事项阻止写回。
3. 查询候选图的位号、引脚网络和对象 UUID。可自动同步原生目标或明确的元件属性；增删件、连线、图形和符号库操作通过高级 JSON 编辑入口提交。
4. 验证目标差异和 ERC，查看前后图纸、候选 PDF 与验证记录。
5. 核对准确工程路径并确认已保存、关闭 KiCad 后才可写回。确认仅限本次任务与验证版本，两分钟过期、一次有效。插件再次检查原文件、候选与验证结果；写回前创建备份，回退拒绝覆盖后续人工修改。

图片/PDF 可直接渲染查看、逐页录入证据。点击「识别本页为条目草稿」会重新检查并使用 DSH 当前默认图片模型，沿用现有登录；如已配置独立视觉服务则优先使用它。识别期间显示进度，完成后显示条目数与待确认项并收起原图；失败会给出原因。核对草稿后保存，才能比较和修改候选。DSH 对话里得到的条目也可导入。

## 安装与配置

先安装 `dsh-megmeet@0.2.0`、`dsh-pcb-review@0.1.1`、`dsh-schematic-sync@0.1.1`；KiCad 工作流插件可一并使用。

```powershell
dsh plugin --profile desktop add ./dist/dsh-engineering-workbench-0.2.1.tgz --ignore-scripts
```

在实际 profile 的 `cordis.patch.yml` 中配置工作台。以下是开发机示例；其他机器需调整：

```yaml
- id: engineering-workbench
  config:
    catalogPath: D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.v2.json
    catalogV1Path: D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.v1.json
    projectFile: D:/VisualBoard/dsh-pcb-review/projects/displayboard/project.json
    currentSchematic: D:/VisualBoard/DisplayBoard.kicad_sch
    pcbPath: D:/VisualBoard/DisplayBoard.kicad_pcb
    workspaceRoot: D:/VisualBoard
    workDirectory: D:/VisualBoard/dsh-workbench-data
    syncWorkDirectory: D:/VisualBoard/dsh-schematic-sync/workspaces
    kicadCli: D:/Kicad/bin/kicad-cli.exe
```

`projectFile` 应与 PCB 插件相同；`syncWorkDirectory` 必须等于原理图插件的 `workDirectory`；两个插件的 `workspaceRoot` 应一致。原理图插件配置 `allowApply: true` 才能启用受控写回。实际选型使用原生 megmeet 插件的 `catalogPath`；工作台的两个 catalog 路径保留给兼容接口。

重新加载或重新打开 DSH 后生效。所有请求经过 DSH 原生认证连接，无需另设账号。

## 范围与数据

位置图表示封装参考点，不表示铜皮或焊盘；原生 PCB 预览来自 KiCad。多页原理图目前预览首张导出图，并显示页数。图片或文字目标只核对声明条目，不代表整张图纸完全等同。插件仍执行自身关于分层图纸、ERC、未知项和结构差异的限制。

工程文件选择器限于管理员配置目录。文件通过随机 ID 读取并检查哈希；导出报告的筛选脚本在隔离环境中运行。工作目录保存候选、快照与报告，只有经验证和确认的写回动作修改原图。最近执行记录保存在内存，重启清空；切换或收起工作台保留当前输入，重新加载 DSH 后可恢复原理图任务。

## 开发

在插件目录运行 `npm ci --ignore-scripts`、`npm run build`、`npm run check`、`npm test`。修改 `client/` 源文件；`client.js` 由构建脚本生成并随安装包发布。客户端使用 DSH 提供的 React 和 Slot 服务，无外部 CDN。

测试覆盖真实 DSH 工具运行时、需求透传、资料版本、报告原件链接、确认绑定、文件范围及错误记录。原生浏览器联调另外验证 24 个业务动作、真实 KiCad 导出、候选修改/验证/写回/逐字节回退、HTML 筛选和窄屏显示；写回检查使用独立测试工程。
