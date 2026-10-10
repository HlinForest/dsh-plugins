# 工况变化

借鉴STE的清晰表达原则。中文报告不声明ASD-STE100正式合规。

## 1. 结论

本资料库没有通过全部已列条件的产品。
本轮没有待确认候选。
仅核验已列条件和资料工况。安装间距独立于本体宽度。额定连续筛查不使用限时峰值或PowerBoost替代。
资料库：V1-2026-10-09。快照：36cc305e6a77。报告：a3dff28e-10c6-4359-a0cb-5cd117020512。

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

评估30个型号。满足0个。待确认0个。排除30个。
| 型号 | 结果 | 核对依据 |
| --- | --- | --- |
| SDR-120-24 | 不满足 | 输出功率：120W，按厂家额定连续曲线与安装条件，在55℃核验120W。峰值与PowerBoost另列。 |
| SDR-240-24 | 不满足 | 输出功率：240W，按厂家额定连续曲线与安装条件，在55℃核验240W。峰值与PowerBoost另列。 |
| NDR-120-24 | 不满足 | DC OK继电器：资料缺失，产品库没有该参数。；输出功率：105W，按厂家额定连续曲线与安装条件，在55℃核验105W。峰值与PowerBoost另列。 |
| NDR-240-24 | 不满足 | DC OK继电器：资料缺失，产品库没有该参数。；输出功率：210W，按厂家额定连续曲线与安装条件，在55℃核验210W。峰值与PowerBoost另列。 |
| NDR-480-24 | 不满足 | 本体宽度：85.5mm ±1mm；最大86.5mm，按本体标称宽度加厂家机械公差的上界校验。；DC OK继电器：资料缺失，产品库没有该参数。 |

## 4. 计算依据

持续负载300W × (1 + 20%) = 需要360W额定连续能力。
SDR-120-24：额定120W；55℃下已核验连续能力120W；峰值180W，持续3s。
SDR-240-24：额定240W；55℃下已核验连续能力240W；峰值360W，持续3s。
NDR-120-24：额定120W；55℃下已核验连续能力105W；峰值未披露W，持续未披露s。
NDR-240-24：额定240W；55℃下已核验连续能力210W；峰值未披露W，持续未披露s。
NDR-480-24：额定480W；55℃下已核验连续能力420W；峰值未披露W，持续未披露s。
额定连续能力、限时峰值和PowerBoost分别记录。工作温度上限不证明全温满功率。

## 5. 资料来源

- [官网资料入口](https://www.meanwell.com/Upload/PDF/SDR-120/SDR-120-SPEC.PDF) · [SDR-120 · 2025-06-09](D:/VisualBoard/dsh-megmeet/success-demo/materials/SDR-120.pdf)：MEAN WELL SDR-120 官方规格书；PDF共3页；参数索引保留逐项PDF页码（从1开始）。
- [官网资料入口](https://www.meanwell.com/Upload/PDF/SDR-240/SDR-240-SPEC.PDF) · [SDR-240 · 2025-02-17](D:/VisualBoard/dsh-megmeet/success-demo/materials/SDR-240.pdf)：MEAN WELL SDR-240 官方规格书；PDF共3页；参数索引保留逐项PDF页码（从1开始）。
- [官网资料入口](https://www.meanwell.com/Upload/PDF/NDR-120/NDR-120-SPEC.PDF) · [NDR-120 · 2026-04-03](D:/VisualBoard/dsh-megmeet/success-demo/materials/NDR-120.pdf)：MEAN WELL NDR-120 官方规格书；PDF共4页；参数索引保留逐项PDF页码（从1开始）。
- [官网资料入口](https://www.meanwell.com/Upload/PDF/NDR-240/NDR-240-SPEC.PDF) · [NDR-240 · 2026-04-03](D:/VisualBoard/dsh-megmeet/success-demo/materials/NDR-240.pdf)：MEAN WELL NDR-240 官方规格书；PDF共4页；参数索引保留逐项PDF页码（从1开始）。
- [官网资料入口](https://www.meanwell.com/Upload/PDF/NDR-480/NDR-480-SPEC.PDF) · [NDR-480 · 2025-01-10](D:/VisualBoard/dsh-megmeet/success-demo/materials/NDR-480.pdf)：MEAN WELL NDR-480 官方规格书；PDF共4页；参数索引保留逐项PDF页码（从1开始）。

## 6. 待确认事项

- 工程师按手册核对安装、接线和应用条件。
- 采购确认价格、库存和交期。这些信息未接入。

得分不表示置信度。任何未知条件都保持待确认。
