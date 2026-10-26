import {validateLayoutIntent} from './layout-intent.js';
// A frozen, model-authored electrical contract shared by CAD and BOM verification.
export const isNewDesign = p => ['new-design', 'datasheet-demo'].includes(p.designMode);
export const shortDisplayBrief = '设计一块两位红色七段数码管显示板，可显示00—99并调节亮度，带38kHz红外接收输出。外部稳压5V供电，主控采用5V逻辑，通过串行接口控制显示并读取红外信号。优先常见易采购器件，允许直插和贴片混装，目标板尺寸不超过80×50mm。本轮交付原理图、BOM和封装引脚映射，不做PCB。请自行提出方案、选型和连线；不要求与旧图一致。不确定的采购型号、供电余量和实物性能保留缺项，不能凭空标记验证通过。';
export const libraryTool = { name: 'design_library', description: '只读查询本机KiCad符号/封装库。先search后symbol/footprint精确查询；返回真实引脚和焊盘及文件哈希，不创建CAD、不提供完整电路。', inputSchema: { type: 'object', properties: { kind: { enum: ['search','symbol','footprint'] }, query: { type: 'string' } }, required: ['kind','query'], additionalProperties: false } };
export const designInstructions = `从零设计模式：用户只给功能与约束，不给坐标或完整连接。禁止要求用户逐针编写电路或提供原图。你负责提出方案、用design_library查询库证据、形成设计清单和自动布局。无准确厂家资料时明确待验证；本机库仅证明库定义，不等于厂家电气/机械规格已审定。
步骤2：finish提供 requirements:[{id,description}] 与功能方案summary，缺少影响方案的信息时question；requirements只摘要用户明确提出的约束，以及有来源的资料事实，不写模型后来选择的器件分配、网络拓扑或具体路径。数量、BOM身份或“保留若干器件”要求只保留数量/物料范围；不要补成某条信号串联、两侧拆网/合网或固定到某些引脚。需要自行选型或决定连接时放在assumptions/第三步design中，并写清选择依据；assumptions不是用户要求。
步骤3：先查询选用的符号及封装，finish必须提供design对象：
{components:[{id:"稳定身份",ref:"U1",value:"参数/型号",mpn:"准确采购型号或空字符串",footprint:"库:封装或空字符串",librarySymbol:"库:符号",dnp:false,in_bom:true,on_board:true,pins:[{number:"1",name:"引脚名",type:"input",pad:"1"}]}],nets:[{name:"+5V",nodes:["U1.1","J1.1"]}],nc:["U1.2"],functions:[{requirementId:"步骤2的id",description:"验证范围",checks:[{kind:"connected",nodes:["U1.1","J1.1"]}或{kind:"isolated",nodes:["U1.1","U1.2"]}],limitations:["静态连接不能证明的性能"]}],unresolved:["尚未确认事项"]}。
   每个真实引脚必须且只能出现在一个nets或nc；所有需求必须有functions。可静态验证的连接放checks；尺寸、采购可得性等无法由连接证明的要求用空checks并在limitations说明待验证方法，禁止为凑数填写无关连接。nets可含单节点但应解释。checks只能connected/isolated，每项至少2个不同有效节点。不得把不同电源或信号误合并。采购型号不确定留空；不得用通用库名冒充采购型号。pins从库证据核对，KiCad针脚号必须等于对应焊盘号，不支持隐式换脚。普通无源器件电气类型passive；连接器按库定义，电源驱动声明另加非物料helper。supplied_nets是工程师/模型根据资料和实际供电路径作出的外部供电显式声明；含power_in且同网没有真实power_out的网络必须显式列入。它只允许为确有外部供电或完整串联供电路径的网络生成非物料ERC辅助符号，不能把任意网络填入以消除ERC。
步骤4：严格遵循request.design中冻结的器件身份、参数、符号引脚、电气类型、封装及nets/nc，按文字和连线所需空间选择清晰的A4或A3布局。每个元件item.id=设计id、reference=ref、value与footprint一致，properties中写DesignId、MPN，值和设计一致；装配标记一致。符号图形可以自行绘制，但引脚不可省略/改名/改类型。只允许额外添加以#PWR或#ERC开头、Role=ERCHelper、in_bom=false、on_board=false、一个power_out引脚的电气声明符号。辅助符号不属于采购BOM，不得用它掩盖短路。未用引脚必须实际no_connect标记。每次精确检查导出会附designConsistency；若errors非空需修正CAD，不能修改冻结设计来迁就错误。无法实现则question。
步骤5/7只核对和导出，不改CAD。design-consistency.json和purchase-bom.csv由宿主按设计清单、实际CAD、KiCad XML网表、工具BOM和封装库生成。元件值/MPN/装配变化必须回到第三步重新确认，不分别重编BOM。机械尺寸、器件额定值、固件和实物功能不能仅凭网表判定通过。`;

// Keep topology decisions out of a quantity/BOM requirement summary.  This is
// deliberately a narrow, high-confidence guard: it does not try to understand
// arbitrary prose, and it authorizes a topology claim from the user's original
// requirements field or a nearby clause for the same part in another visible
// user field.  Source documents and stage notes may describe an unrelated
// component and must not silently authorize this requirement.
// The old validateRequirements(plan) protocol remains unchanged for callers
// that only need the legacy {id, description} shape check.
const topologyClaims = [
  { label: '串联拓扑', pattern: /串联|串接|\bseries(?:ly)?\b/iu },
  { label: '并联拓扑', pattern: /并联|\bparallel\b/iu },
  { label: '网络分割或合并', pattern: /两(?:侧|端).{0,12}(?:网络|节点).{0,12}(?:不|独立|分开|拆|合)|(?:同网|拆网|合网|合并网络|网络合并)|(?:不|禁止|不要)合并|\b(?:same|split|merge|separate|independent)\s+(?:net|network)s?\b/iu },
];

const inventoryRequirement = /(?:保留|留有|数量|物料|BOM|inventory|quantity|count|retain|keep)/iu;
const partRequirement = /(?:零欧|0\s*[rRΩ]|跨线|电阻|电容|无源|器件|component|part|resistor|capacitor|jumper)/iu;
const visibleUserFields = ['power', 'interfaces', 'basis', 'acceptance', 'review'];
const partIdentities = [
  { marker: /零欧|0\s*[rRΩ]|0\s*ohm|zero[- ]?ohm/iu, clause: /零欧|0\s*[rRΩ]|0\s*ohm|zero[- ]?ohm/iu },
  { marker: /跨线|jumper/iu, clause: /跨线|jumper/iu },
  { marker: /电阻|resistor/iu, clause: /电阻|resistor/iu },
  { marker: /电容|capacitor/iu, clause: /电容|capacitor/iu },
  { marker: /无源|passive/iu, clause: /无源|passive/iu },
  { marker: /器件|component|part/iu, clause: /器件|component|part/iu },
];

function samePartClause(description, source, claim) {
  const specific = partIdentities.slice(0, 2).filter(({marker}) => marker.test(description));
  const identities = specific.length ? specific : partIdentities.filter(({marker}) => marker.test(description));
  if (!identities.length || typeof source !== 'string' || !source.trim()) return false;
  // Keep the match inside one short user-written clause.  This intentionally
  // avoids treating a generic note about one component as evidence for a
  // different component in the requirements summary.
  const clauses = source.split(/[。；;！？!?\n\r]+/u);
  return clauses.some(clause => identities.some(({clause: part}) => part.test(clause) && claim.pattern.test(clause)));
}

export function validateRequirements(plan, context = {}) {
  const rows = plan?.requirements;
  if (!Array.isArray(rows) || !rows.length || rows.some(r => !r || typeof r.id !== 'string' || !r.id.trim() || typeof r.description !== 'string' || !r.description.trim()) || new Set(rows.map(r => r.id)).size !== rows.length) return '步骤2需要不重复id与description组成的requirements需求列表。';
  const inputs = context?.inputs;
  if (!inputs) return null;
  // Only user-entered fields are an authority for a quantity/BOM summary.  Do
  // not use stageNotes, datasheetText, or evidence here: those may contain a
  // recommendation for a different part.  A secondary field must mention the
  // same inventory class in the same clause as the topology claim.
  const rawUserRequirements = typeof inputs.requirements === 'string' ? inputs.requirements : '';
  const unsupported = [];
  for (const row of rows) {
    if (!inventoryRequirement.test(row.description) || !partRequirement.test(row.description)) continue;
    for (const claim of topologyClaims) {
      if (!claim.pattern.test(row.description)) continue;
      const authorized = claim.pattern.test(rawUserRequirements) || visibleUserFields.some(key => samePartClause(row.description, inputs[key], claim));
      if (!authorized) unsupported.push(`${row.id}（${claim.label}）`);
    }
  }
  return unsupported.length
    ? `数量或BOM需求不能自行附加用户未明确的拓扑选择：${unsupported.join('、')}。请保留原始数量/物料要求，把串并联、网络是否合并及器件分配放入assumptions或第三步design，并写明依据。`
    : null;
}
export function validateDesign(d, requirements = [], evidence = []) {
  const issues = [];
  if (!d || !Array.isArray(d.components) || !d.components.length || !Array.isArray(d.nets) || !Array.isArray(d.nc) || !Array.isArray(d.functions) || !Array.isArray(d.unresolved) || d.unresolved.some(x=>typeof x!=='string')) return ['design必须含components、nets、nc、functions、unresolved数组。'];
  const ids = new Set(), refs = new Set(), pins = new Set(), assigned = new Set(), names = new Set(), netByPin = new Map(), pinTypes = new Map(), realPowerOuts = new Set(), realTerminals = new Set();
  const sourcedEvidence=evidence.filter(r=>r && Array.isArray(r.pins) && (r.objectRole || r.componentKind));
  for (const c of d.components) {
    const sourced=sourcedEvidence.find(r=>r.reference===c?.ref) || sourcedEvidence.find(r=>r.symbolId && r.symbolId===c?.librarySymbol);
    if (!c || !['id','ref','value','mpn','footprint','librarySymbol'].every(k => typeof c[k] === 'string') || !c.id?.trim() || (!/^[A-Za-z][A-Za-z0-9_]*\d+$/.test(c.ref||'') && !sourced) || !c.value?.trim() || !c.librarySymbol?.includes(':') || !['dnp','in_bom','on_board'].every(k=>typeof c[k]==='boolean') || !Array.isArray(c.pins) || (!c.pins.length && sourced?.objectRole!=='process')) { issues.push('元件必须有稳定id、常规位号、value、mpn、footprint、librarySymbol、装配布尔值和pins。'); continue; }
    if(ids.has(c.id)||refs.has(c.ref)) issues.push(`重复元件身份或位号：${c.ref}`);
    ids.add(c.id);refs.add(c.ref);
    const helperComponent=c.librarySymbol==='Host:SupplyDeclaration'||/^#(?:PWR|ERC)/i.test(c.ref||'');
    for(const pin of c.pins) {
      if(!pin || typeof pin.name!=='string' || !['number','type','pad'].every(k=>typeof pin[k]==='string'&&pin[k].length) || pin.number!==pin.pad || pins.has(`${c.ref}.${pin.number}`)) issues.push(`引脚重复、缺字段或隐式换脚：${c.ref}`);
      const node = `${c.ref}.${pin?.number}`;
      pins.add(node);
      pinTypes.set(node,pin?.type);
      if(!helperComponent)realTerminals.add(node);
      if(!helperComponent&&pin?.type==='power_out')realPowerOuts.add(node);
    }
  }
  const assign = node => {if(!pins.has(node)||assigned.has(node)) issues.push(`未知或重复分配引脚：${node}`);assigned.add(node);};
  const validNets = [];
  for(const net of d.nets) {if(!net||typeof net.name!=='string'||!net.name.trim()||names.has(net.name)||!Array.isArray(net.nodes)||!net.nodes.length) {issues.push('网络需要唯一名称和非空nodes。');continue;} names.add(net.name);validNets.push(net);net.nodes.forEach(node=>{assign(node);netByPin.set(node,net.name);});}
  const suppliedNetsValid=Array.isArray(d.supplied_nets)&&!d.supplied_nets.some(n=>typeof n!=='string'||!names.has(n))&&new Set(d.supplied_nets).size===d.supplied_nets.length;
  if(d.supplied_nets!==undefined&&!suppliedNetsValid)issues.push('supplied_nets必须为已有网络名称组成的不重复字符串数组，例如["+5V","SGND"]，不要填写对象。');
  const suppliedNets=new Set(suppliedNetsValid?d.supplied_nets:[]);
  for(const net of validNets) {
    const hasPowerIn=net.nodes.some(node=>pinTypes.get(node)==='power_in');
    const hasRealPowerOut=net.nodes.some(node=>realPowerOuts.has(node));
    if(hasPowerIn&&!hasRealPowerOut&&!suppliedNets.has(net.name)) {
      issues.push(`网络 ${net.name} 含 power_in，但同网没有真实 power_out；请基于实际外部供电依据由工程师/模型显式加入 supplied_nets。supplied_nets 不是任意消除 ERC 的开关，无真实供电通路时不得声明。`);
    }
    if(suppliedNets.has(net.name)&&net.nodes.filter(node=>realTerminals.has(node)).length<2&&hasPowerIn) {
      issues.push(`声明供电网络 ${net.name} 只有 power_in，没有至少一个其他真实器件端子；#PWR/#ERC 辅助符号不算外部供电入口，请补充真实供电连接器或其他入口。`);
    }
  }
  d.nc.forEach(assign);
  for(const node of pins) if(!assigned.has(node)) issues.push(`引脚未分配网络或NC：${node}`);
  const expected=new Set(requirements.map(r=>r.id)), covered=new Set();
  for(const f of d.functions) {
    if(!f||!expected.has(f.requirementId)||covered.has(f.requirementId)||typeof f.description!=='string'||!f.description.trim()||!Array.isArray(f.limitations)||f.limitations.some(x=>typeof x!=='string'||!x.trim())||!Array.isArray(f.checks)||(!f.checks.length&&!f.limitations.length)) {issues.push('每项功能必须对应唯一需求、包含checks和limitations；无连接检查时必须明确待验证方法。');continue;}
    covered.add(f.requirementId);
    for(const check of f.checks) {
      if(!check||!['connected','isolated'].includes(check.kind)||!Array.isArray(check.nodes)||check.nodes.length<2||new Set(check.nodes).size!==check.nodes.length||check.nodes.some(n=>!pins.has(n))) {issues.push(`功能检查无效：${f.requirementId}`);continue;}
      // Each NC is its own isolated node; separate unconnected pins do not form
      // a shared undefined network. Validate the proposed design before CAD.
      const groups=check.nodes.map(node=>netByPin.has(node)?'net:'+netByPin.get(node):'nc:'+node);
      const valid=check.kind==='connected'?new Set(groups).size===1:new Set(groups).size===groups.length;
      if(!valid)issues.push(`候选电路不满足功能连接：${f.requirementId}，${check.kind} ${check.nodes.join('、')}`);
    }
  }
  for(const id of expected) if(!covered.has(id)) issues.push(`需求缺少功能检查：${id}`);
  issues.push(...validateLayoutIntent(d));
  return issues;
}
