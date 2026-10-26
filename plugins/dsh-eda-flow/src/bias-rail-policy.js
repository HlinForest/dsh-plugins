import {createHash} from 'node:crypto';

const arr=x=>Array.isArray(x)?x:[];
const text=x=>typeof x==='string'?x.trim():'';
const norm=x=>text(x).normalize('NFKC').replace(/\s+/g,' ');
const close=(a,b)=>Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),1e-12);
const policy='source-constrained-minimum-modulation-v1';

// This deliberately small recognizer accepts explicit prose constraints only.
// Tables, diagrams, conditional advice and unqualified "VCC" labels do not
// become wiring facts by guessing their meaning. No project identities occur
// here; applicability comes from the already cited device fact.
function sourceRules(design,owner,context){
  const sources=[...arr(context.inputs?.evidence),...arr(context.evidence),...arr(context.evidence?.components)];
  const unique=[...new Map(sources.filter(s=>s?.id).map(s=>[s.id,s])).values()];
  const facts=unique.filter(s=>s.sourceType==='model-specification-fact');
  const component=arr(design.components).find(c=>c.ref===owner);
  const candidates=facts.filter(f=>component?.sourceFactId?f.id===component.sourceFactId:
    f.symbolId===component?.librarySymbol||f.reference===owner);
  const fact=candidates.length===1?candidates[0]:null;
  if(!fact)return {rules:[],unresolved:['没有唯一匹配且带当前引用的器件事实，不能自动认定上拉接法限制。'],pages:[]};
  const cited=new Set(arr(fact.citations).map(c=>c.sourceId));
  const documents=new Set(unique.filter(s=>cited.has(s.id)&&s.document).map(s=>s.document));
  const pages=unique.filter(s=>['pdf-text-extraction','user-provided-text'].includes(s.sourceType)&&
    (cited.has(s.id)||documents.has(s.document)));
  const rules=[],unresolved=[];
  const add=(source,quote,kind,value)=>{
    const citation={sourceId:source.id,document:source.document??null,page:source.page??null,quote};
    const id='bias-rule-'+createHash('sha256').update(JSON.stringify({kind,value,citation})).digest('hex').slice(0,16);
    rules.push({id,kind,value,citation,applicability:'device-fact-linked-single-part-document'});
  };
  for(const page of pages){
    const peers=facts.filter(f=>arr(f.citations).some(c=>unique.some(s=>s.id===c.sourceId&&s.document===page.document)));
    const statements=text(page.content).split(/(?:\r?\n\s*\r?\n|[。;；]|(?<=[A-Za-z])\.(?=\s|$))/).map(norm).filter(Boolean);
    for(const quote of statements){
      if(!/(?:pull[- ]?up|上拉)/i.test(quote)||!/(?:must|shall|required|should|recommend|必须|不得|不应|推荐|应当|建议)/i.test(quote))continue;
      // Do not borrow another device's requirements from a shared document.
      if(peers.some(f=>f.id!==fact.id&&f.value!==fact.value)){
        unresolved.push(`上拉相关条款位于多器件资料 ${page.document}，尚未确定本器件适用范围：${quote}`);continue;
      }
      let match;
      const subject='(?:the\\s+)?(?:external\\s+)?(?:output\\s+)?pull[- ]?up(?:\\s+resistor)?';
      const local='(?:the\\s+)?(?:local filtered supply|filtered device supply|device(?:’s|\'s) VCC pin)';
      const upstream='(?:the\\s+)?(?:upstream unfiltered supply|unfiltered upstream supply|supply before the filter)';
      for(const [connection,rail] of [['local',local],['upstream',upstream]]){
        const re=new RegExp(`^${subject} (must|shall|should|is recommended to) (?:be connected to|connect to) ${rail}\\.?$`,'i');
        if((match=quote.match(re)))add(page,quote,/must|shall/i.test(match[1])?'required-connection':'preferred-connection',connection);
        const chinese=new RegExp(`^(?:外部)?(?:输出)?上拉(?:电阻)?(必须|应当|推荐|建议)接(?:到|至)(?:${connection==='local'?'滤波后的本地电源|本地滤波电源':'滤波前的上游电源|上游未滤波电源'})$`);
        if((match=quote.replace(/\s/g,'').match(chinese)))add(page,quote,match[1]==='必须'?'required-connection':'preferred-connection',connection);
      }
      if((match=quote.match(/^(?:the )?(?:output )?pull[- ]?up voltage (?:must|shall) not exceed (\d+(?:\.\d+)?)\s*(m?V)\.?$/i)))
        add(page,quote,'max-pull-up-voltage',Number(match[1])*(match[2].toLowerCase()==='mv'?.001:1));
      if((match=quote.match(/^(?:输出)?上拉电压(?:必须不超过|不得超过)\s*(\d+(?:\.\d+)?)\s*(m?V)$/i)))
        add(page,quote,'max-pull-up-voltage',Number(match[1])*(match[2].toLowerCase()==='mv'?.001:1));
      if(!rules.some(r=>r.citation.sourceId===page.id&&r.citation.quote===quote))
        unresolved.push(`上拉条款的连接、额定条件或适用范围不能由当前文本识别器确定，不能用计算覆盖：${page.document??page.id}：${quote}`);
    }
  }
  return {rules:[...new Map(rules.map(r=>[r.id,r])).values()],unresolved,pages:pages.map(p=>({sourceId:p.id,document:p.document,page:p.page}))};
}

export function constrainBiasRailChoices(design,comparisons,context={}){
  return comparisons.map(comparison=>{
    const source=sourceRules(design,comparison.owner,context);
    // No applicable device fact is a known information gap. An explicit but
    // unparsed directive is different: choosing a rail could contradict it.
    const ambiguous=source.unresolved.filter(s=>!s.startsWith('没有唯一匹配'));
    const cases=comparison.cases.map(c=>{
      const violations=[];
      if(!c.physicallyDefined||!c.nominalDcWithinDeclaredLimits)violations.push('declared-nominal-dc-limit');
      for(const rule of source.rules){
        if(rule.kind==='required-connection'&&rule.value!==c.connection)violations.push(rule.id);
        if(rule.kind==='max-pull-up-voltage'&&c.nominalOpenOutputVoltageV>rule.value&&!close(c.nominalOpenOutputVoltageV,rule.value))violations.push(rule.id);
      }
      return {...c,sourceAndDcEligible:!violations.length,violations};
    });
    let eligible=cases.filter(c=>c.sourceAndDcEligible);
    const preferred=new Set(source.rules.filter(r=>r.kind==='preferred-connection').map(r=>r.value));
    const conflicts=preferred.size>1?['当前适用资料给出了互相冲突的接法建议，不能自行忽略其中之一。']:[];
    const preferredEligible=eligible.filter(c=>preferred.has(c.connection));
    if(preferredEligible.length)eligible=preferredEligible;
    // An explicit engineering objective, not a claim of general EMI benefit:
    // among feasible choices, minimize the calculated load-induced change of
    // the filtered device supply. Sink current is a constraint, not a reason
    // to invent an unmodelled high-frequency advantage.
    const minimum=eligible.length?Math.min(...eligible.map(c=>c.supplyModulationFromThisOutputV)):null;
    const accepted=eligible.filter(c=>close(c.supplyModulationFromThisOutputV,minimum)).map(c=>c.connection);
    const blockedReasons=[...ambiguous,...conflicts,...(!eligible.length?['没有同时满足已识别资料限制和本次声明直流限值的接法。']:[])];
    const basis={policy,conditions:comparison.conditions,cases:cases.map(({pinMoves,...c})=>c),rules:source.rules,
      acceptedConnections:blockedReasons.length?[]:accepted};
    const policyId='bias-policy-'+createHash('sha256').update(JSON.stringify(basis)).digest('hex').slice(0,16);
    const result={policyId,policy,objective:'在适用资料限制和声明直流限值内，优先减少本输出切换引起的滤波电源名义电压变化。',
      sourceRules:source.rules,sourcePages:source.pages,sourceUnresolved:source.unresolved,blockedReasons,
      acceptedConnections:basis.acceptedConnections,
      explanation:blockedReasons.length?'存在未解决的资料约束或计算限值，不能据此选定接法。':
        `可接受接法为 ${basis.acceptedConnections.join(' / ')}；${preferredEligible.length?'先采用适用资料的明确建议；':''}其名义供电变化为 ${minimum} V。该目标仅比较本器件电源，不推断其他电源噪声或整体EMC。`,
      qualification:'conditional-nominal-choice',unverified:[...comparison.assumptions,...comparison.unverified,...source.unresolved],
      selectionInput:'Host-computed alternatives and current source rules only. Model-authored prose is not a selection input.'};
    return {...comparison,cases,policy:result};
  });
}
