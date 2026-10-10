import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loadCatalog,parseRequirements,searchProducts } from '../../lib/domain.js';
import { buildSolutionReport,exportReport } from '../../lib/reporting.js';

export const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const facts=JSON.parse(await fs.readFile(path.join(root,'materials/facts.json'),'utf8'));
const manifest=JSON.parse(await fs.readFile(path.join(root,'materials/download-manifest.json'),'utf8'));
for(const dir of ['snapshots','prompts','reports','records','configs','skills/b/power-selection','skills/d/power-selection','workspace'])await fs.mkdir(path.join(root,dir),{recursive:true});
const evidence=e=>e?{sourceId:e.sourceId,page:e.page,quote:e.quote}:undefined;
const map={outputVoltage:'output_voltage_v',current:'output_current_a',ratedPower:'output_power_w',inputFrequency:'input_frequency_hz',width:'width_mm',mounting:'mounting',DC_OK:'dc_ok',inputACRange:'input_voltage_v'};
const products=facts.models.map(m=>{
  const parameters={}, proofs={};
  for(const [key,field]of Object.entries(map)){
    let value=m[key];
    if(value==null||!m.evidence[key])continue;
    if(key==='DC_OK')value=value?'yes':'no';
    if(key==='inputACRange'){const r=value.at(-1);value={min:r.min,max:r.max};}
    if(key==='inputFrequency')value={min:value.min,max:value.max};
    if(key==='mounting')value=value==='DIN'?'din':value;
    parameters[field]=value;proofs[field]=evidence(m.evidence[key]);
  }
  parameters.input_type='AC';proofs.input_type=evidence(m.evidence.inputACRange);
  parameters.output_type='DC';proofs.output_type=evidence(m.evidence.outputVoltage);
  const p=m.continuousPowerProfile;
  if(p){parameters.temperature_c={min:p.points[0].temperatureC,max:p.points.at(-1).temperatureC};proofs.temperature_c=evidence(p.evidence);}
  if(m.peakPowerDuration?.powerW!=null&&m.evidence.peakPowerDuration){
    parameters.peak_power_w=m.peakPowerDuration.powerW;parameters.peak_duration_s=m.peakPowerDuration.maxSeconds;
    proofs.peak_power_w=evidence(m.evidence.peakPowerDuration);proofs.peak_duration_s=evidence(m.evidence.peakPowerDuration);
  }
  const conditions=[...(p?.conditionsEvidence??[]),m.evidence.installationClearances,m.evidence.altitude].filter(Boolean).map(evidence);
  if(p?.clearancesMm){
    Object.assign(parameters,{orientation:p.orientation,altitude_m:p.maxAltitudeM,top_clearance_mm:p.clearancesMm.top,bottom_clearance_mm:p.clearancesMm.bottom,side_clearance_mm:Math.max(p.clearancesMm.side,m.installation?.adjacentHeatSourceSideMm??0)});
    proofs.orientation=evidence(p.conditionsEvidence?.find(e=>e.note?.includes('terminals'))??p.evidence);
    proofs.altitude_m=evidence(m.evidence.altitude??p.evidence);
    for(const field of ['top_clearance_mm','bottom_clearance_mm','side_clearance_mm'])proofs[field]=evidence(m.evidence.installationClearances??p.evidence);
  }
  return {id:m.model,name:`${m.brand} ${m.model}`,manufacturer:m.brand,family:m.family,
    description:`${m.model}；官方额定参数。${m.ratingClass?'额定类别：'+m.ratingClass+'。':''}${(m.notes??[]).join(' ')} ${p?.evidence?.method==='visual-graph-reading'?'温度曲线由官方图读取，输入与温度曲线组合为工程推断。':''}`,
    parameters,evidence:proofs,...(m.mechanicalToleranceMm?{widthToleranceMm:m.mechanicalToleranceMm.value}:{}),
    ...(p?.clearancesMm?{continuousPowerProfile:{...evidence(p.evidence),basis:'rated_continuous',points:p.points,inputMinV:p.inputMinV,inputMaxV:p.inputMaxV,orientation:p.orientation,maxAltitudeM:p.maxAltitudeM,clearancesMm:{...p.clearancesMm,side:Math.max(p.clearancesMm.side,m.installation?.adjacentHeatSourceSideMm??0)},conditionsEvidence:conditions}}:{})};
});
const sources=facts.sources.map(s=>{const h=manifest.sources.find(h=>h.sourceId===s.sourceId);if(!h)throw Error('Manifest missing');return {id:s.sourceId,title:`${s.brand} ${s.sourceId} 官方规格书`,version:s.version,location:`PDF共${h.pages}页；参数索引保留逐项PDF页码（从1开始）`,url:s.url,file:`../${s.pdfPath}`,sha256:h.sha256};});
for(const [version,subset]of [['V1',products.filter(p=>p.manufacturer==='MEAN WELL')],['V2',products]]){
  const used=new Set(subset.flatMap(p=>Object.values(p.evidence).map(e=>e.sourceId)));
  const catalog={schemaVersion:2,dataset:'公开工业控制柜电源资料库',version:`${version}-2026-10-09`,demo:false,sources:sources.filter(s=>used.has(s.id)),products:subset};
  await fs.writeFile(path.join(root,`snapshots/catalog.${version.toLowerCase()}.json`),JSON.stringify(catalog,null,2)+'\n');
  const summary=subset.map(p=>({model:p.id,...p.parameters,widthToleranceMm:p.widthToleranceMm,continuousPowerProfile:p.continuousPowerProfile,sourceVersion:sources.find(s=>s.id===p.evidence.output_voltage_v.sourceId)?.version}));
  await fs.writeFile(path.join(root,`snapshots/summary.${version.toLowerCase()}.json`),JSON.stringify(summary,null,2)+'\n');
}
await fs.copyFile(path.join(root,'snapshots/catalog.v2.json'),path.join(root,'snapshots/catalog.active.json'));
await fs.copyFile(path.join(root,'snapshots/summary.v2.json'),path.join(root,'snapshots/summary.active.json'));
export const engineeringText=(load,temp)=>`输出电压：24VDC；输入电压：176–264VAC；输入频率：50–60Hz；安装方式：导轨；本体宽度≤65mm；DC OK继电器：有；持续负载：${load}W；设计裕量：20%；环境温度：${temp}℃；安装姿态：垂直且输入端子朝下；海拔：1000m；上方间距：50mm；下方间距：40mm；侧面间距：15mm。`;
const cases=[{id:'initial',title:'初次选型',snapshot:'v1',loadW:180,tempC:25},{id:'changed',title:'工况变化',snapshot:'v1',loadW:300,tempC:55},{id:'expanded',title:'资料库扩充',snapshot:'v2',loadW:300,tempC:55}];
const promptBase=`这是工业控制柜电源选型演示。真实采购背景为中国煤科重庆研究院2025-04-08公告中的SDR-240-24。下面的负载、尺寸和环境是演示工程需求，未出现在采购原文。\n资料库位于 D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json。它提供参数索引、版本、逐项原文与页码，来源PDF和检索文本位于 D:/VisualBoard/dsh-megmeet/success-demo/materials/。请以本轮快照为准，核对原件。可先读取 D:/VisualBoard/dsh-megmeet/success-demo/snapshots/summary.active.json 快速筛选，再读取入选和关键排除产品的页码证据。\n连续需求按持续负载×1.2计算。分别核验额定连续能力、温度降额、限时峰值、输入范围、频率、导轨、本体宽度含已知公差、DC OK继电器、安装姿态、间距和海拔。资料缺失为待确认。额定连续筛查不以PowerBoost或限时峰值替代。\n中文采用借鉴STE的清晰表达原则：短句、统一术语、明确责任人。不标注为ASD-STE100正式合规。\n使用同样六部分报告：1.结论（推荐型号/适用工况/下一步）；2.需求表（数值/单位/硬条件/原文）；3.候选表（满足/不满足/待确认）；4.计算依据；5.资料来源（可点击厂家版本/PDF/页码/快照SHA256）；6.待确认事项。报告中应有结构化表格。候选至少分析SDR-240-24与SDR-480-24；扩库后也分析CP20.241-R2。可用工具保存报告时，请返回可点击入口。请仅操作本演示目录，保留失败信息。\n`;
for(const c of cases){c.text=engineeringText(c.loadW,c.tempC);const prompt=promptBase+`\n当前步骤：${c.title}。资料库：${c.snapshot.toUpperCase()}。\n${c.text}\n`+(c.id==='expanded'?'保持上一步工程需求。资料库刚加入PULS官方原件。重新读取资料库，说明候选和版本发生了什么变化。':'请完成本轮选型。');await fs.writeFile(path.join(root,`prompts/${c.id}.txt`),prompt);c.promptSHA256=createHash('sha256').update(prompt).digest('hex');
  const catalog=await loadCatalog(path.join(root,`snapshots/catalog.${c.snapshot}.json`));
  const analysis=searchProducts(catalog,parseRequirements(c.text),{limit:50,includeIncompatible:true});
  if(analysis.requirements.unresolved.length)throw Error(JSON.stringify(analysis.requirements.unresolved));
  const report=buildSolutionReport(catalog,analysis,c.text,c.title);
  const files=await exportReport(report,path.join(root,'reports'));
  c.report={...files,markdown:undefined};c.catalogRevision=catalog.revision;c.qualified=report.conclusion.qualified;
  await fs.writeFile(path.join(root,`reports/${c.id}.json`),JSON.stringify(report,null,2)+'\n');
}
await fs.writeFile(path.join(root,'scenarios.json'),JSON.stringify(cases,null,2)+'\n');
const baseSkill=`---\nname: power-selection\ndescription: 工业控制柜电源选型、工况变更或资料库扩充时，核对连续功率、降额、尺寸与来源版本，输出六部分中文复核报告。\n---\n\n读取用户的本轮工程需求。读取 D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json，固定资料库版本和SHA256。来源PDF与TXT在 D:/VisualBoard/dsh-megmeet/success-demo/materials/。\n\n1. 保留每个硬条件及用户原文。连续需求为持续负载×1.2。\n2. 逐项比对全库型号。核对原件页码。DC OK指示灯不证明有继电器。资料缺失标为待确认。\n3. 连续能力使用额定温度曲线。只有输入、温度、安装姿态、海拔和间距符合曲线前提时，才能判为满足。图中分段按线性插值。峰值与PowerBoost另列。已知宽度公差按上界计算。\n4. 资料库变化时重新读取和校验。保存当轮快照、结果及来源哈希。\n5. 中文短句、固定术语。报告固定为结论、需求表、候选表、计算依据、资料来源、待确认事项。表格状态用满足/不满足/待确认。版本链接指向原件的绝对路径。\n6. 明确工程师下一步确认安装与接线，采购下一步确认价格、库存与交期。完成条件是结论、逐项证据和版本一致。\n`;
await fs.writeFile(path.join(root,'skills/b/power-selection/SKILL.md'),baseSkill);
const cli=path.resolve(root,'../lib/cli.js').replaceAll('\\','/');
await fs.writeFile(path.join(root,'skills/d/power-selection/SKILL.md'),baseSkill+`\n共用校验程序位于 ${cli}。它与原生插件调用同一引擎。PowerShell示例：\n\nnode '${cli}' --catalog 'D:/VisualBoard/dsh-megmeet/success-demo/snapshots/catalog.active.json' --report-dir './reports' --max-candidates 3 --command info\n\n把本轮工程需求原文写入本会话的唯一文本文件。每条CLI命令都加 --max-candidates 3，和原生插件采用相同候选返回上限。使用 --command search --text-file 文件，然后以返回的catalogRevision调用 --command export --text-file 文件 --expected-revision SHA256。CLI生成相同JSON、Markdown和HTML。参数路径先通过Resolve-Path获得绝对路径。保留所有结果，回报报告入口。\n`);
const common=[{id:'agent-default-model',config:{provider:'deepseek-account',model:'deepseek-flash',reasoningEffort:'high'}},{id:'llm-deepseek-account',config:{thinking:'enabled',reasoningEffort:'high',maxTokens:16000}},{id:'system-prompt',config:{personaPrefix:'你是工业控制柜电源选型辅助助手。依据本轮公开资料和工程需求，输出可复核的六部分中文报告。',personaSuffix:''}},{id:'approval',config:{policy:'never'}},{id:'permission',config:{presets:{'demo-workspace':{sandbox:'workspace-write',approval:'never'}},defaultPreset:'demo-workspace'}},{id:'sandbox-policy',config:{mode:'workspace-write',workspaceRoot:root.replaceAll('\\','/')}}];
for(const id of ['tool-plugin-manager','tool-subagent-control','tool-subagent-list-agents','tool-subagent','tool-subagent-fork','tool-workflow','tool-todo','tool-goal','tool-ralph','tool-web','agent-instructions','session-title-llm','tool-bash','tool-jobs'])common.push({id,disabled:true});
common.push({id:'tool-fs',disabled:false},{id:'tool-fs-search',disabled:false},{id:'tool-pwsh',disabled:false});
for(const arm of ['a','b','c','d']){
  const patch=[...common,{id:'skill-filesystem',disabled:!['b','d'].includes(arm),config:{includeDefaultRoots:false,customSkillDirs:[path.join(root,`skills/${arm}`).replaceAll('\\','/')],watch:false}},{id:'tool-skill',disabled:!['b','d'].includes(arm)}];
  if(arm==='c')patch.push({insert:[{id:'megmeet-product-assistant',name:path.resolve(root,'../lib/index.js').replaceAll('\\','/'),config:{catalogPath:path.join(root,'snapshots/catalog.active.json').replaceAll('\\','/'),maxCandidates:3,maxInputChars:60000,reportDirectory:path.join(root,'records/plugin-reports').replaceAll('\\','/')}}]});
  await fs.writeFile(path.join(root,`configs/${arm}.patch.yml`),JSON.stringify(patch,null,2)+'\n');
}
await fs.writeFile(path.join(root,'DESIGN.md'),'# 演示页设计\n\n受众：业务与技术负责人。首屏展示工程需求变化如何改变选型结论。\n\n色彩：白色#ffffff、蓝灰#f0f4f8、深蓝#183b58、通过绿#137058、排除红#b52828、待确认棕#886024。状态同时使用文字。\n字体：微软雅黑显示标题，等宽数字只用于工程参数。\n布局：左侧三个业务步骤，右侧结论与两张工程图。下方展示证据矩阵、真实对比和原件索引。移动端按顺序堆叠。所有内容左对齐。\n原则：突出216W到360W的变化和63mm到48mm的选型证据。使用真实已保存结果，不在浏览器中重新计算选型。禁用脚本时保留全部结论与图表。\n');
console.log(JSON.stringify(cases.map(c=>({id:c.id,qualified:c.qualified,revision:c.catalogRevision})),null,2));
