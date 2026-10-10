# 初次选型

借鉴STE的清晰表达原则。中文报告不声明ASD-STE100正式合规。

## 1. 结论

满足已列条件：SDR-240-24。
待确认：NDR-240-24。
仅核验已列条件和资料工况。安装间距独立于本体宽度。额定连续筛查不使用限时峰值或PowerBoost替代。
资料库：V1-2026-10-09。快照：5f98af21efa2。报告：274d70e6-a693-428f-8535-b9f40c3ce2bb。

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
| 工作温度 | = 25°C | 环境温度：25℃ |
| 安装姿态 | = 垂直且输入端子朝下 | 安装姿态：垂直且输入端子朝下 |
| 海拔 | = 1000m | 海拔：1000m |
| 上方间距 | = 50mm | 上方间距：50mm |
| 下方间距 | = 40mm | 下方间距：40mm |
| 侧面间距 | = 15mm | 侧面间距：15mm |
| 输出功率 | ≥ 216W | 持续负载：180W（按负载与裕量计算） |

## 3. 候选表

评估30个型号。满足1个。待确认1个。排除28个。
| 型号 | 结果 | 核对依据 |
| --- | --- | --- |
| SDR-240-24 | 满足已列条件 | 已列条件逐项通过 |
| NDR-240-24 | 待确认 | DC OK继电器：资料缺失，产品库没有该参数。 |
| SDR-120-24 | 不满足 | 输出功率：120W，按厂家额定连续曲线与安装条件，在25℃核验120W。峰值与PowerBoost另列。 |
| SDR-240-48 | 不满足 | 输出电压：48V，产品库参数不满足此项已列条件。 |
| NDR-120-24 | 不满足 | DC OK继电器：资料缺失，产品库没有该参数。；输出功率：120W，按厂家额定连续曲线与安装条件，在25℃核验120W。峰值与PowerBoost另列。 |
| NDR-240-48 | 不满足 | 输出电压：48V，产品库参数不满足此项已列条件。；DC OK继电器：资料缺失，产品库没有该参数。 |
| NDR-480-24 | 不满足 | 本体宽度：85.5mm ±1mm；最大86.5mm，按本体标称宽度加厂家机械公差的上界校验。；DC OK继电器：资料缺失，产品库没有该参数。 |

### SDR-240-24核对表

| 条件 | 要求 | 资料值 | 结果 | 原件位置 |
| --- | --- | --- | --- | --- |
| 输出电压 | = 24V | 24V | 满足 | SDR-240，第1页；24V |
| 输出类型 | = DC | DC | 满足 | SDR-240，第1页；24V |
| 输入电压 | 覆盖 176–264V | 88–264V | 满足 | SDR-240，第1页；88 ~ 264VAC |
| 输入类型 | = AC | AC | 满足 | SDR-240，第1页；88 ~ 264VAC |
| 输入频率 | 覆盖 50–60Hz | 47–63Hz | 满足 | SDR-240，第1页；47 ~ 63Hz |
| 安装方式 | = 导轨 | din | 满足 | SDR-240，第2页；TS35/7.5 OR TS35/15 |
| 本体宽度 | ≤ 65mm | 63mm ±1mm；最大64mm | 满足 | SDR-240，第1页；63\* |
| DC OK继电器 | = 有 | yes | 满足 | SDR-240，第1页；DC OK REALY CONTACT RATINGS |
| 工作温度 | = 25°C | -25–70°C | 满足 | SDR-240，第3页；Derating Curve |
| 安装姿态 | = 垂直且输入端子朝下 | vertical | 满足 | SDR-240，第3页；Derating Curve |
| 海拔 | = 1000m | 2000m | 满足 | SDR-240，第1页；3.5℃/1000m |
| 上方间距 | = 50mm | 40mm | 满足 | SDR-240，第1页；40mm on top, 20mm on the bottom, 5mm |
| 下方间距 | = 40mm | 20mm | 满足 | SDR-240，第1页；40mm on top, 20mm on the bottom, 5mm |
| 侧面间距 | = 15mm | 15mm | 满足 | SDR-240，第1页；40mm on top, 20mm on the bottom, 5mm |
| 输出功率 | ≥ 216W | 240W | 满足 | SDR-240，第3页；Derating Curve |

### NDR-240-24核对表

| 条件 | 要求 | 资料值 | 结果 | 原件位置 |
| --- | --- | --- | --- | --- |
| 输出电压 | = 24V | 24V | 满足 | NDR-240，第2页；24V |
| 输出类型 | = DC | DC | 满足 | NDR-240，第2页；24V |
| 输入电压 | 覆盖 176–264V | 90–264V | 满足 | NDR-240，第2页；90 ~ 264VAC |
| 输入类型 | = AC | AC | 满足 | NDR-240，第2页；90 ~ 264VAC |
| 输入频率 | 覆盖 50–60Hz | 47–63Hz | 满足 | NDR-240，第2页；47 ~ 63Hz |
| 安装方式 | = 导轨 | din | 满足 | NDR-240，第4页；TS35/7.5 OR TS35/15 |
| 本体宽度 | ≤ 65mm | 63mm ±1mm；最大64mm | 满足 | NDR-240，第2页；63\* |
| DC OK继电器 | = 有 | 资料缺失 | 待确认 | 资料缺失 |
| 工作温度 | = 25°C | -20–70°C | 满足 | NDR-240，第3页；Derating Curve |
| 安装姿态 | = 垂直且输入端子朝下 | vertical | 满足 | NDR-240，第3页；Derating Curve |
| 海拔 | = 1000m | 2000m | 满足 | NDR-240，第2页；3.5℃/1000m |
| 上方间距 | = 50mm | 40mm | 满足 | NDR-240，第2页；40mm on top, 20mm on the bottom, 5mm |
| 下方间距 | = 40mm | 20mm | 满足 | NDR-240，第2页；40mm on top, 20mm on the bottom, 5mm |
| 侧面间距 | = 15mm | 15mm | 满足 | NDR-240，第2页；40mm on top, 20mm on the bottom, 5mm |
| 输出功率 | ≥ 216W | 240W | 满足 | NDR-240，第3页；Derating Curve |

## 4. 计算依据

持续负载180W × (1 + 20%) = 需要216W额定连续能力。
SDR-240-24：额定240W；25℃下已核验连续能力240W；峰值360W，持续3s。
NDR-240-24：额定240W；25℃下已核验连续能力240W；峰值未披露W，持续未披露s。
SDR-120-24：额定120W；25℃下已核验连续能力120W；峰值180W，持续3s。
SDR-240-48：额定240W；25℃下已核验连续能力240W；峰值360W，持续3s。
NDR-120-24：额定120W；25℃下已核验连续能力120W；峰值未披露W，持续未披露s。
NDR-240-48：额定240W；25℃下已核验连续能力240W；峰值未披露W，持续未披露s。
NDR-480-24：额定480W；25℃下已核验连续能力480W；峰值未披露W，持续未披露s。
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
