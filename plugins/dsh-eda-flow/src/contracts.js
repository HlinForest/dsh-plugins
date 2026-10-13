export const stages = [
  { id: 1, title: '任务与约束', input: '工程版本、需求、层数、封装类型、板框和目标。', automatic: '整理约束、记录未定义项；不默认两层板或通孔器件。', obtain: '向工程负责人获取需求与当前有效版本。' },
  { id: 2, title: '原始资料与提取', input: '复原：原始 SchDoc、PcbDoc、可选 PrjPcb；新设计：功能与接口说明。', automatic: '提取原始记录、引脚、连接和模型，重新导入原板。', obtain: '从原工程归档获取源文件；无法解析时从原 Altium 导出网表、页面 PDF、BOM、层叠与规则。' },
  { id: 3, title: '器件与规格书', input: '型号、位号、封装、用户提供的 PDF 与企业物料属性。', automatic: '读取资料，绑定页码与来源；未知参数保留缺项。', obtain: '从器件厂家或企业物料库取得对应型号、封装版本的规格书。' },
  { id: 4, title: '原理图', input: '原记录或新设计方案、器件参数、逐引脚连接与图纸约束。', automatic: '生成原理图与符号库、编译网表、运行 ERC 并导出预览。', obtain: '确认连接、NC、接口定义；复原补原软件编译网表和原图。' },
  { id: 5, title: 'BOM 与封装', input: '原理图结果、位号属性、封装、DNP、装配变体与采购信息。', automatic: '生成逐位号 BOM、局部封装库与网络映射。', obtain: '由物料和工艺工程师补企业料号、封装版本及装配状态。' },
  { id: 6, title: 'PCB', input: '原理图、封装、板框、层叠、机械与布线约束。', automatic: '生成 PCB、模型依赖、原理图关联及正反面、3D 预览。', obtain: '向结构与 PCB 工程师获取板框基准、层叠、关键位置与制造约束。' },
  { id: 7, title: '核验与交付', input: '本次工程、独立核对依据、工程师意见与已知差异。', automatic: '重新检查、生成工程包；在另一空目录执行本轮步骤并比较。', obtain: '补充原软件导出和工程师评审；技术演示不等于公司生产放行。' },
];

export function defaultPlan(stage, recipe) {
  return { version: 1, stage, summary: stages[stage - 1].automatic,
    executor: recipe ? 'r6-preset' : stage < 4 ? 'local' : 'python',
    ...(recipe ? { outline: recipe.outline, font: recipe.font, limitations: recipe.limitations } : {}),
    assumptions: [], ...(stage >= 4 && !recipe ? { script: '' } : {}) };
}
