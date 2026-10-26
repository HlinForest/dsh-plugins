import { createHash } from 'node:crypto';
import {documentEvidence} from './inline-evidence.js';
import {validateMechanicalFacts} from './mechanical-facts.js';
import {assignedSourceReference,normalizeSourceReference} from './source-reference.js';

// Source facts and drawing decisions deliberately have separate schemas.
export const factInstructions = `步骤2同时整理componentFacts（无器件资料时可为空）。先把用户原文需求、规格书事实和后续模型方案分开；requirements只保留用户或资料明确的约束摘要。每条componentFacts只含规格书事实：
{reference,value,componentKind,pins:[{number,name,type}],objectRole:"electrical"或"process",originalFootprint,materialCode,materialDescription,assemblyType,dnp,in_bom,on_board,displayFeatures?:{digits,indicatorCount},mechanicalFacts?:[{property,value,unit:"mm",description,citations:[{sourceId,quote}]}],citations:[{sourceId,quote}]}。
componentKind为resistor/capacitor/connector/infrared-receiver/logic-ic/display/process/other。displayFeatures仅记录资料明确的数字位数及指示标记数。reference仅在资料指定有效位号时填写，否则留空；单独的 * 或 ? 是未分配标记，不是器件位号；其余未知字符串留空，装配布尔值仅按资料，缺失时省略。pins必须来自资料（number/name/type；普通阻容passive），禁止编造引脚。器件事实只能说明器件本身，不能推出板级网络、0欧两端同网/分网、串联路径或具体器件分配；这些属于第三步设计选择，需在assumptions中记录依据。citations引用inputs.evidence的id与该页逐字原文片段，保留所有有规格信息的器件；多页可多条引用。把资料中的脚距、行距、孔径、焊盘直径等逐项保存到 mechanicalFacts，每个数值都有自己的引用；property 用描述该尺寸含义的文字，description 保留条件和局部范围。mechanicalCoverage 列出宿主从当前页面发现的尺寸线索，完成前须逐项覆盖。局部尺寸缺完整铜形或编号映射时，保留已知尺寸并明确缺项，不能写成“无任何尺寸”。物理规格与绘图坐标分开：不得输出 symbolId、appearance、整页 x/y、旋转或绘图字段。符号匹配、功能分组、网格和几何由宿主按KiCad规则完成。`;

export const factTool = {name:'spec_record_facts',description:'逐批保存已从当前资料提取的器件事实。每次1至5条，保留逐字引用。相同位号可提交更正。全部资料处理完成后finish仅输出requirements、summary、gaps、assumptions，不再重复事实数组。',inputSchema:{type:'object',properties:{componentFacts:{type:'array',minItems:1,maxItems:5,items:{type:'object'}}},required:['componentFacts'],additionalProperties:false}};

const keys = new Set(['reference','value','componentKind','pins','objectRole','originalFootprint','materialCode','materialDescription','assemblyType','dnp','in_bom','on_board','displayFeatures','mechanicalFacts','citations']);
const kinds = new Set(['resistor','capacitor','connector','infrared-receiver','logic-ic','display','process','other']);
const types = new Set(['input','output','bidirectional','tri_state','passive','free','unspecified','power_in','power_out','open_collector','open_emitter','no_connect']);
const normalize = s => String(s).replace(/\s+/g, '');
export function extractFacts(plan, inputs) {
  if (plan.componentFacts === undefined) return [];
  if (!Array.isArray(plan.componentFacts) || plan.componentFacts.length > 200) throw Error('componentFacts必须为最多200条资料事实。');
  const refs = new Set(), evidence = documentEvidence(inputs);
  return plan.componentFacts.map((fact,index) => {
    if (!fact || Object.keys(fact).some(k => !keys.has(k)) || !kinds.has(fact.componentKind)) throw Error('资料事实含未知或绘图字段。');
    if (typeof fact.value !== 'string' || !fact.value.trim() || typeof fact.reference !== 'string') throw Error('器件资料需要value与reference（未指定时为空）。');
    const reference=assignedSourceReference(fact.reference);
    if (reference && refs.has(reference)) throw Error('资料位号重复：'+reference);
    if (reference) refs.add(reference);
    if (!Array.isArray(fact.citations) || !fact.citations.length) throw Error('器件资料需要逐字来源引用。');
    const citations = fact.citations.map(c => {
      const source = evidence.find(r => r.id === c.sourceId);
      if (!source || typeof c.quote !== 'string' || normalize(c.quote).length < 8 || !normalize(source.content).includes(normalize(c.quote))) throw Error('器件引用未匹配资料原文：'+fact.reference);
      return { ...c, document:source.document, page:source.page, section:source.section, simulated:source.simulated === true };
    });
    const sourceText = normalize(citations.map(c => evidence.find(r => r.id === c.sourceId).content).join(' '));
    if (!Array.isArray(fact.pins) || (!fact.pins.length && fact.objectRole !== 'process') || new Set(fact.pins.map(p=>p.number)).size !== fact.pins.length) throw Error('器件引脚表缺失或重复：'+fact.reference);
    for (const pin of fact.pins) {
      if (Object.keys(pin).some(k => !['number','name','type'].includes(k)) || typeof pin.number !== 'string' || typeof pin.name !== 'string' || !pin.number || !types.has(pin.type)) throw Error('引脚事实格式无效。');
      if (!sourceText.includes(normalize(pin.number)) || !sourceText.includes(normalize(pin.name))) throw Error('引脚在引用资料中不存在：'+fact.reference+'.'+pin.number);
    }
    if (fact.displayFeatures && (Object.keys(fact.displayFeatures).some(k=>!['digits','indicatorCount'].includes(k)) || Object.values(fact.displayFeatures).some(n=>!Number.isInteger(n)||n<0||n>16))) throw Error('显示功能仅允许数字位数和标记数。');
    for (const k of ['dnp','in_bom','on_board']) if (k in fact && typeof fact[k] !== 'boolean') throw Error('装配状态须为布尔值。');
    const mechanicalFacts=validateMechanicalFacts(fact.mechanicalFacts,inputs);
    const digest = createHash('sha256').update(JSON.stringify(fact)).digest('hex').slice(0,16);
    return {...normalizeSourceReference(fact), ...(mechanicalFacts.length?{mechanicalFacts}:{}), citations, id:'fact-'+digest, symbolId:'Evidence:Fact_'+digest, document:citations[0].document, page:citations[0].page, section:citations[0].section,
      pageIsPlaceholder:false, simulated:citations.some(c=>c.simulated), sourceType:'model-specification-fact',
      binding:reference || fact.value, content:citations.map(c=>c.quote).join('\n'), stages:[3,4,5,7]};
  });
}

export const sourceEvidence = p => [...documentEvidence(p.inputs), ...(p.stages?.find(s=>s.id===2 && s.status==='done')?.result?.evidenceFacts || []).map(normalizeSourceReference)];

export function resolveDesignFacts(design,p) {
  if (!design || !Array.isArray(design.components)) return design;
  const facts=sourceEvidence(p).filter(r=>r.sourceType==='model-specification-fact');
  return {...design,components:design.components.map(component=>{
    const symbols=facts.filter(r=>r.symbolId===component.librarySymbol);
    const fact=component.sourceFactId ? facts.find(r=>r.id===component.sourceFactId) : facts.find(r=>r.reference && r.reference===component.ref) || (symbols.length===1 ? symbols[0] : undefined);
    if(component.sourceFactId&&!fact)throw Error('未知器件事实：'+component.sourceFactId);
    if(!fact)return component;
    const {sourceFactId,...overrides}=component;
    const ref=component.ref||fact.reference;
    if(!ref)throw Error('资料未指定位号，请为选用器件分配位号。');
    const metadata=Object.fromEntries(['objectRole','originalFootprint','materialCode','materialDescription','assemblyType','dnp','in_bom','on_board','mechanicalFacts'].filter(k=>k in fact).map(k=>[k,fact[k]]));
    return {id:fact.id+'-'+ref,ref,value:fact.value,mpn:'',footprint:'',librarySymbol:fact.symbolId,dnp:false,in_bom:true,on_board:true,
      pins:fact.pins.map(pin=>({...pin,pad:pin.number})),...metadata,...overrides};
  })};
}
