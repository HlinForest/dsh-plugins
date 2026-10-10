import { FIELDS, generateReport, loadCatalog, parseRequirements, searchProducts, sourceLinks, validateCandidate } from './domain.js';
import type { ConstraintInput, SearchResult } from './domain.js';
import { buildSolutionReport, compactResult, exportReport, reportMarkdown } from './reporting.js';

export type BusinessConfig = { catalogPath:string; maxCandidates:number; maxInputChars:number; reportDirectory:string };
export type BusinessArgs = { text?:string; constraints?:ConstraintInput[]; family?:string; limit?:number; includeIncompatible?:boolean; productId?:string; productIds?:string[]; title?:string; expectedCatalogRevision?:string };
export type BusinessCommand = 'info'|'parse'|'search'|'validate'|'report'|'export';
export async function executeBusiness(command:BusinessCommand,args:BusinessArgs,config:BusinessConfig,signal?:AbortSignal):Promise<any> {
  signal?.throwIfAborted();
  const catalog=await loadCatalog(config.catalogPath,signal);
  const meta={dataset:catalog.dataset,catalogVersion:catalog.version,catalogRevision:catalog.revision,demo:catalog.demo,humanReviewRequired:true as const};
  if(args.expectedCatalogRevision !== undefined && args.expectedCatalogRevision !== catalog.revision) throw new Error(`CATALOG_CHANGED: 资料库已变化。当前快照${catalog.revision}。请重新检索和校验。`);
  if(command==='info') return {...meta,productCount:catalog.products.length,families:[...new Set(catalog.products.map(p=>p.family))],fields:FIELDS,maxCandidates:config.maxCandidates,
    sources:catalog.sources.map(s=>({id:s.id,title:s.title,version:s.version,location:s.location,sha256:s.sha256,links:sourceLinks(s)})),
    workflow:['读取需求并保留原文。','按本次快照解析与校验。','连续功率按负载和裕量计算，并核对温度与安装条件。','使用返回的catalogRevision导出报告；资料变化后重新校验。'],
    limitations:['中文采用借鉴STE的清晰表达原则，不声明英文标准合规。','只核验已列条件。额定连续筛查与限时峰值、PowerBoost分开。','价格、库存和交期未接入。','所有用户共享管理员配置的同一资料库；本期不实现分用户数据权限。']};
  if(typeof args.text!=='string')throw new Error('text必须是需求原文。');
  const requirements=parseRequirements(args.text,args.constraints??[],config.maxInputChars);
  if(command==='parse')return {...meta,...requirements};
  const limit=args.limit??config.maxCandidates;
  if(!Number.isInteger(limit)||limit<1||limit>config.maxCandidates)throw new Error(`limit必须为1–${config.maxCandidates}的整数。`);
  if(command==='validate') {
    if(!args.productId)throw new Error('缺少productId。');
    const candidate=validateCandidate(catalog,requirements,args.productId);
    return {...meta,requirements,candidate,...(catalog.schemaVersion===2 ? {sources:compactResult({...meta,requirements,candidates:[candidate],totalEvaluated:1,totalCandidates:1,excludedIncompatible:candidate.status==='incompatible'?1:0} as SearchResult).sources} : {})};
  }
  const result=searchProducts(catalog,requirements,{family:args.family,limit,includeIncompatible:args.includeIncompatible});
  if(command==='search')return catalog.schemaVersion===2 ? compactResult(result) : result;
  let reportResult:SearchResult;
  if(args.productIds !== undefined) {
    if(!Array.isArray(args.productIds)||!args.productIds.length||args.productIds.length>config.maxCandidates||new Set(args.productIds).size!==args.productIds.length)throw new Error('productIds数量无效或重复。');
    const selected=args.productIds.map(id=>catalog.products.find(p=>p.id===id));
    if(selected.some(p=>!p))throw new Error('productIds包含不存在的产品。');
    if(args.family&&selected.some(p=>p!.family!==args.family))throw new Error('指定产品与family不一致。');
    reportResult={...meta,requirements,candidates:args.productIds.map(id=>validateCandidate(catalog,requirements,id)),totalEvaluated:args.productIds.length,totalCandidates:args.productIds.length,excludedIncompatible:0};
    reportResult.excludedIncompatible=reportResult.candidates.filter(c=>c.status==='incompatible').length;
  } else reportResult=catalog.schemaVersion===2 ? searchProducts(catalog,requirements,{family:args.family,limit:50,includeIncompatible:true}) : result;
  if(command==='report'&&catalog.schemaVersion===1) return {...generateReport(reportResult,args.title),analysis:reportResult};
  const report=buildSolutionReport(catalog,reportResult,args.text,args.title);
  const summary={...meta,reportId:report.reportId,conclusion:report.conclusion,calculations:requirements.calculations??[],markdown:reportMarkdown(report)};
  if(command==='export') {
    if(!args.expectedCatalogRevision)throw new Error('导出需要expectedCatalogRevision。先调用检索或资料库信息工具。');
    return {...summary,...await exportReport(report,config.reportDirectory)};
  }
  return {...summary,analysis:compactResult(result)};
}
