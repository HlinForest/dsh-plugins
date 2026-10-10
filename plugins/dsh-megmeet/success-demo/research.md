# DSH 电源插件成功案例：官方资料研究

研究与下载日期：2026-10-09。只采用 MEAN WELL 和 PULS 官方原件。本轮共保存 11 份 PDF，提取其中明确列出的 39 个型号。原始 PDF 未修改；同名 UTF-8 TXT 保留 PDF 分页符，便于按页复核。MEAN WELL 的部分字体使用私用区字符，TXT 中仅把 U+F020–U+F07E 映射为 ASCII，使 Features/Notes 可检索。

数据入口为 [materials/facts.json](materials/facts.json)；下载日期、字节数、原件 SHA256、资料版本和页数见 [materials/download-manifest.json](materials/download-manifest.json)。文件内 `page` 均为 **从 1 开始的 PDF 页码**。

## 本轮直接支持的结论

**SDR-240-24 能支持初期条件。** [官方 SDR-240 原件](https://www.meanwell.com/Upload/PDF/SDR-240/SDR-240-SPEC.PDF)第 1 页明确列出 24 V、10 A、240 W、88–264 VAC、47–63 Hz，以及 DC OK 继电器功能；第 2 页给出 DIN TS35/7.5 或 TS35/15、机身宽 63 mm、尺寸公差 ±1 mm、外接继电器触点端子及开闭行为。第 3 页的 **Continuous** 曲线是 -25°C 至 60°C 为 100%，70°C 为 75%；独立输入电压曲线在 100–264 VAC 为 100%。因此在垂直安装、1000 m 海拔、25°C 环境及 176–264 VAC 下，180 W × 1.2 = 216 W 小于其 240 W 额定连续能力，63 mm 加 1 mm 尺寸公差仍在 65 mm 机身宽约束内。将两张独立曲线用于本场景是工程推断；图的端点读数与额定参数均有原件证据。

**SDR-240-24 不能支持后期 360 W 持续需求。** 同一原件第 1 页把 360 W 明确标为 3 秒峰值，第 1 页注 6 再限定最大 3 秒；第 3 页把连续曲线和“For 3 sec. (typ.)”曲线分开。55°C 的额定连续能力仍为 240 W。300 W × 1.2 = 360 W 的持续要求不能用峰值补齐。

**SDR-480 首先因宽度失败。** [官方 SDR-480 原件](https://www.meanwell.com/Upload/PDF/SDR-480/SDR-480-SPEC.PDF)第 1、2 页均给出 85.5 mm 机身宽。第 3 页温度图另外区分 100 VAC 与 230 VAC：100 VAC 连续曲线在 50°C 开始下降，230 VAC 在 60°C 开始下降，两条都在 70°C 到 75%。不能把 230 VAC 曲线的 60°C 满功率拐点无条件套给 176 VAC。720 W 仅限 3 秒，注 6 还要求平均输出不超过额定功率。

**CP20.241-R2 满足后期额定筛选。** [PULS 官方 CP20 冗余系列原件](https://products.pulspower.com/us/mwdownloads/download/link/id/93/)第 9 页列出 nominal 24 V，额定 20 A 至 60°C、70°C 为 15 A，并明确要求 60–70°C 线性降额；第 19 页进一步给出 0.5 A/K。按 nominal 24 V 换算，额定连续功率轮廓为 (-40°C,480 W)、(60°C,480 W)、(70°C,360 W)。第 24 页宽 48 mm，并规定 35 mm DIN 导轨；第 11 页证明 DC-OK 继电器，第 4 页规定标准姿态为输入端子向下。在 55°C 下，360 W 需求低于额定 480 W。70°C 的 nominal 360 W 恰好等于需求，没有额外余量。

PULS 的输出额定条件不能省略：第 9 页为 Nom. 电压/电流，第 28 页在调节范围下限 nominal 24.0 V 的特定条件下，另有 Min.20 A@60°C、Min.15 A@70°C。该系列采用软输出调节，实际输出会随负载变化，例如 24 A 时可为 23.8 V±0.2%。480 W 是资料明确的 **nominal 额定功率**，不是任意电压设置、任意负载下的实测功率保证下限。

## 持续、储备与瞬态必须分开

PULS CP10/CP20 的额定曲线之外另有 20% PowerBoost。[CP10 原件](https://products.pulspower.com/mwdownloads/download/link/id/76)第 8 页和 [CP20 原件](https://products.pulspower.com/us/mwdownloads/download/link/id/93/)第 9 页脚注明确：完整 PowerBoost 在不高于 45°C 时可持续；高于 45°C 的使用受 10% duty 和每 10 分钟至多 1 分钟限制。45–60°C 储备线另有线性描述，CP20 第 19 页图中的短时线还标注 max.5s。数据保留这些条件，不把完整 PowerBoost 曲线合并到额定连续曲线；本轮筛选据额定连续能力，不能据此声称测出了最大可用持续能力。

CP10 的 30 A 和 CP20 的 60 A 熔断启动电流标为 **Typ.**，且为约 12 ms、每 5 秒一次的瞬态，电压条件是保持在 20 V 以上，而不是证明此时仍可按 24 V 乘电流作为可用功率。CP10 在 AC100 V 的脉冲更短。数据不把这些 Typ. 值当保证下限，也不把这种峰值当持续能力。

[LRS-350 原件](https://www.meanwell.com/Upload/PDF/LRS-350/LRS-350-SPEC.PDF)第 2 页注 7 对 12–48 V 型号给出 150% 峰值、至多 1 秒以及触发 hiccup 后约 3 秒恢复的条件；3.3/4.2/5 V 型号不从该条推导相同峰值。LRS-350 的型号额定功率也不统一等于 350 W，例如 -24 为 350.4 W，-12 为 348 W。

## 安装前提与参数边界

主案例提出垂直安装、海拔 1000 m、上 50 mm/下 40 mm/左右各 15 mm、无邻接热源。它覆盖 SDR-240 与 CP20.241-R2 的相关散热间距建议：SDR-240 第 1 页注 5 为上 40/下 20/左右 5 mm，邻接热源时左右 15 mm；CP20 第 4 页相同，适用于长期超过 50% 额定负载。PULS 还要求输入端子朝下，并保持空气流通、通风格栅遮挡不超过 15%。这些条件应写为案例运行前提，不能仅因填了间距就替代设备安装验证。

机身宽限制不包括安装间距。63 mm 或 48 mm 是本体宽，左右 15 mm 是额外空间。MEAN WELL DIN 系列在 2000 m 以上规定 fanless 3.5°C/1000 m 的环境温度降额；CP20 第 19 页在 2000 m 以上规定 1.25 A/1000 m 或 5 K/1000 m。1000 m 不触发这些高海拔降额。数据把基础功率 profile 约束在海拔不超过 2000 m，避免无条件外推。

CP10 资料存在内部海拔文字不一致：第 4 页写设计到 5000 m，第 17 页列 2000–6000 m 及降额。基础 profile 仍限于不高于 2000 m；整体安装最大海拔字段保守存 5000 m，并保留冲突说明。HDR-60 第 2 页明确 operating altitude 2000 meters。其余 MEAN WELL DIN 系列没有在这些原件内找到明确最大海拔，留 null。

HDR-60 的原件没有给出具体上/下/左右间距；LRS-350 也不应套用 DIN 系列间距。LRS 第 2 页注 9 的 360×360×1 mm 金属板属于 EMC 测试布置，不是据此保证持续热额定的证据。LRS 曲线姿态为 horizontal，其本体是 215×115×30 mm (L×W×H)，宽为 115 mm，30 mm 是高度。第 4 页为机壳 M4 安装孔。

## 缺失字段与 DC OK

SDR-120/240/480 与两份 PULS 文件明确证明有 DC OK **继电器触点**，记录 true。SDR-75、NDR-120/240/480 的图中虽写 DC OK，但原件端子及规格没有证明外部 DC OK 继电器输出；不能把电源指示灯当监控触点，故记录 null/unknown。HDR-60、LRS-350 也未证明该继电器功能，记录 unknown。缺失资料不等于功能不存在；本研究没有据“未写”记录 false。

LRS-350 的连续交流输入是 **90–132 VAC / 180–264 VAC by switch**，保留两个区间与开关条件。132–180 VAC 之间没有原件支持，176 VAC 不被覆盖。PULS 的 264–300 VAC 只允许至多 500 ms，不合并入持续 85–264 VAC 范围。HDR-60 的 277 VAC 另标 operational，不合并进 85–264 VAC 额定区间。

## 官方原件、版本与型号范围

|来源|资料版本|明确型号|
|---|---|---|
|[SDR-75](https://www.meanwell.com/Upload/PDF/SDR-75/SDR-75-SPEC.PDF)|2025-06-09|-12 / -24 / -48|
|[SDR-120](https://www.meanwell.com/Upload/PDF/SDR-120/SDR-120-SPEC.PDF)|2025-06-09|-12 / -24 / -48|
|[SDR-240](https://www.meanwell.com/Upload/PDF/SDR-240/SDR-240-SPEC.PDF)|2025-02-17|-24 / -48|
|[SDR-480](https://www.meanwell.com/Upload/PDF/SDR-480/SDR-480-SPEC.PDF)|2025-02-17|-24 / -48|
|[NDR-120](https://www.meanwell.com/Upload/PDF/NDR-120/NDR-120-SPEC.PDF)|2026-04-03|-12 / -24 / -48|
|[NDR-240](https://www.meanwell.com/Upload/PDF/NDR-240/NDR-240-SPEC.PDF)|2026-04-03|-24 / -48|
|[NDR-480](https://www.meanwell.com/Upload/PDF/NDR-480/NDR-480-SPEC.PDF)|2025-01-10|-24 / -48|
|[HDR-60](https://www.meanwell.com/Upload/PDF/HDR-60/HDR-60-SPEC.PDF)|2026-04-03|-5 / -12 / -15 / -24 / -48|
|[LRS-350](https://www.meanwell.com/Upload/PDF/LRS-350/LRS-350-SPEC.PDF)|2025-09-12|-3.3 / -4.2 / -5 / -12 / -15 / -24 / -36 / -48|
|[CP10](https://products.pulspower.com/mwdownloads/download/link/id/76)|Aug.2025 Rev.1.9|CP10.241 / CP10.241-C1 / CP10.241-S1 / CP10.241-S2 / CP10.242|
|[CP20 冗余](https://products.pulspower.com/us/mwdownloads/download/link/id/93/)|Nov.2025 Rev.1.3|CP20.241-R1 / CP20.241-R2 / CP20.242-R2 / CP20.241-R2-C1|

MEAN WELL 参数表按型号保留额定电压、电流与功率，不从系列名称推测。例如 SDR-75-12 为 75.6 W，-24/-48 为 76.8 W；HDR-60-5 为 32.5 W、-12 为 54 W，其余三个为 60 W。CP10 与 CP20 文件中的变体确实列在正式型号头部/订货型号内，才被提取，不通过字符串模板生成未出现的型号。

## 数据结构与复核记录

每个型号的基本值在顶层，`evidence` 按字段保存 `sourceId/page/quote`。未知值为 null。`continuousPowerProfile` 保存额定连续点、输入条件、姿态、海拔与间距；`alternateContinuousPowerProfiles` 保留特别输入电压条件。`powerBoost` 和 `peakPowerDuration` 独立。MEAN WELL 温度图数值标 `visual-graph-reading`；PULS 的 60–70°C 降额标 `explicit-text-linear-derating`，其额定功率按 nominal 24 V 换算。图的直线段插值不伪称为原文显式公式。

已使用 Poppler 渲染并查看关键参数表、机械尺寸及全部温度降额图；对应 PNG 也保存在 materials。PULS 渲染器报告部分字体替代，已对照原始可检索文字逐项确认电压、电流、温度、曲线标签与页码。基础 profile 在已记录的输入/温度/姿态/海拔条件内使用；缺少条件证据时应返回待确认，不外推。

