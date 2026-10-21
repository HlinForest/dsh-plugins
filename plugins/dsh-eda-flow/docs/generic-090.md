# 通用插件结构与边界

## 已实现结构

普通需求 / 固定器件清单 → 七步界面与 Harness 当前模型 → design_library / design_blocks → design 电气清单 → 第三步人工确认 → electrical + symbols + footprints + block fragments + basis 冻结快照 → layout_inspect/generate/verify → ELK + 原生片段实例化 → KiCad CLI 实际导出 → 独立核验 → 成功候选发布。

- src/service.js：七步状态、项目入口、上游变更失效；保留旧模式。
- src/text-flow.js、text-ai.js：按需查询、真实模型消息、工具执行与审核；不把库全部放入提示。
- src/design-blocks.js：版本化设计块的列出、读取和实例化；每个实例有独立前缀，外部接口绑定显式指定。
- src/controlled-layout.js：第三步确认后冻结完整电气与库文件；第四步工具没有 nets/nc/components 字段。
- src/controlled-flow.js：在候选目录生成、宿主复核、仅通过后发布；失败保留上次有效结果。
- mcp/native_resources.py：真实 KiCad 符号与封装读取、白名单、继承展开、完整原生符号快照；不是模型画的替代符号。
- mcp/generic_layout.py、pack_generic.cjs：原生设计块局部布局复用，ELK 在普通组内布局/正交布线和组间装箱，最后写出原生 KiCad 文件。
- mcp/native_schematic.py、fixed_components.py 等：重新读取实际文件与 PDF；核验符号、元件、焊盘、NC、连接、局部实线、文字与穿线。
- src/input-metrics.js：记录每次请求的 UTF-8 字节数，区分系统、初始输入、库目录、消息及历史数量。不是 token 计数，也不是网络传输字节数。

## 冻结与排版权限

第三步冻结 components（身份、参数、采购字段、装配标记、符号/封装）、完整 nets、NC、外部供电声明、需求覆盖、证据/假设，以及实际原生库与片段内容。上游输出和冻结目录都有指纹；活库后来变化不会默默替换已审核内容。

第四步只接收 generic-v1、A4/A3 横向、gapMm、完整覆盖器件的视觉 groups 和0/90/180/270度旋转。原生设计块作为完整组复用时保留内部排版，不能单独旋转内部器件。跨组网络可用标签；组内连接必须有真实导线。不能通过把全部器件拆成孤立组回避布线。

符号比较完整原生 AST；物料、字段可见性、字体、封装内容也会检查。连接必须用实际 KiCad 导出网表与冻结网表逐引脚比较；NC 同时检查实际网表和标记位置。BOM 从实际文件生成。仅 ERC 通过不构成连接一致性证明。

## 白名单格式

catalogFile 指向 UTF-8 JSON：
```json
{"schema":1,"symbols":["Device:R","Device:C"],"footprints":["Resistor_SMD:R_0805_2012Metric","Capacitor_SMD:C_0805_2012Metric"]}
```
这里是资源白名单，不是完整 ERP/AVL。暂未实现库存、批准制造商料号、替代料审批及额定值数据库。示例默认调用本机公共库，采购型号不明时保留空值。

固定器件清单为数组，或含 components 的对象；每项要求唯一 ref、librarySymbol、value、footprint，可选 mpn。它只规定器件，不预置连接。前端提供 JSON 导入；Excel/ERP 直接导入未实现。

## 设计块

libraries/blocks 包含 power-decoupling 和 uart-series 两个版本化原生 KiCad 设计块。read 返回适用范围，instantiate 分配新位号与内部网络；stage3 再验证片段指纹、器件、实际库版本及绑定。复制后内部网络不自动合并，只有声明的外部接口可显式连接。

这些块是工程示例，只通过本机静态验证；未获企业物料批准，未经过厂家推荐电路审查和实物验证。UART串阻的47Ω等示例参数不适用于所有系统。这里没有假称已实现完整参数综合或通用电路模式识别。

## 实际使用的开源能力

| 套件/数据 | 本版用途 | 是否接入 |
|---|---|---|
| KiCad CLI 与原生库/设计块 | 真实符号与封装、文件、网表、PDF、ERC | 是 |
| ELK.js 0.12.0 | 端口约束布局、正交布线、矩形块排列 | 是 |
| PyMuPDF | 实际PDF文字位置与图面检查 | 是 |
| jsonschema | 既有MCP参数校验 | 是 |
| React / Vite / Carbon | 既有七步插件前端 | 是 |
| SKiDL | 之前的对比试验 | 未接入通用生产路径 |
| tscircuit match-adapt / atopile | 候选与架构参考 | 未接入，不能宣称使用 |

冻结、企业策略、块实例绑定、符号适配和独立一致性核验仍是本插件的代码。ELK不提供电路设计正确性或人类排版审美保证。

## 当前支持边界

- 单页 A4/A3，单单元、显式正交引脚；多单元、隐藏/堆叠引脚、备用符号样式和隐式电源符号会明确拒绝。
- 生成过程保留原生几何，不缩放或删改引脚来迁就排版。页内放不下会失败，可换A3或调整分组。
- 布局尚可能偏疏或不符合习惯；本次实际生成存在离网格与库配置等 ERC warning，报告保留。零Error不代表零Warning。
- PDF扫描件OCR、自动规格书证据解析、厂家电气规则、SPICE、PCB布局布线、量产发布未在本轮实现。
- 既有显示板适配仍保留专用模板，作为兼容路径；新的普通需求不加载显示板清单或逐器件布局规则。
- 新设计第三步必须人工审核；自动回归中的测试确认不等于真实工程批准。
