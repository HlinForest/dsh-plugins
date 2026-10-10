---
name: power-selection
description: 工业控制柜电源选型、工况变更或资料库扩充时，核对连续功率、降额、尺寸与来源版本，输出六部分中文复核报告。
---

读取用户的本轮工程需求。读取 D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json，固定资料库版本和SHA256。来源PDF与TXT在 D:/VisualBoard/dsh-megmeet/success-demo/materials/。

1. 保留每个硬条件及用户原文。连续需求为持续负载×1.2。
2. 逐项比对全库型号。核对原件页码。DC OK指示灯不证明有继电器。资料缺失标为待确认。
3. 连续能力使用额定温度曲线。只有输入、温度、安装姿态、海拔和间距符合曲线前提时，才能判为满足。图中分段按线性插值。峰值与PowerBoost另列。已知宽度公差按上界计算。
4. 资料库变化时重新读取和校验。保存当轮快照、结果及来源哈希。
5. 中文短句、固定术语。报告固定为结论、需求表、候选表、计算依据、资料来源、待确认事项。表格状态用满足/不满足/待确认。版本链接指向原件的绝对路径。
6. 明确工程师下一步确认安装与接线，采购下一步确认价格、库存与交期。完成条件是结论、逐项证据和版本一致。

共用校验程序位于 D:/VisualBoard/dsh-megmeet/lib/cli.js。它与原生插件调用同一引擎。PowerShell示例：

node 'D:/VisualBoard/dsh-megmeet/lib/cli.js' --catalog 'D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json' --report-dir './reports' --max-candidates 3 --command info

把本轮工程需求原文写入本会话的唯一文本文件。每条CLI命令都加 --max-candidates 3，和原生插件采用相同候选返回上限。使用 --command search --text-file 文件，然后以返回的catalogRevision调用 --command export --text-file 文件 --expected-revision SHA256。CLI生成相同JSON、Markdown和HTML。参数路径先通过Resolve-Path获得绝对路径。保留所有结果，回报报告入口。
