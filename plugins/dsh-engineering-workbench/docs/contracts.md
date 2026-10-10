# 公共工程任务接口

`dsh-engineering-workbench/engineering` 导出 `EngineeringTasks`；`dsh-engineering-workbench/engineering-model` 导出无外部服务依赖的比较、计算和规则函数。既有业务工具名称保留。新工具 `engineering_task` 接收一个 JSON 字符串参数 `request`；所有文件限制在管理员配置的工作区。

## 任务

任务 `schemaVersion: 2`，持久化 `id / kind / revision / state / createdAt / updatedAt`。kind 为 datasheet、schematic-review、pcb-review、compare、align；产品方案继续使用原有专用工具。每次 create 制作独立快照，不共享可变“当前工程”。

| action | 主要输入 / 结果 |
| --- | --- |
| create | kind、left、right（比较/对齐必填）、outputDirectory 可选、relatedSchematic 可选 |
| list / open | 列出摘要；taskId 打开任务 |
| page / extract / evidence | side、page；两次草稿；data 资料卡或元件/网络条目 |
| mapping / calibrate | mappings 一对一对应；两个 confirmed anchors 和可选 flipY |
| compare | taskId，可选 metrics 的两侧公式输入、证据、工况和要求 |
| review | native、extended、checks；三个引擎结果分别记录 |
| prepare / edit | 选择 differences；edit 需要当前 revision 和明确 operations |
| undo / redo / verify / export | taskId；版本变化后旧验证失效；export 导出报告及完整候选包 |

覆盖、回退及其 confirmation 只通过工作台界面执行。模型工具不能代替用户确认，不能把自己生成的证据标成人工核对。

## 快照与对象

快照 manifest 包含每个 relative、source、hash；version 是有序文件清单的 SHA-256。单份文件 SHA-256 与工程组合版本分开保存。

对象 ID 包含文档身份和原生 UUID。重复层级另含实例路径；位号只供显示和搜索。多单元符号按真实单元分别保留身份和引脚，不能拿第一个单元代表全部单元。无法消歧的层级禁止自动编辑，连接覆盖标为 partial。

`components` 含 id、document、uuid、ref、value、libId、footprint、dnp、pins、at；`nets[].nodes` 含 component 和 pin。原生数据来自网表/对象解析。图片/PDF 数据保留 page、bbox、quote 和识别状态，不升级成完整网表。

## 证据与检查

资料卡保留 fileHash、snapshotVersion、file、page、bbox、quote、conditions 和 verification。`human-reviewed` 仅来自用户在界面核对；两次提取一致只记录 crossCheck=agree。

检查结果保留 engine 名称及版本、inputVersion、coverage、objects、evidence 和 conditions。原生 ERC/DRC 保留原始报告，不映射成 AD 结论。扩展上游建议与本地明确规则分开。

状态：pass（已列条件符合）、fail（确定差异或已列条件不符）、unknown（待确认）、not_performed（未执行）、failed（执行失败）、warning（原生警告）、suggestions（未整体验收的上游建议）。空输入、解析失败和缺少证据不能报通过。

## 修改与恢复

edit 操作支持 properties、move、rotate、delete、wire、junction、label、add-from-component（KiCad）和 add-component（AD SchLib/明确原生符号）。移动默认保持已有连接，disconnect=true 显式断开。KiCad 默认网格 1.27mm。每次编辑后原生重读，保留最多 40 步历史。

保存校验候选哈希、源和目标快照、revision、原生检查与声明范围。按文件锁串行保存；在写入前先保存备份及写入日志。多页逐文件原子替换，进程正常运行中的失败自动回退。系统断电等进程中断后，task.json 的 applied.files 记录用于恢复；若遗留锁存在，先检查 EDA 是否关闭及原文件、候选和备份哈希，不能直接删除锁后盲目覆盖。

离线 AD 只输出候选；原生桥接与 25/26 验收状态详见 AD-acceptance.md。当前不接受外部自报的“通过” JSON 来解锁 AD 覆盖。
