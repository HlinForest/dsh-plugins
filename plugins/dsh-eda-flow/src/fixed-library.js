import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = data => createHash('sha256').update(data).digest('hex');
export const isFixed = p => p.designMode === 'fixed-redesign';
export async function stageLibrary(directory, p, destination) {
  if (!p.fixedLibrary || p.fixedLibrary.file !== 'fixed-component-library.json') throw new Error('固定器件资料未冻结。');
  const bytes = await fs.readFile(path.join(directory,p.fixedLibrary.file));
  if (sha(bytes) !== p.fixedLibrary.sha256) throw new Error('固定器件资料指纹发生变化，不能继续。');
  await fs.mkdir(destination,{recursive:true});
  await fs.writeFile(path.join(destination,'.fixed-components.json'),bytes);
  await fs.writeFile(path.join(destination,'.fixed-components.sha256'),p.fixedLibrary.sha256);
  const library=JSON.parse(bytes);
  return { sha256:p.fixedLibrary.sha256, sourceTextSha256:library.sourceTextSha256,
    originalPageCoordinatesIncluded:false, completeNetlistIncluded:false,
    inventory:library.objects.map(c=>({reference:c.ref,value:c.value,footprint:c.originalFootprint,role:c.objectRole,pins:c.pins.length})) };
}
export const fixedInstructions = `固定原器件重新设计：用户提供简短功能需求和冻结元件库，不提供原整页坐标或完整网表。保留29个电气器件和12个工艺对象。第二/三步用precise_fixed_library核对所有电气器件的原参数及针脚，提出功能分块；无需复制长篇几何数据。
第四步precise_create空白A3后，调用precise_compose。你负责根据需求推导电路连接、功能分组和信号方向；工具负责依原符号几何计算页面位置、避让、正交连线。groups的columns由左到右，各列位号由上到下；无需给页面坐标。每个电气位号恰好归属一个组，每个reference.pin恰好进入一个net或nc。工艺对象由工具自动保留，不放入groups。选择紧凑的功能区：驱动与段电阻及显示管应形成连续主路径，接口和滤波、红外及其供电/上拉、主电源去耦按电路归组。可整体旋转符号，不改变任何原局部几何。多路电阻应平行排列，列长度尽量均衡。不要把每个器件单独分组。内部网络自动用实线连接，跨组允许标签。至少60%的连接关系必须通过可见实线表达，组内网络必须100%连续实线。
precise_compose的nets完全由你依据需求、元件引脚和参数推导，工具没有预存网表。它原子替换本轮绘图；失败不改变旧文件。排布/走线失败时调整columns、分组、rotations或spacing（0.8—1.8），不能改为大量孤立标签。使用简短明确的网络名，避免空格和过长描述。
supplied_nets是工程师/模型根据资料和实际供电路径作出的外部供电显式声明，仅用于确有供电、但被串联器件隔开的电源网络的非物料ERC声明。例如主板连接器电源引脚本身已经是power_out，不能再加重复声明；含power_in且同网没有真实power_out的网络必须显式列入。它不是任意消除ERC的开关，无真实供电通路时不得声明。以原库返回pin.type为准。原GRID4明确NC。不要通过改变原引脚类型、移动针脚、排除ERC来消除警告。
查询符号是局部坐标；冻结形状、引脚、物料字段、字段可见性必须不变。模型不手画替代显示管。首次compose后precise_read读取实际结果，再precise_check_export包含netlist、erc、pdf、svg、bom。固定器件、功能、BOM/封装标识、layoutConsistency和readabilityConsistency必须全部通过且ERC error=0。
readabilityConsistency逐网比较你的输入拓扑和实际KiCad网表，独立检查局部导线连续性；不能以标签同名替代实线。fixedConsistency.actualGeneratedNets是你本轮生成文件的真实节点表，可用于定位问题，不是原工程网表。排版微调可使用precise_place_fixed和precise_apply，但必须重新检查，移动器件时需要同步连接。
若request.resume存在，读取本轮已有工程，不重新create，可重新compose修正。完成说明必须区分数字检查与实际图像审查，不得把导出成功当作视觉通过。宿主将继续查看整页和密集区域图像。步骤5/7只读本轮生成结果核验。原库的实物封装/准确采购号已知缺项保留草稿，不编造，也不因此停止原理图生成。`;
