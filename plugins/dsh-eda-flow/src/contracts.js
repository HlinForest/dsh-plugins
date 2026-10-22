export const stages = [
  { id: 1, title: '任务与约束', input: '功能、供电、接口、尺寸、板层、贴片或插件要求、验收目标。', automatic: '整理需求与设计约束', obtain: '由产品、硬件与结构工程师提供；未定项记录负责人和待确认内容。' },
  { id: 2, title: '资料与提取', input: '功能框图、接口定义、连接表、参考资料；已有工程文件可作为资料来源。', automatic: '读取资料并组织设计输入', obtain: '从零设计可用需求、器件应用说明和接口协议建立依据，参考电路不是必填项。' },
  { id: 3, title: '器件与规格书', input: '准确型号、位号、封装、规格书 PDF、电气参数、装配状态。', automatic: '读取规格书，提取带页码的器件参数', obtain: '提供厂家对应型号与封装版本的 PDF；AI 提取引脚、供电、推荐外围与限制，工程师复核。' },
  { id: 4, title: '原理图', input: '功能分块、逐引脚连接、NC、电源与接口、器件参数、图纸要求。', automatic: '生成原理图、符号库与检查结果', obtain: '补充电路连接与设计依据；AI 可提出电路方案及待确认项。' },
  { id: 5, title: 'BOM 与封装', input: '位号、型号、企业料号、封装尺寸、焊盘与引脚对应、DNP。', automatic: '整理 BOM、封装库与引脚映射', obtain: '由器件规格书、物料库与装配工艺提供封装和采购属性。' },
  { id: 6, title: 'PCB', input: '板框、安装孔、禁布区、层叠、布线铜面、器件位置、线宽间距、模型和制造要求。', automatic: '生成 PCB 和正反面预览', obtain: '结构提供机械数据，PCB 工程师确认叠层、孔金属化、关键布线与制造规则。' },
  { id: 7, title: '核验与交付', input: '验收标准、源证据、工程师意见、待确认项处理结果。', automatic: '检查工程并打包可编辑文件和记录', obtain: '确认原理图、BOM、布局布线、依赖和制造设置；技术检查与工程师签核分别记录。' },
];
export const version = '0.9.5-beta.6';
export const inputGroups = {
  1: ['01_task', '07_adjustments'], 2: ['02_materials', '04_schematic'],
  3: ['03_components', '08_dependencies'], 4: ['03_components', '04_schematic', '01_task', '07_adjustments'],
  5: ['03_components', '05_footprints'], 6: ['05_footprints', '06_pcb', '07_adjustments', '08_dependencies'],
  7: ['01_task', '07_adjustments'],
};
