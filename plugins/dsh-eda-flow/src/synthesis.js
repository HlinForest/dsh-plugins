import {peripheralInstructions} from './peripheral-review.js';
import {layoutIntentInstructions} from './layout-intent.js';
import {operatingPointInstructions} from './operating-points.js';
// Model-authored circuit synthesis uses the current requirements and sources.
// No reference design or reference placement is available to this module.
export const synthesisInstructions = `电路方案由你根据功能需求、器件事实和applicationGuidance推导，用户不需要提供完整逐脚网表或元件坐标。
先以design_solve_passives从当前真实拓扑及不变条件求联立范围；它不需要预猜阻容备选，会在现值违反条件时提出components修改。评估并实际采纳有依据的repair，或记录不能采用的来源冲突。保留来源和采购/容差/偏压/ESR待核实项。可行不等于唯一，缺少亮度、干扰频谱或元件有效容量数据时，不假定某个阻值或电容只数必然正确。数值结论以engineeringReview.calculationNotes及operatingPoints为准，文字basis说明选择的原因并引用工作点id，不重复写易过时的计算结果。排版阶段只说明图面和实际检查，不重新编写电气算式。
恢复旧候选时，先按当前工作点规则重新建立扫描→供电→本地RC的依赖，再比较实际阻容；不能保留手写的旧扫描合计作为新模型的残余负载。必须实际修正违反条件的器件值或连接并design_amend/design_review，不能以增加若干备选计算替代修正。对多个均可行的值，优先保留有来源/现有条件支持的方案，明确无法唯一决定的原因；不得从参考图补值，亦不得为体现改动而强制替换。
阻容取值仍含工程假设时，可用design_explore_values对已有candidateId比较备选：variants:[{id,values:[{ref,value}]}]。一次最多8组、每组12个已有阻容，只改变实际值，保持全部工作点输入和连接不变，返回各组合计算及来源冲突。优先比较容量组合、供电串阻和上拉；不能只说“典型取值”或“抗干扰更好”。采纳须design_amend更新实际器件与依据；多种值都符合条件且无性能目标时，明确范围和未知，不能伪称唯一选值。储能总量相当不能证明不同只数/封装的高频去耦等价。增加或删除器件仍需完整design_review。不得反向放宽电流、压降、时间假设来使某组阻容通过。
已有本次 candidateId 时，小范围修改优先 design_amend：movePins:[{node:"已有数字端点",from:"原网络",to:"目标已有网络"}]；replaceRecords:[{section:"peripheralAssessments"|"operatingPoints"|"applicationDecisions"|"functions"|"components",key:"该条身份",record:完整替换后的单条记录}]；unresolved:{remove:["已过时原文"],add:["新未定项"]}。只提交发生变化的部分，不重写整板。可在同一批次移动上拉端点、更新外围依据和储能负载范围，再由宿主完整核验。它不新增器件或网络，不改变引脚定义；需要这些变化时用完整design_review。candidateId只允许编辑本次候选，不是finish凭证，成功后的reviewedDesignId才可用于finish。
每个自行选用的无源器件在components中声明electricalRole，使用routing-bridge、current-limit、series-damping、pull-up、pull-down、supply-filter、decoupling、interface-filter或other；other还须purpose说明用途。零欧跨线的数量要求与负载电流控制是两件事：0Ω只能表达导通/跨线或配置用途，不能当作正阻值限流或阻尼。不能为了凑齐跨线数量，把需要独立考虑的负载外围全部换成零欧；PCB尚未设计时，不声称已经证明某些位置必须跨线。同网/分网均要来自可见需求或明确的方案选择，不能照抄历史参考网络。
对来源componentKind为display/led的负载，在design.loadAssessments提供{ref,currentControl:"resistor"|"regulated"|"unresolved",components:["相关限流器件位号"],basis:"设计依据或计算说明",unresolved:["需复核的参数"]}。resistor模式必须列出实际负载路径中的正阻值current-limit器件；不能借用其他支路电阻。regulated模式必须声明driverRefs和当前来源basis:{sourceId,quote}（或guidanceId）；quote必须逐字出自当前资料并明确支持实际驱动器的恒流功能，各显示通道必须连接到声明的驱动器，不能把最大电流额定值当恒流功能。若规格书缺少负载极性、Vf或工作电流，允许提出有计算假设的候选并保留待核实项，或选择unresolved并明确缺项且暂缓接通无电流控制的通道；unresolved不能用于省略限流后仍将输出直接或经0Ω接到负载。参数待定时可保留带计算假设的正阻值候选和待验证项；不得写成已验证，也不得把0Ω当作未知限流值的替代。未决问题写入design.unresolved，不只放在说明段落或functions.limitations里。
本轮引用支持的无源数量和参数会被独立核对。应用指导为推荐时可以说明不采用的理由，但不可说资料中不存在已经明确给出的数量或数值。每个设计选值都区分资料给定、工程选择和未知；引用定性建议不能证明某个具体容量或阻值。未知采购、封装几何和工艺对象不从参考工程暗中补入。
先把四类内容分开处理：原始用户需求（request.inputs.requirements及其他用户字段）、规格书明确的器件/引脚/供电/推荐外围事实、已记录且带引用的应用指导、以及需要你选择的电路方案。步骤2的requirements只是用户约束和有来源事实的可追溯摘要，不是设计授权清单；不要把模型选择写回requirements，也不要把规格书事实、数量/BOM要求改写成具体网络拓扑。若用户只要求保留若干器件或物料身份，需求摘要保持数量和BOM范围即可，不得写成用户已经指定某条信号串联、某组引脚分配或两侧网络拆分/合并。用户允许自主设计时，你仍可提出合理的器件分配，但必须标明这是本次方案选择，说明用途和依据，不要求用户补齐每颗器件连线。supplied_nets是工程师/模型根据资料和实际供电依据作出的显式外部供电声明，不是任意消除ERC的开关；声明网络至少要包含真实器件端子，#PWR/#ERC辅助符号不算供电入口。
按功能建立电源、控制接口、信号通路和负载，再选择通用阻容及其参数。逐一核对芯片的供电/地、控制引脚、使能、未用引脚和推荐外围，选择参数时引用applicationGuidance或给出计算/假设。已提供的普通器件清单仍需保留；缺少清单时自行选型，不要求用户补全BOM。
规格书不能唯一确定的连接器信号分配、固件通道映射、显示极性或器件版本冲突，只提出影响结果的少量工程选择，并说明可选方案；不要要求用户逐脚连线、提供原图、固定全部位置或重复输入规格书已有内容。若用户允许自由设计，选择合理方案并把选择写入assumptions，列出依据和待验证项；若要求兼容既有接口而缺少定义，则先question。0Ω或其他无源器件两端是否同网、是否作为串联支路，只能依据输入/资料中已明确的连接或你明确作出的方案选择；没有依据时不要默认拆网或合网，必要时在assumptions中说明选择。对每组电源去耦，优先在对应functions的layout中明确负载anchor、return和members；这是模型的设计归属提示，不要求用户预先提供。
可调用design_review检查完整候选design，按errors修正后再完成。valid为true时工具会返回本次执行专用的reviewedDesignId；finish可以只提供这个reviewedDesignId和summary、gaps、assumptions，宿主会从本次成功评审的候选恢复完整design并再次核验。也可以继续在finish中提供完整design，但design与reviewedDesignId不能同时提供；ID只对本次执行有效，未知或其他执行的ID必须重新调用design_review。每个functions.checks必须真的由候选网络满足，不能用自写结论代替连接检查。design_review摘要会列出显式supplied_nets；其验证边界仅覆盖显式声明和候选网络连接，不验证电压、电流、容量或真实供电路径，summary必须如实保留这一边界。第三步最终design仍包含完整器件、网络和NC，这是你生成的结果，不是要求用户填写的输入。
第四步默认按电路功能、引脚方向和连接关系自动排布。没有用户明确的局部排版要求时，第一次layout_generate必须只用generic-v1、A4-landscape、gapMm:5.08、allowPaperPromotion:true，省略groups和rotations，让宿主先按冻结拓扑推导分组和方向。先查看实际预览的连接、碰撞和绕线检查；仅当它给出具体缺陷时再调整。通过的默认候选优先复用，不要没有检查依据就改组、加大间距或扩大纸张。你可以在存在具体缺陷时主动提出功能分组，不要求用户列出成员；用户指定阅读顺序或局部布局要求时优先落实。不把此前案例的分区、位号、坐标或固定位置作为默认答案。\n${layoutIntentInstructions}\n${peripheralInstructions}\n${operatingPointInstructions}`;

export const designReviewTool = {
  name: 'design_review',
  description: '检查本次自行推导的候选电路：真实器件引脚、资料一致性、网络完整性及功能连接。valid=true时返回本次执行专用reviewedDesignId，可在finish中引用以免重复完整design；ID不冻结或确认设计，仅供本次执行的finish使用。不返回或接受参考工程。',
  inputSchema: { type:'object', properties:{design:{type:'object'}}, required:['design'], additionalProperties:false },
};

export function designReviewSummary(design, engineeringReview = null) {
  return { components:design.components.length, pins:design.components.reduce((n,c)=>n+c.pins.length,0),
    nets:design.nets.length, explicitNC:design.nc.length,
    suppliedNets:[...(design.supplied_nets||[])],
    ...(engineeringReview?{engineeringReview}:{}),
    validationBoundary:'供电声明部分仅验证显式supplied_nets声明和候选网络连接；不验证电压、电流、容量或真实供电路径。已提供工作点的名义阻容计算另见 engineeringReview.operatingPoints，其中工程假设仍待核实。',
    functions:design.functions.map(f=>({requirementId:f.requirementId,connectionChecks:f.checks.length,limitations:f.limitations,...(f.layout?.length?{layout:f.layout}:{})})) };
}
