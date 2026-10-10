# dsh-pcb-review

AD / KiCad 原理图与 PCB 评审助手，适配 **DeepSeek Harness 0.2.0-rc.2**。复用 DSH 的模型与会话，插件本身不需要额外模型 Key。

首版支持器件检查清单、导出网表规则检查、位号/网络/坐标定位、JSON/Markdown 报告，以及导出文件更新后的 Windows 桌面提醒。没有修改现有 dsh-megmeet 插件或原始电路设计。

## 能做什么

| 需求 | 本版能力 | 输入与边界 |
|---|---|---|
| 输入元器件，提示布局/走线/工艺/安规注意事项 | 12 类器件检查清单，列出应检查的位置 | 通用建议；不冒充已核实的具体型号 datasheet |
| 信号回到 MCU，检查有没有电容 | 按声明的目标引脚、信号类型、参考地和项目规则查直接网表连接；识别 DNP | 不把所有 MCU 输入都视为必须加电容；串联电阻/磁珠两侧不自动并网 |
| 电源去耦 | 检查指定电源引脚所在网络到参考地的已装电容 | 发现同网电容仅证明拓扑存在，不证明容值、回路或距离合理 |
| 器件是否靠近目标 | 比较声明的两个封装参考点与项目给出的距离限值 | 不等于焊盘间距、走线长度、爬电距离 |
| 安规预审 | 提示缺少工况，比较提供的实测间距与项目限值 | 不自动选择标准限值，不从 PCB 铜皮/板槽重建爬电路径 |
| 设计过程中提醒 | 监听导出快照，两次稳定后只提示新增/变化的问题 | Windows 弹窗显示在运行插件的主机；没有接入 AD/KiCad 原生编辑事件 |

`checked` 只表示**该项已配置的局部检查符合**。资料不足为 `unknown`，发现差异为 `warning`，不适用为 `not_applicable`。没有“整板通过”状态。

## 安装

Node.js >= 22.19.0。在你们实际使用的 DSH profile 安装插件包，例如：

```powershell
dsh plugin --profile web add './dist/dsh-pcb-review-0.1.1.tgz'
```

重新加载对应 profile 或按内部入口重启 DSH。使用的运行时需与目标版本一致；尚未验证其他 DSH 版本。

在 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: pcb-review-assistant
  config:
    projectFile: 'D:/VisualBoard/dsh-pcb-review/examples/project.kicad.json'
    reportDirectory: 'D:/VisualBoard/dsh-pcb-review/reports'
    watch: true
    popup: true
    pollSeconds: 3
```

`projectFile` 和 `reportDirectory` 只能由管理员配置；模型工具不能自行指定文件路径。留空时仍可查询器件清单及评审调用者提供的快照。`watch` / `popup` 默认关闭。服务器部署时，远端浏览器不会收到服务器上的桌面弹窗；可在工程师本机运行下面的监听命令。

## 对话示例

> 先调用 pcb_get_capabilities。查询 STM32 单片机的 layout、安规和工艺注意事项，区分通用建议和需要 datasheet 确认的内容。

> 查看当前工程 U1 的引脚网络，再执行 pcb_review_project。重点说明输入滤波电容缺失、不装、接错参考地，以及还不能确定的检查点。

> 把刚才的评审结果导出，使用最新 revision。给出报告路径，保留位号、网络、证据和依据。

| 工具 | 用途 |
|---|---|
| `pcb_get_capabilities` | 支持范围、配置状态与限制 |
| `pcb_component_guide` | 输入 `query`，可选 `kind`，查询器件清单 |
| `pcb_inspect_project` | 查看导出器件和精确网络名称，可按 `ref` 查询 |
| `pcb_review_project` | 读取配置项目并检查 |
| `pcb_review_snapshot` | 输入 `snapshotJson`，评审 `{board,context}`；明确标记为调用者提供 |
| `pcb_export_report` | 使用 `expectedRevision` 重新校验并导出，数据变化后拒绝旧快照 |
| `pcb_get_watch_status` | 监听状态、最新问题和读取错误 |
| `pcb_set_watch` | 在当前会话开启/停止监听，调整检查间隔与本机提醒 |

## KiCad 接入

使用 KiCad CLI 导出 XML 网表和 mm 单位的封装位置文件。附带脚本把两者放进同一批次目录，全部成功后再更新项目清单，避免监听到一半的导出结果：

```powershell
node scripts/export-kicad.js --cli 'D:\Kicad\bin\kicad-cli.exe' --schematic 'D:\MyBoard\Board.kicad_sch' --pcb 'D:\MyBoard\Board.kicad_pcb' --out 'D:\MyBoard\review\project.json' --context 'D:\MyBoard\review\context.json'
```

`context.json` 的内容是项目 JSON 里的 `context` 对象。省略时只解析设计并提示缺少检查点。导出脚本保留旧快照。保存设计之后需要重新运行导出；本版不自动监听 `.kicad_sch` 保存事件。

网络按导出的**完整名称**匹配，例如 `/GND` 与 `GND` 是不同网络；不会因为名称相似自动合并层级、电源域或跨线电阻两端。

## AD 接入

从 AD 的 Netlist Output/Output Job 生成 **Protel 格式的 ASCII 网表**（不是 Protel PCB ASCII、不是 IPC-D-356）。可用的导出项受 AD 安装组件和版本影响，参见 [Altium Output Jobs 文档](https://www.altium.com/documentation/altium-designer/preparing-for-manufacture/output-jobs)。本版没有 AD 二进制 `SchDoc/PcbDoc` 解析器，也没有 AD 安装环境的原生联调记录。

支持的 Protel 文件由以下块组成；可对照 `examples/demo.protel.net`：

```text
[
U1
LQFP-48
MCU_PART_NUMBER
]
(
ADC_IN
U1-3
C2-1
)
```

器件块前三行为位号、封装、值/型号，允许封装或值为空；后续元数据不使用。网络节点使用 `位号-引脚`。输入均须为 UTF-8；ANSI/GBK 导出需先转码。

AD 位置数据需整理为以下 **mm 单位、同一坐标系** CSV：

```csv
ref,x,y,side
U1,10.0,10.0,top
C2,11.0,10.0,top
```

`examples/project.altium.json` 展示完整配置。Protel 网表通常不提供可靠 DNP 信息，本版默认装配状态未知；用 `componentOverrides` 明确每个器件状态，或在工程师确认全部列出器件的装配状态后设置 `allListedFitted: true`，再逐一覆盖不装器件。不要未经核对沿用演示的该设置。

更新 AD 导出网表和坐标后，监听器会重新检查。两次稳定读取只能缓解半写文件；请将同批次文件写到新目录后，最后更新项目 JSON，避免组合不同导出批次。需要 AD 内部“连一根线立即弹提示”时，后续仍需接入 AD 扩展事件与设计对象接口。

## 配置项目规则

复制 `examples/project.kicad.json` 或 `examples/project.altium.json`。演示电路、器件与距离阈值全部是虚构测试数据，不能当作企业或原厂规则。

```json
{
  "schemaVersion": 1,
  "project": "你的工程名称",
  "format": "kicad-xml",
  "netlistPath": "netlist.xml",
  "positionsPath": "positions.csv",
  "context": {
    "signals": [{
      "ref": "U1", "pin": "3", "kind": "analog",
      "groundNet": "GND", "capacitorPolicy": "evaluate"
    }]
  }
}
```

路径相对项目 JSON 解析，也可填绝对路径。`positionsPath` 可省略。`context` 支持：

- `signals`：`kind` 为 `analog/digital/high_speed/unknown`；`capacitorPolicy` 为 `evaluate/required/forbidden`。后两种必须给出非空 `basis`，记录具体设计意图或资料条款。插件不验证这一文字依据是否真实。
- `decoupling`：`ref/pin/groundNet/basis`，检查已声明的电源旁路。
- `proximity`：`ref/nearRef/maxMm/basis`，只比较封装参考点。
- `componentOverrides`：`ref/kind/dnp`，补充明确的类别和装配状态。
- `isolation`：`id/refs/standard/workingVoltageV/pollutionDegree/materialGroup/altitudeM/basis`，以及 `requiredClearanceMm/requiredCreepageMm/measuredClearanceMm/measuredCreepageMm`。未提供必要工况或数值则待确认。这里的标准、限值和测量均由工程师提供，不是自动认证。

统一快照结构：`board={schemaVersion:1,project,components:[{ref,value,kind?,dnp?,position?:{x,y,side?}}],nets:[{name,nodes:[{ref,pin}]}]}`。引脚编号必须用字符串，元器件位号、网络名不得重复；同一引脚不得出现在多个网络。`dnp: null` 或省略表示未知。支持的 `kind` 见 `src/validation.js`。项目 `format: "snapshot-json"` 时 `netlistPath` 指向此 board 对象。

## 本地运行、演示与验证

```powershell
npm ci --ignore-scripts
npm test
node src/cli.js guide 'STM32F103C8T6'
node src/cli.js review examples/project.kicad.json --out reports
node src/cli.js review examples/project.altium.json
node src/cli.js watch examples/project.kicad.json --popup
```

演示预期：2 项需处理（C2 不装、C1 参考点距 U1 超过演示目标），3 项待确认（高速输入的电容负载、隔离间隙和爬电距离），1 项去耦拓扑符合。

监听初次稳定读取会提醒现有问题，后续只提示新增或变化项；问题消失后再次出现会重新提醒。异常单独显示，不当作零问题。Ctrl+C 或卸载插件停止监听并关闭该插件的提醒窗口。

自动化测试覆盖真实 DSH 工具注册/执行/注销、AD/KiCad 适配一致性、DNP、错地、数字信号、未知参数、布局坐标、安规上下文、过期报告、输入校验、监听去重与恢复。`scripts/verify-popup.js` 可在本机 Windows 桌面显示一个测试提醒、核对中文并自动关闭。

## 规则来源与后续接入

通用清单参考 [ST AN2834](https://www.st.com/resource/en/application_note/cd00211314-getting-started-with-adc-values-conversion-stmicroelectronics.pdf)、[TI AN-1149](https://www.ti.com/lit/an/snva021c/snva021c.pdf) 和 [TI Digital Isolator Design Guide](https://www.ti.com/lit/an/slla284b/slla284b.pdf)。它们不替代具体料号、适用产品标准或板厂能力表。

正式落地需继续接入企业评审规则和元器件资料，完成 AD/KiCad 的原生事件与定位接口，并由 EDA 几何/DRC 引擎提供真实走线、铜皮、间隙等检测结果。DeepSeek 负责组织解释与交互，本插件的确定性规则负责已声明检查点的判断。
