# 资料库扩充

借鉴STE的清晰表达原则。中文报告不声明ASD-STE100正式合规。

## 1. 结论

满足已列条件：CP20.241-R1、CP20.241-R2、CP20.241-R2-C1、CP20.242-R2。
本轮没有待确认候选。
仅核验已列条件和资料工况。安装间距独立于本体宽度。额定连续筛查不使用限时峰值或PowerBoost替代。
资料库：V2-2026-10-09。快照：14f84f295a41。报告：95895307-23af-4f07-99c6-c304c3d287f8。

## 2. 需求表

| 条件 | 要求 | 原文 |
| --- | --- | --- |
| 输出电压 | = 24V | 输出电压：24VDC |
| 输出类型 | = DC | 输出电压：24VDC |
| 输入电压 | 176–264V | 输入电压：176–264VAC |
| 输入类型 | = AC | 输入电压：176–264VAC |
| 输入频率 | 50–60Hz | 输入频率：50–60Hz |
| 安装方式 | = 导轨 | 安装方式：导轨 |
| 本体宽度 | ≤ 65mm | 本体宽度≤65mm |
| DC OK继电器 | = 有 | DC OK继电器：有 |
| 工作温度 | = 55°C | 环境温度：55℃ |
| 安装姿态 | = 垂直且输入端子朝下 | 安装姿态：垂直且输入端子朝下 |
| 海拔 | = 1000m | 海拔：1000m |
| 上方间距 | = 50mm | 上方间距：50mm |
| 下方间距 | = 40mm | 下方间距：40mm |
| 侧面间距 | = 15mm | 侧面间距：15mm |
| 输出功率 | ≥ 360W | 持续负载：300W（按负载与裕量计算） |

## 3. 候选表

评估39个型号。满足4个。待确认0个。排除35个。
| 型号 | 结果 | 核对依据 |
| --- | --- | --- |
| CP20.241-R1 | 满足已列条件 | 已列条件逐项通过 |
| CP20.241-R2 | 满足已列条件 | 已列条件逐项通过 |
| CP20.241-R2-C1 | 满足已列条件 | 已列条件逐项通过 |
| CP10.241 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |
| CP10.241-C1 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |
| CP10.241-S1 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |
| CP10.241-S2 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |
| CP10.242 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |

### CP20.241-R1核对表

| 条件 | 要求 | 资料值 | 结果 | 原件位置 |
| --- | --- | --- | --- | --- |
| 输出电压 | = 24V | 24V | 满足 | CP20.241-R2，第9页；DC 24V |
| 输出类型 | = DC | DC | 满足 | CP20.241-R2，第9页；DC 24V |
| 输入电压 | 覆盖 176–264V | 85–264V | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入类型 | = AC | AC | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入频率 | 覆盖 50–60Hz | 47–63.6Hz | 满足 | CP20.241-R2，第6页；50–60Hz |
| 安装方式 | = 导轨 | din | 满足 | CP20.241-R2，第24页；35mm DIN rails |
| 本体宽度 | ≤ 65mm | 48mm | 满足 | CP20.241-R2，第24页；48mm |
| DC OK继电器 | = 有 | yes | 满足 | CP20.241-R2，第11页；DC-OK RELAY CONTACT |
| 工作温度 | = 55°C | -40–70°C | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 安装姿态 | = 垂直且输入端子朝下 | vertical-input-terminals-bottom | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 海拔 | = 1000m | 2000m | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 上方间距 | = 50mm | 40mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 下方间距 | = 40mm | 20mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 侧面间距 | = 15mm | 15mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 输出功率 | ≥ 360W | 480W | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |

### CP20.241-R2核对表

| 条件 | 要求 | 资料值 | 结果 | 原件位置 |
| --- | --- | --- | --- | --- |
| 输出电压 | = 24V | 24V | 满足 | CP20.241-R2，第9页；DC 24V |
| 输出类型 | = DC | DC | 满足 | CP20.241-R2，第9页；DC 24V |
| 输入电压 | 覆盖 176–264V | 85–264V | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入类型 | = AC | AC | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入频率 | 覆盖 50–60Hz | 47–63.6Hz | 满足 | CP20.241-R2，第6页；50–60Hz |
| 安装方式 | = 导轨 | din | 满足 | CP20.241-R2，第24页；35mm DIN rails |
| 本体宽度 | ≤ 65mm | 48mm | 满足 | CP20.241-R2，第24页；48mm |
| DC OK继电器 | = 有 | yes | 满足 | CP20.241-R2，第11页；DC-OK RELAY CONTACT |
| 工作温度 | = 55°C | -40–70°C | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 安装姿态 | = 垂直且输入端子朝下 | vertical-input-terminals-bottom | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 海拔 | = 1000m | 2000m | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 上方间距 | = 50mm | 40mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 下方间距 | = 40mm | 20mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 侧面间距 | = 15mm | 15mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 输出功率 | ≥ 360W | 480W | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |

### CP20.241-R2-C1核对表

| 条件 | 要求 | 资料值 | 结果 | 原件位置 |
| --- | --- | --- | --- | --- |
| 输出电压 | = 24V | 24V | 满足 | CP20.241-R2，第9页；DC 24V |
| 输出类型 | = DC | DC | 满足 | CP20.241-R2，第9页；DC 24V |
| 输入电压 | 覆盖 176–264V | 85–264V | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入类型 | = AC | AC | 满足 | CP20.241-R2，第6页；85-264Vac |
| 输入频率 | 覆盖 50–60Hz | 47–63.6Hz | 满足 | CP20.241-R2，第6页；50–60Hz |
| 安装方式 | = 导轨 | din | 满足 | CP20.241-R2，第24页；35mm DIN rails |
| 本体宽度 | ≤ 65mm | 48mm | 满足 | CP20.241-R2，第24页；48mm |
| DC OK继电器 | = 有 | yes | 满足 | CP20.241-R2，第11页；DC-OK RELAY CONTACT |
| 工作温度 | = 55°C | -40–70°C | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 安装姿态 | = 垂直且输入端子朝下 | vertical-input-terminals-bottom | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 海拔 | = 1000m | 2000m | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 上方间距 | = 50mm | 40mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 下方间距 | = 40mm | 20mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 侧面间距 | = 15mm | 15mm | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |
| 输出功率 | ≥ 360W | 480W | 满足 | CP20.241-R2，第9页；Derate linearly between +60°C and +70°C |

## 4. 计算依据

持续负载300W × (1 + 20%) = 需要360W额定连续能力。
CP20.241-R1：额定480W；55℃下已核验连续能力480W；峰值未披露W，持续未披露s。
CP20.241-R2：额定480W；55℃下已核验连续能力480W；峰值未披露W，持续未披露s。
CP20.241-R2-C1：额定480W；55℃下已核验连续能力480W；峰值未披露W，持续未披露s。
CP10.241：额定240W；55℃下已核验连续能力240W；峰值未披露W，持续未披露s。
CP10.241-C1：额定240W；55℃下已核验连续能力240W；峰值未披露W，持续未披露s。
CP10.241-S1：额定240W；55℃下已核验连续能力240W；峰值未披露W，持续未披露s。
CP10.241-S2：额定240W；55℃下已核验连续能力240W；峰值未披露W，持续未披露s。
CP10.242：额定240W；55℃下已核验连续能力240W；峰值未披露W，持续未披露s。
额定连续能力、限时峰值和PowerBoost分别记录。工作温度上限不证明全温满功率。

## 5. 资料来源

- [官网资料入口](https://products.pulspower.com/mwdownloads/download/link/id/76) · [CP10.241 · Aug. 2025 / Rev. 1.9](D:/VisualBoard/dsh-megmeet/success-demo/materials/CP10.241.pdf)：PULS CP10.241 官方规格书；PDF共33页；参数索引保留逐项PDF页码（从1开始）。
- [官网资料入口](https://products.pulspower.com/us/mwdownloads/download/link/id/93/) · [CP20.241-R2 · Nov. 2025 / Rev. 1.3](D:/VisualBoard/dsh-megmeet/success-demo/materials/CP20.241-R2.pdf)：PULS CP20.241-R2 官方规格书；PDF共33页；参数索引保留逐项PDF页码（从1开始）。

## 6. 待确认事项

- 工程师按手册核对安装、接线和应用条件。
- 采购确认价格、库存和交期。这些信息未接入。

得分不表示置信度。任何未知条件都保持待确认。
