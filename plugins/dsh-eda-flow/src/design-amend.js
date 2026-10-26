const recordKeys={components:'ref',peripheralAssessments:'ref',operatingPoints:'id',applicationDecisions:'guidanceId',functions:'requirementId'};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x);
const text=x=>typeof x==='string'&&x.trim();
const only=(x,keys)=>plain(x)&&Object.keys(x).every(k=>keys.includes(k));

export const designAmendTool={name:'design_amend',description:'局部修改本次执行的候选副本，再进行完整审查。candidateId来自design_resume/design_review/design_amend；不是完成凭证。movePins逐端点说明已有网络from/to，replaceRecords替换已有的单个记录，unresolved可增删原文待定项。不新增器件/网络，不接受坐标或脚本；更大改动使用design_review。成功才返回reviewedDesignId，不自动确认或冻结。',
  inputSchema:{type:'object',properties:{candidateId:{type:'string'},movePins:{type:'array',maxItems:100,items:{type:'object',properties:{node:{type:'string'},from:{type:'string'},to:{type:'string'}},required:['node','from','to'],additionalProperties:false}},
    replaceRecords:{type:'array',maxItems:30,items:{type:'object',properties:{section:{enum:Object.keys(recordKeys)},key:{type:'string'},record:{type:'object'}},required:['section','key','record'],additionalProperties:false}},
    unresolved:{type:'object',properties:{add:{type:'array',items:{type:'string'}},remove:{type:'array',items:{type:'string'}}},additionalProperties:false}},required:['candidateId'],additionalProperties:false}};

export function amendDesign(base,args){
  if(!plain(base)||!only(args,['candidateId','movePins','replaceRecords','unresolved'])||!text(args.candidateId))throw Error('局部修改需要当前 candidateId 和受支持的改动字段。');
  const moves=args.movePins??[],replacements=args.replaceRecords??[],issues=args.unresolved??{};
  if(!Array.isArray(moves)||moves.length>100||!Array.isArray(replacements)||replacements.length>30||!only(issues,['add','remove']))throw Error('局部修改批次或待定项格式无效。');
  const add=issues.add??[],remove=issues.remove??[];
  if(!Array.isArray(add)||!Array.isArray(remove)||[...add,...remove].some(s=>!text(s))||add.length+remove.length>200)throw Error('待定项修改必须为有界文字列表。');
  if(!moves.length&&!replacements.length&&!add.length&&!remove.length)throw Error('局部修改不能为空。');
  const next=structuredClone(base),changed=new Set(),moved=new Set();
  for(const replacement of replacements){
    if(!only(replacement,['section','key','record'])||!Object.hasOwn(recordKeys,replacement.section)||!text(replacement.key)||!plain(replacement.record))throw Error('只允许按身份替换现有的器件、外围、工作点、应用决策或功能记录。');
    const {section,key,record}=replacement,identity=recordKeys[section];
    if(record[identity]!==key||changed.has(`${section}:${key}`))throw Error('替换记录的身份必须一致且每批不能重复。');
    const rows=next[section],matches=Array.isArray(rows)?rows.map((r,i)=>r[identity]===key?i:-1).filter(i=>i>=0):[];
    if(matches.length!==1)throw Error(`记录不存在或身份不唯一：${section}/${key}`);
    if(section==='components'){
      // Changing pin identities or library definitions needs full design_review.
      const original=rows[matches[0]];
      for(const field of ['id','ref','librarySymbol','pins','sourceFactId'])if(JSON.stringify(original[field])!==JSON.stringify(record[field]))throw Error('局部器件替换不能改变身份、库或引脚；请提交完整design_review。');
      const allowed=new Set([...Object.keys(original),'value','mpn','footprint','electricalRole','purpose','dnp','in_bom','on_board']);
      if(Object.keys(record).some(k=>!allowed.has(k)))throw Error('器件替换含未知字段或绘图坐标。');
    }
    rows[matches[0]]=structuredClone(record);changed.add(`${section}:${key}`);
  }
  const nets=new Map((next.nets||[]).map(n=>[n.name,n]));
  if(nets.size!==(next.nets||[]).length)throw Error('基础候选的网络名不唯一。');
  for(const move of moves){
    if(!only(move,['node','from','to'])||![move.node,move.from,move.to].every(text)||move.from===move.to||moved.has(move.node))throw Error('端点移动需要唯一node及两个不同的已有网络。');
    const original=(base.nets||[]).filter(n=>n.nodes.includes(move.node));
    if(original.length!==1||original[0].name!==move.from||!nets.has(move.to))throw Error(`端点原网络不匹配或目标网络不存在：${move.node}`);
    nets.get(move.from).nodes=nets.get(move.from).nodes.filter(n=>n!==move.node);nets.get(move.to).nodes.push(move.node);moved.add(move.node);
  }
  if([...nets.values()].some(n=>!n.nodes.length))throw Error('局部移动会产生空网络；请用完整design_review明确修改网络与供电声明。');
  const prior=next.unresolved||[];
  if(remove.some(s=>!prior.includes(s)))throw Error('待定项删除必须精确匹配基础候选中的原文。');
  next.unresolved=[...new Set([...prior.filter(s=>!remove.includes(s)),...add])];
  return next;
}
