# DSH 工程工作台 0.6.0

0.6.0 按 Megmeet DSH UI 规范统一独立窗口、图标入口、圆角和轻分隔。关闭窗口保留本次草稿，工程进度移入工作台。见 [独立窗口与保留配置的升级步骤](docs/window-0.6.md)。

六项独立任务：**读手册、产品方案、原理图评审、PCB 评审、原理图对比、向目标对齐**。支持 DSH 桌面 / Web 0.2.0-rc.2。工程师可只打开一块 PCB 进行评审，各任务有独立快照、范围、证据和持久化记录。

[六项任务分步演示](docs/independent-demo.md) · [验证与已知限制](docs/validation.md) · [公共接口](docs/contracts.md) · [AD 25/26 待验收记录](docs/AD-acceptance.md)

0.4.0 新增 [从原始资料复原](docs/restoration.md)：冻结输入、按位号读取全部原记录与引脚端点、独立核验、报告过期检查、空目录重放，以及规格书绑定和技术演示评审入口。实际转换仍由本轮 Harness 编写，不内置历史复原答案。完整 1:1 验收保持待确认，已知差异明确失败。

0.5.0 增加本机 Altium 文件直接提取与冻结入口，以及 Windows 内网试用安装包。见 [内网安装与试用](docs/intranet.md)。支持范围和待确认项随提取记录保存；不内置案例复原脚本。

## 本次修复

官网资料默认使用 dsh-megmeet 0.2.1 的麦格米特完整下载列表索引，不再预设演示资料库。读手册可检索官网 PDF，按需下载并保留来源；数据库 MCP 预留只读、分页的检索与读取接口，见 [资料源接口](docs/material-sources.md)。选择文件后点击“读取文件并继续”，进入预览及评审范围；后端版本不一致会给出明确提示。

0.3.3 按 UI UX Pro Max 的交互建议改进工作台：官网、本地 PDF 与已配置数据库直接可选；界面支持添加、编辑和移除数据库资料源，并展示真实连接状态。检索支持 Enter、前后分页与空结果引导；工程流程显示当前步骤、读取反馈和下一步。导航改为独立一行并适配窄窗口，补充深色主题、键盘焦点返回、文件筛选及减少动态效果支持。

0.3.4 支持整本 PDF 索引、全文搜索、章节跳转、自动分批通读、带引用的笔记与暂停续读。PDF 对比增加逐页图像识别与覆盖进度，未读取目标内容时阻止比较。产品型号索引移到下方并默认折叠；MCP 优先选择可识别的数据库，技术字段移到高级设置。模块拆分和读取边界见 [架构说明](docs/architecture.md)。

## 能力与边界

| 任务 | 当前能力 |
| --- | --- |
| 读手册 | 整本索引、全文搜索、章节跳转、自动通读/按问题阅读、暂停续读、带原文引用的笔记和参数草稿 |
| 产品方案 | 保留原插件真实需求、候选复核、工况校验与三种报告；按需安装产品方案插件 |
| 原理图评审 | KiCad 原生 ERC、AD 离线实际对象与网络、共用明确规则、固定上游版本的建议 |
| PCB 评审 | KiCad 原生 DRC / 未布线 / 可选原理图一致性；AD PcbDoc 离线板图和焊盘网络 |
| 原理图对比 | 原生工程、图片和 PDF 混合；器件对应、连接、已列功能指标与设计要求分别判断 |
| 向目标对齐 | 部分差异候选；真实对象属性、选择 / 框选、移动、旋转、增删件、导线 / 标注、撤销重做；验证、完整候选包及受控保存 / 回退 |
| 工程复原 | 原始证据快照、阶段输入、独立检查、重放记录与规格书绑定；目前适配 Altium 直接提取证据到 KiCad 的技术演示 |

资料管理与执行记录为公共入口。原有工具名、原 `dsh-schematic-sync` 包及历史同步任务保持兼容；旧界面说明在 [0.2 历史文档](docs/legacy-0.2.md)。

数值、封装、装配状态和校准后位置可按所选差异生成修改；连接及型号差异由图形编辑器明确处理。图片坐标先用两个已确认器件校准，不能直接当作毫米。图面不同不代表功能不同；缺少模型、参数或工况时不宣称整电路等价。

AD 离线使用固定版本 altium-monkey。**当前没有 AD 25/26 环境，软件内修改包执行和原生回执仍待接通验收，覆盖 AD 原工程禁用。** 离线候选重读不替代 AD 原生验证。

## 按需安装

工作台本身可独立执行 KiCad 评审、对比和对齐，不要求安装产品库、PCB 业务插件或同步插件。需要产品方案时安装 dsh-megmeet；需要旧业务工具时安装对应插件。一个可选模块缺失不影响其他入口。

```powershell
dsh plugin --profile desktop add ./dist/dsh-engineering-workbench-0.6.0.tgz --ignore-scripts
```

最小配置，写入实际 profile 的 cordis.patch.yml：

```yaml
- id: engineering-workbench
  config:
    workspaceRoot: D:/VisualBoard
    workDirectory: D:/VisualBoard/dsh-workbench-data
    kicadCli: D:/Kicad/bin/kicad-cli.exe
    kicadPython: D:/Kicad/bin/python.exe
```

PDF / 图片和 AD 离线能力需要工程工具环境。安装脚本固定源码提交与依赖版本，不把第三方代码混入自有 MIT 源码：

```powershell
powershell -File plugins/dsh-engineering-workbench/scripts/install-engines.ps1 -ToolsDirectory D:/VisualBoard/dsh-engineering-tools
```

再将脚本输出的两项加入上述 config：

```yaml
    engineeringPython: D:/VisualBoard/dsh-engineering-tools/.venv/Scripts/python.exe
    happyRoot: D:/VisualBoard/dsh-engineering-tools/kicad-happy
```

`currentSchematic`、`pcbPath` 只预填文件；每次任务重新建立自己的快照。旧产品方案与历史同步配置可保留，无须迁移。全部请求经过 DSH 现有认证，模型沿用当前 DSH 配置，无额外账号要求。

## 结果如何解释

- 原生 ERC/DRC、确定性公式 / 指定网络规则、上游扩展建议分别报告，保留引擎版本及原始输出。
- 去耦、上拉、电压域、分压 / RC、限流及功耗仅判断明确规则、输入和工况。手动计算输入需要自行对应工程，不能冒充自动提取值。
- 图片/PDF 覆盖始终保留不确定性；没有识别到导线不代表确定断线。两次模型提取一致不等于人工确认。
- 布局图中的点表示封装参考点。铜皮间隙、回流路径和制造规则不能由参考点距离代替。
- kicad-happy 固定提交见 pins.json；本项目已用样例发现并过滤其 DNP 去耦误报，保留原始报告和过滤原因。未经逐条验收的上游输出仍是建议。

## 保存保护

先在候选上编辑和验证，再显示实际对象、网络和图形变化。未知事项、未声明变化、重复层级歧义和原生错误会阻止覆盖。源文件、目标或候选改变后，旧结果和确认失效。

保存前在界面明确确认，并先关闭 EDA。系统保存备份及写入日志，按原生对象身份修改，支持多页候选包及回退。回退不覆盖后续人工修改。原理图变更不会自动同步 PCB。

## 开发与验证

```powershell
npm ci --ignore-scripts
npm run build
npm run check
npm test
```

原生测试默认使用开发机 KiCad / Python 路径，可通过 ENGINEERING_KICAD_CLI、ENGINEERING_PYTHON、ENGINEERING_HAPPY_ROOT 和样例环境变量替换；缺少原生工具的跳过结果不算通过验收。

`test/browser/independent-tasks.py` 驱动真实 DSH，验证独立安装、PCB 选择清理、前后图缩放、候选编辑和撤销重做。DSH_TEST_SERVER_LOG 或 DSH_TEST_URL 提供本地认证连接；不要提交或公开认证地址。

原生故障样例位于 examples/independent；评估输出位于 evals。10 份手册、30 条参数已有出处定位草稿，但**人工黄金集验收尚未完成，模型提取准确率未测量**。不得以引文存在率代替提取准确率。

## 依赖来源

[KiCad CLI](https://docs.kicad.org/10.0/en/cli/cli.html)、[kicad-happy](https://github.com/aklofas/kicad-happy)、[altium-monkey](https://github.com/wavenumber-eng/altium_monkey)、[AD 官方脚本接口](https://www.altium.com/documentation/altium-designer/scripting)。第三方依赖保留各自许可证；altium-monkey 与 PyMuPDF 的授权不由本插件 MIT 许可证替代。
