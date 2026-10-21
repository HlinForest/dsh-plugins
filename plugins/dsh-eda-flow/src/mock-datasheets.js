import {sourceEvidence} from './specification-facts.js';
import {readFileSync} from 'node:fs';
// Visible mock specification facts and symbol dimensions; no native CAD, netlist or page coordinates.
export const hasSourceSpecs = p => sourceEvidence(p).some(r => r.symbolId && (r.appearance || r.componentKind));
export const hasSimulatedInputs = p => (p.inputs?.evidence || []).some(r => r.simulated);
export const isMockDemo = p => p.designMode === 'datasheet-demo';
export const mockEvidence = JSON.parse(readFileSync(new URL('./mock-r6-records.json',import.meta.url),'utf8'));
export const mockBrief = '按随项目提供的模拟规格资料设计显示板原理图，目标与已确认MD50PG R6的器件、连接和符号要求一致。保留29个电气器件、85个引脚、八个零欧跨线及12个工艺对象；使用TM1616和IRM-3638M3-X，显示器保持原LED身份、异形底条、两个8和四圆形标记。请从自然语言要求与模拟资料推导连接、生成符号并自行排版，无需我填写网表或页面坐标。交付可编辑原理图、符号库、BOM、PDF和独立核验，本轮不做PCB；模拟来源与实际检查分别标明。';
export const mockNotes = {
  1: '请整理功能、供电、接口与交付目标，供我确认。',
  2: '请按资料来源整理可用事实，区分产品要求和器件规格。',
  3: '请核对器件、引脚及外围参数，形成后续共用的设计清单。',
  4: '请按确认资料生成并检查原理图。U1、七路段电阻和C1/C4/C8同组：电阻与驱动脚水平直连，去耦电容保持资料默认横向方向，紧凑排在U1上方并实际连接电源和地。D1、R1/R3/C2/C3与DISP同组，红外输出到接口RCV水平直连，供电与地分别走线。C5/C6/C7必须并入U1主控组，放在主控左侧，DIN/CLK/STB横向直达U1，三个电容从各自输入线向下分支，电容紧凑并排、位号和参数竖向排列，输入标号在左侧，水平主线上向下分支；底部用短线共地并标注SGND，与主控地通过同名标号连接，不得绕主控画大回路；不得独立放到显示器旁。显示器、八个零欧跨线、12个工艺对象分别集中成组。上排按红外接口在左、主控与输入滤波在右排列；下排按零欧跨线、显示器、工艺对象从左向右排列，不缩放器件，不拆散功能电路来回避布线。模型实际生成并核验后，仍须检查整页图纸质量。',
  5: '请从本次工程导出BOM，核对规格、封装说明和不装状态。',
  6: '本轮不执行PCB，仅保留机械与工艺约束。',
  7: '请核验并打包本次工程，明确模拟输入和真实检查的边界。',
};
export const evidenceForStage = (records, stage) => (records || []).filter(r => r.stages.includes(Number(stage)));
export const mockInstructions = `当前是模拟PDF提取演示，仅输入资料是mock；设计、CAD和检查必须真实执行。request.inputs.evidence为已提供的模拟摘录，pageIsPlaceholder代表页码占位，引用必须保留simulated标记。不得声称读过真实PDF，不访问AD、旧网表或冻结CAD对象。不要求用户重复补充已提供的信息；模拟事实不是待补问题，真实实物验证边界保留即可。\n专用符号可用资料的symbolId（Evidence:前缀）作为librarySymbol，pins的number/name/type必须与该资料完全一致，pad等于number。只有本项目资料明确列出的symbolId允许这样使用；图形由你绘制。其他通用符号和可用封装仍查询design_library。专用封装未建几何时footprint留空，保留封装说明，不用不匹配的库替代。不要对Evidence:符号发起本机库查询。步骤3仍输出完整design，步骤4仍做实际网表/BOM核对。`;

export const mockControlledInstructions = `模拟PDF受控演示：request.inputs.evidence包含已提供的模拟规格，页码是演示占位。不得声称已读取真实PDF。第三步可对资料明确列出的Evidence:符号调用design_library(kind=symbol)查询：宿主根据模拟引脚表和appearance外观记录生成独立符号；显示器必须保留两位连续折线8、四个近圆形指示标记及上下各五脚，不擅自指定图标功能或型号，资料缺外观时停止补齐，不能退化为空方框，不读取历史CAD。必须使用返回的number/name/type/pad，不能自写符号几何；凡资料提供symbolId和appearance的器件（包括阻容及工艺对象）均使用该Evidence:符号，不用引脚相同的通用库符号替代指定外观；资料未定义外观的通用元件才查询本机库。本轮仅原理图，专用PCB封装尚未建库时允许footprint为空，在unresolved中说明PCB阶段再核验。不得为凑封装选择不匹配的引脚或排距，也不把缺封装说成已制造验证。模拟事实不重复追问。components同时保留资料中的objectRole、originalFootprint、materialCode、materialDescription、assemblyType，企业物料编码不填成厂商mpn；特殊位号及无引脚工艺对象按资料保留。仍输出完整design及supplied_nets：资料明确的+5V、SGND以及经R1供电的滤波后IR_VCC可声明供电，供电标记仅用于ERC、不增加实物电源。U1等专用封装存在未核实尺寸差异时footprint留空，不先绑定近似库项。第三步人工确认后冻结；第四步只有layout_inspect/generate/verify，不允许precise_create/apply或修改电路。步骤5/7只读核验。引用和交付保留simulated标记；真实检查不是实物验证。`;
