# 麦格米特产品选型辅助：三条公开采购测试请求初筛评估

> 本评估仅依据同一产品库（麦格米特官网工业电源 8 份原件、28 个交流工况型号；版本 `PUBLIC-SNAPSHOT-2026-10-09`），已实际调用检索与报告工具，未联网补参。**所有结论均须工程复核**，本报告不构成可替换、可中标或供货承诺。得分是"已列条件通过比例"，不是置信度。典型效率值（Typ.）不作为保证下限；`90–132Vac/180~264Vac` 两个输入区间**不合并**为连续区间。

## 0. 共用资料与版本（可点击原件）

| 资料 | 版本 / 定位 |
| --- | --- |
| [官网资料入口](https://megmeet.com/service?id=75) · [MPT35-II · Ⅱ代 / 快照2026-10-09 / SHA 365bcc393d63](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt35-ii-user-guide.pdf) | PDF第1页选型表；官网列示日期2026-08-12 |
| [MPT50-II · Ⅱ代 / 快照2026-10-09 / SHA 9ebabb01fced](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt50-ii-user-guide.pdf) | 同上 |
| [MPT75-II · Ⅱ代 / 快照2026-10-09 / SHA 770fd71a0daa](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt75-ii-user-guide.pdf) | 同上 |
| [MPT100-II · Ⅱ代 / 快照2026-10-09 / SHA 3b4dd00a4238](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt100-ii-user-guide.pdf) | 同上 |
| [MPT150-II · Ⅱ代 / 快照2026-10-09 / SHA 41870d53f4a4](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt150-ii-user-guide.pdf) | 同上 |
| [MPT210-II · Ⅱ代 / 快照2026-10-09 / SHA 223986642ab6](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt210-ii-user-guide.pdf) | 同上 |
| [MPT350-II · Ⅱ代 / 快照2026-10-09 / SHA fd82f1d4ac00](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt350-ii-user-guide.pdf) | 同上 |
| [MPT600-I · Ⅰ代 / 快照2026-10-09 / SHA 5e925edda7f4](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt600-i-user-guide.pdf) | 同上 |

## 1. YR-24-120（24V、≥120W）

**结论：初筛候选 1 个——MPT150-24V，已列 5 项条件全部通过（100/100），状态为"待确认（needs_confirmation）"，不是"满足"。**

| 条件 | 要求 | 产品资料值 | 结果 |
| --- | --- | --- | --- |
| 输入电压 | 覆盖 176–264V | 85–264Vac（120~370Vdc） | 通过 |
| 输入类型 | AC | AC | 通过 |
| 输出电压 | 24V | 24V | 通过 |
| 输出类型 | DC | AC/DC 单组输出 | 通过 |
| 输出功率 | ≥120W | 156.0W | 通过 |

依据：[MPT150-II · Ⅱ代 / 快照2026-10-09 / SHA 41870d53f4a4](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt150-ii-user-guide.pdf)。

**关键差异（其余 27 个硬性排除，举 3 例）**：MPT100-24V 为 108.0W＜120W（[MPT100-II](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt100-ii-user-guide.pdf)）；MPT210-24V、MPT350-24V-F、MPT600-24V 虽 24V 且功率更高，但输入原文为 `90~132Vac/180~264Vac`（或 `180~264Vac`），176V 落在低/高压档之间，**不覆盖 176–264V**，判不匹配（[MPT210-II](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt210-ii-user-guide.pdf)、[MPT350-II](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt350-ii-user-guide.pdf)、[MPT600-I](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt600-i-user-guide.pdf)）。

**缺失证据 / 待确认（未解析条件保留，未移除）**：输入频率 50–60Hz、支持 1+1 并联冗余、开机软启动、输入输出隔离、短路/过载/过压/超温保护、电源输出状态报警——产品库无这些字段，**不能判定满足**；工作温度含降额条件，未填无条件满功率范围；认证标志≠已核验证书；效率 Typ.89% 仅为典型值。采购原文：[河南省政府采购公开招标·智能工厂实训系统项目](https://www.yrcti.edu.cn/__local/E/97/E2/6FB045AAF129FD1066978EDAAF1_7527CB3B_754B3.pdf?e=.pdf)（本地快照 `requirements/yrcti-smart-factory-201705.pdf`，PDF物理页59–60）。

## 2. YR-24-240（24V、≥240W）

**结论：0 个初筛候选；28 个型号全部硬性不匹配。现有资料不支持任何"满足 24V/≥240W 且输入覆盖 176–264V"的结论。**

**关键差异（排除示例 3 条）**：
1. **MPT350-24V-F**：功率 350.4W 通过，但输入 `90~132Vac/180~264Vac`→结构记录 180–264V，**不覆盖 176V**，且为风扇散热（[MPT350-II](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt350-ii-user-guide.pdf)）。
2. **MPT600-24V**：600W 通过，输入 `180~264Vac` 同样不覆盖 176V；散热描述与图片需核查，未归入自然或风扇冷却（[MPT600-I](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt600-i-user-guide.pdf)）。
3. **MPT210-24V**：211.2W＜240W 且输入为高压档 180–264V，双重不匹配（[MPT210-II](D:/VisualBoard/dsh-megmeet/real-demo/materials/megmeet-mpt210-ii-user-guide.pdf)）。

其余 24V 机型功率仅 36–156W（MPT35/50/75/100/150-24V），均因功率不足排除。**缺失证据**：输入频率 50–60Hz、开机软启动、输入输出隔离、短路/过载/过压/超温保护、电源输出状态报警均未解析；产品库中 240W 级机型仅存在于 180–264V 高压档输入与风扇散热形态。采购原文同上。

## 3. CRSC-DUAL（24V/20A 与 12V/6A 双路）

**结论：0 个初筛候选；28/28 为单组输出（1 路），与"双路同时输出"硬性冲突。按该需求 scope（单路不能宣称满足），任何一个单路型号都不得用于双路结论。**

**关键差异**：MPT150-24V（156.0W）、MPT100-24V（108.0W）等只提供 24V 单路；MPT100-12V（102.0W）、MPT150-12V（150.0W）等只提供 12V 单路；不存在同时输出 24V+12V 的型号。全部 28 个型号在"效率 ≥85%"一项均为**资料缺失**（产品库参数表无 efficiency 字段），资料描述中的 Typ. 值（如 MPT350-12V-F 为 Typ.85%、MPT100-12V 为 Typ.86.5%）**不能当作保证下限**。自然冷却一项仅在单路机型上与 `natural` 相同，不能作为双路满足证据。

**缺失证据 / 待确认（原样保留）**：输出电流"24V 输出满载 20A，12V 输出满载 6A"（折合约 480W+72W，产品库无对应双路或该功率组合机型，且无电流字段）、输入频率 47–53Hz、功率因数 ≥0.9、输入 THD、纹波、续流时间、均流冗余与保护阈值——须按公告原文逐条复核，本次未做任何推断。采购原文：[中国通号招标采购网·CTC、监测、CIPS、融雪、驼峰、调机设备买卖框架补充协议询比采购公告](https://www.crsc.com.cn/news/tsi_7267_6094_100571.html)（本地快照 `requirements/crsc-20260911.html`，正文第3节技术指标）。

## 4. 汇总

| 请求 | 初筛候选 | 已列条件最强结果 | 主要缺口性质 |
| --- | --- | --- | --- |
| YR-24-120 | 1（MPT150-24V） | 5/5 通过，待确认 | 6 项功能/频率条件无资料字段；效率、温度、证书未核 |
| YR-24-240 | 0 | 无 | 功率与输入区间无法同时满足（176V 空档） |
| CRSC-DUAL | 0 | 无 | 输出路数 2 路硬性冲突；效率字段缺失 |

## 5. 后续动作与免责

1. 对 MPT150-24V 索取**保证效率下限、负载/温度降额曲线、并联冗余、软启动、隔离耐压、保护阈值、报警接口**的正式规格书或产品承认书，并与采购条款逐条比对。
2. 240W 与双路需求应作为**资料缺口/无匹配项**回报，由工程与采购确认是否放宽 176V 下限、或接受多台/多器件方案（本报告不作方案推荐）。
3. 全部结论必须经工程复核；价格、库存、交期未接入；目录更新后需重新加载产品库。工具与插件的作用是使校验可追溯，**不构成"安装插件必然提高准确率"的保证**。
