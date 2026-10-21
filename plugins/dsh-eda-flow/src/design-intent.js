// A frozen, model-authored electrical contract shared by CAD and BOM verification.
export const isNewDesign = p => ['new-design', 'datasheet-demo'].includes(p.designMode);
export const shortDisplayBrief = '设计一块两位红色七段数码管显示板，可显示00—99并调节亮度，带38kHz红外接收输出。外部稳压5V供电，主控采用5V逻辑，通过串行接口控制显示并读取红外信号。优先常见易采购器件，允许直插和贴片混装，目标板尺寸不超过80×50mm。本轮交付原理图、BOM和封装引脚映射，不做PCB。请自行提出方案、选型和连线；不要求与旧图一致。不确定的采购型号、供电余量和实物性能保留缺项，不能凭空标记验证通过。';
export const libraryTool = { name: 'design_library', description: '只读查询本机KiCad符号/封装库。先search后symbol/footprint精确查询；返回真实引脚和焊盘及文件哈希，不创建CAD、不提供完整电路。', inputSchema: { type: 'object', properties: { kind: { enum: ['search','symbol','footprint'] }, query: { type: 'string' } }, required: ['kind','query'], additionalProperties: false } };
export const designInstructions = `从零设计模式：用户只给功能与约束，不给坐标或完整连接。禁止要求用户逐针编写电路或提供原图。你负责提出方案、用design_library查询库证据、形成设计清单和自动布局。无准确厂家资料时明确待验证；本机库仅证明库定义，不等于厂家电气/机械规格已审定。
步骤2：finish提供 requirements:[{id,description}] 与功能方案summary，缺少影响方案的信息时question；沿用用户允许的假设，保留在assumptions。
步骤3：先查询选用的符号及封装，finish必须提供design对象：
{components:[{id:"稳定身份",ref:"U1",value:"参数/型号",mpn:"准确采购型号或空字符串",footprint:"库:封装或空字符串",librarySymbol:"库:符号",dnp:false,in_bom:true,on_board:true,pins:[{number:"1",name:"引脚名",type:"input",pad:"1"}]}],nets:[{name:"+5V",nodes:["U1.1","J1.1"]}],nc:["U1.2"],functions:[{requirementId:"步骤2的id",description:"验证范围",checks:[{kind:"connected",nodes:["U1.1","J1.1"]}或{kind:"isolated",nodes:["U1.1","U1.2"]}],limitations:["静态连接不能证明的性能"]}],unresolved:["尚未确认事项"]}。
每个真实引脚必须且只能出现在一个nets或nc；所有需求必须有functions。可静态验证的连接放checks；尺寸、采购可得性等无法由连接证明的要求用空checks并在limitations说明待验证方法，禁止为凑数填写无关连接。nets可含单节点但应解释。checks只能connected/isolated，每项至少2个不同有效节点。不得把不同电源或信号误合并。采购型号不确定留空；不得用通用库名冒充采购型号。pins从库证据核对，KiCad针脚号必须等于对应焊盘号，不支持隐式换脚。普通无源器件电气类型passive；连接器按库定义，电源驱动声明另加非物料helper。
步骤4：严格遵循request.design中冻结的器件身份、参数、符号引脚、电气类型、封装及nets/nc，按文字和连线所需空间选择清晰的A4或A3布局。每个元件item.id=设计id、reference=ref、value与footprint一致，properties中写DesignId、MPN，值和设计一致；装配标记一致。符号图形可以自行绘制，但引脚不可省略/改名/改类型。只允许额外添加以#PWR或#ERC开头、Role=ERCHelper、in_bom=false、on_board=false、一个power_out引脚的电气声明符号。辅助符号不属于采购BOM，不得用它掩盖短路。未用引脚必须实际no_connect标记。每次精确检查导出会附designConsistency；若errors非空需修正CAD，不能修改冻结设计来迁就错误。无法实现则question。
步骤5/7只核对和导出，不改CAD。design-consistency.json和purchase-bom.csv由宿主按设计清单、实际CAD、KiCad XML网表、工具BOM和封装库生成。元件值/MPN/装配变化必须回到第三步重新确认，不分别重编BOM。机械尺寸、器件额定值、固件和实物功能不能仅凭网表判定通过。`;

export function validateRequirements(plan) {
  const rows = plan.requirements;
  if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || typeof r.id !== 'string' || !r.id.trim() || typeof r.description !== 'string' || !r.description.trim()) || new Set(rows.map(r => r.id)).size !== rows.length) return '步骤2需要不重复id与description组成的requirements需求列表。';
  return null;
}
export function validateDesign(d, requirements = [], evidence = []) {
  const issues = [];
  if (!d || !Array.isArray(d.components) || !d.components.length || !Array.isArray(d.nets) || !Array.isArray(d.nc) || !Array.isArray(d.functions) || !Array.isArray(d.unresolved) || d.unresolved.some(x=>typeof x!=='string')) return ['design必须含components、nets、nc、functions、unresolved数组。'];
  const ids = new Set(), refs = new Set(), pins = new Set(), assigned = new Set(), names = new Set();
  for (const c of d.components) {
    const sourced=evidence.find(r=>r.reference===c?.ref && r.objectRole && Array.isArray(r.pins));
    if (!c || !['id','ref','value','mpn','footprint','librarySymbol'].every(k => typeof c[k] === 'string') || !c.id?.trim() || (!/^[A-Za-z][A-Za-z0-9_]*\d+$/.test(c.ref||'') && !sourced) || !c.value?.trim() || !c.librarySymbol?.includes(':') || !['dnp','in_bom','on_board'].every(k=>typeof c[k]==='boolean') || !Array.isArray(c.pins) || (!c.pins.length && sourced?.objectRole!=='process')) { issues.push('元件必须有稳定id、常规位号、value、mpn、footprint、librarySymbol、装配布尔值和pins。'); continue; }
    if(ids.has(c.id)||refs.has(c.ref)) issues.push(`重复元件身份或位号：${c.ref}`);
    ids.add(c.id);refs.add(c.ref);
    for(const pin of c.pins) {
      if(!pin || typeof pin.name!=='string' || !['number','type','pad'].every(k=>typeof pin[k]==='string'&&pin[k].length) || pin.number!==pin.pad || pins.has(`${c.ref}.${pin.number}`)) issues.push(`引脚重复、缺字段或隐式换脚：${c.ref}`);
      pins.add(`${c.ref}.${pin?.number}`);
    }
  }
  const assign = node => {if(!pins.has(node)||assigned.has(node)) issues.push(`未知或重复分配引脚：${node}`);assigned.add(node);};
  for(const net of d.nets) {if(!net||typeof net.name!=='string'||!net.name.trim()||names.has(net.name)||!Array.isArray(net.nodes)||!net.nodes.length) {issues.push('网络需要唯一名称和非空nodes。');continue;} names.add(net.name);net.nodes.forEach(assign);}
  if(d.supplied_nets!==undefined&&(!Array.isArray(d.supplied_nets)||d.supplied_nets.some(n=>typeof n!=='string'||!names.has(n))||new Set(d.supplied_nets).size!==d.supplied_nets.length))issues.push('supplied_nets必须为已有网络名称组成的不重复字符串数组，例如["+5V","SGND"]，不要填写对象。');
  d.nc.forEach(assign);
  for(const node of pins) if(!assigned.has(node)) issues.push(`引脚未分配网络或NC：${node}`);
  const expected=new Set(requirements.map(r=>r.id)), covered=new Set();
  for(const f of d.functions) {
    if(!f||!expected.has(f.requirementId)||covered.has(f.requirementId)||typeof f.description!=='string'||!f.description.trim()||!Array.isArray(f.limitations)||f.limitations.some(x=>typeof x!=='string'||!x.trim())||!Array.isArray(f.checks)||(!f.checks.length&&!f.limitations.length)) {issues.push('每项功能必须对应唯一需求、包含checks和limitations；无连接检查时必须明确待验证方法。');continue;}
    covered.add(f.requirementId);
    for(const check of f.checks) if(!check||!['connected','isolated'].includes(check.kind)||!Array.isArray(check.nodes)||check.nodes.length<2||new Set(check.nodes).size!==check.nodes.length||check.nodes.some(n=>!pins.has(n))) issues.push(`功能检查无效：${f.requirementId}`);
  }
  for(const id of expected) if(!covered.has(id)) issues.push(`需求缺少功能检查：${id}`);
  return issues;
}
