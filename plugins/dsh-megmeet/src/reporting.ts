import { mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { FIELDS, generateReport, sourceLinks } from './domain.js';
import type { Catalog, Candidate, SearchResult, Source } from './domain.js';

export type SolutionReport = {
  schemaVersion: 1; reportId: string; generatedAt: string; title: string; requestText: string;
  language: 'zh-CN'; writingStyle: string;
  catalog: { dataset: string; version: string; revision: string; demo: boolean };
  analysis: SearchResult; sources: Source[];
  catalogSnapshot: Catalog;
  conclusion: { qualified: string[]; pending: string[]; excluded: number; scope: string };
  nextActions: string[];
};
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
const cell = (value: unknown) => String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/&/g,'&amp;').replace(/[\\`*_[\]{}()|#!]/g,'\\$&').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const STATUS = { matches_listed_constraints:'满足已列条件', needs_confirmation:'待确认', incompatible:'不满足' };
const CHECK = { pass:'满足', fail:'不满足', unknown:'待确认' };

export function buildSolutionReport(catalog: Catalog, analysis: SearchResult, requestText: string, title = '控制柜电源选型复核'): SolutionReport {
  if (title.length > 200 || !title.trim()) throw new Error('报告标题必须为1–200字符。');
  const qualified = analysis.candidates.filter(c => c.status === 'matches_listed_constraints').map(c => c.productId);
  const pending = analysis.candidates.filter(c => c.status === 'needs_confirmation').map(c => c.productId);
  const used = new Set(analysis.candidates.flatMap(c => c.checks.flatMap(k => k.source ? [k.source.id] : [])));
  return {
    schemaVersion:1, reportId:randomUUID(), generatedAt:new Date().toISOString(), title, requestText, language:'zh-CN',
    writingStyle:'借鉴STE的清晰表达原则。中文报告不声明ASD-STE100正式合规。',
    catalog:{ dataset:catalog.dataset, version:catalog.version, revision:catalog.revision ?? '', demo:catalog.demo }, analysis,
    sources:catalog.sources.filter(s => used.has(s.id)), catalogSnapshot:catalog,
    conclusion:{ qualified, pending, excluded:analysis.excludedIncompatible, scope:'仅核验已列条件和资料工况。安装间距独立于本体宽度。额定连续筛查不使用限时峰值或PowerBoost替代。' },
    nextActions:[...analysis.requirements.unresolved.map(s => `工程师确认：${s}`), '工程师按手册核对安装、接线和应用条件。', '工程师复核图读降额曲线与输入曲线的组合推断，并区分额定、标称与保证下限。', '采购确认价格、库存和交期。这些信息未接入。'],
  };
}

export function reportMarkdown(report: SolutionReport): string {
  const r = report.analysis;
  const shown = r.candidates.filter(c => c.status !== 'incompatible').slice(0,3);
  const excluded = r.candidates.filter(c => c.status === 'incompatible').slice(0,5);
  const selected = [...shown, ...excluded];
  const usedSources = new Set(selected.flatMap(c => c.checks.flatMap(k => k.source ? [k.source.id] : [])));
  const lines = [`# ${cell(report.title)}`, '', report.writingStyle, '', '## 1. 结论', '',
    report.conclusion.qualified.length ? `满足已列条件：${report.conclusion.qualified.map(cell).join('、')}。` : '本资料库没有通过全部已列条件的产品。',
    report.conclusion.pending.length ? `待确认：${report.conclusion.pending.map(cell).join('、')}。` : '本轮没有待确认候选。',
    report.conclusion.scope, `资料库：${cell(report.catalog.version)}。快照：${report.catalog.revision.slice(0,12)}。报告：${report.reportId}。`,
    ...(report.catalog.demo ? ['**演示数据：产品和参数为虚构样例。**'] : []), '',
    '## 2. 需求表', '', '| 条件 | 要求 | 类型 | 原文 |', '| --- | --- | --- | --- |',
    ...r.requirements.constraints.map(c => {
      const expected = c.operator === 'range' ? `${c.min}–${c.max}${FIELDS[c.field].unit}` : `${({gte:'≥',lte:'≤',eq:'=',includes:'包含'})[c.operator]} ${c.textValue ?? c.value}${FIELDS[c.field].unit}`;
      return `| ${FIELDS[c.field].label} | ${expected} | ${c.hard?'硬条件':'偏好'} | ${cell(c.sourceQuote)}${c.origin === 'derived' ? '（按负载与裕量计算）' : ''} |`;
    }), '', '## 3. 候选表', '',
    `评估${r.totalEvaluated}个型号。满足${report.conclusion.qualified.length}个。待确认${report.conclusion.pending.length}个。排除${report.conclusion.excluded}个。`,
    '| 型号 | 结果 | 核对依据 |', '| --- | --- | --- |',
    ...selected.map(c => `| ${cell(c.productId)} | ${STATUS[c.status]} | ${cell(c.checks.filter(k => k.status !== 'pass').map(k => `${k.label}：${k.actual}，${k.reason}`).join('；') || '已列条件逐项通过')} |`), '',
  ];
  for (const c of shown) {
    lines.push(`### ${cell(c.productId)}核对表`, '', '| 条件 | 要求 | 资料值 | 结果 | 原件位置 |', '| --- | --- | --- | --- | --- |',
      ...c.checks.map(k => `| ${k.label} | ${cell(k.expected)} | ${cell(k.actual)} | ${CHECK[k.status]} | ${k.source ? `${cell(k.source.id)}，第${k.page ?? k.source.page ?? '见位置'}页；${cell(k.quote)}` : '资料缺失'} |`), '');
  }
  lines.push('## 4. 计算依据', '');
  for (const c of r.requirements.calculations ?? []) lines.push(`持续负载${c.loadW}W × (1 + ${c.marginPct}%) = 需要${c.requiredContinuousW}W额定连续能力。`);
  for (const c of selected) if (c.power) lines.push(`${cell(c.productId)}：额定${c.power.ratedW ?? '未知'}W；${c.power.temperatureC ?? '未明确'}℃下已核验连续能力${c.power.verifiedContinuousW ?? '未知'}W；峰值${c.power.peakW ?? '未披露'}W，持续${c.power.peakDurationS ?? '未披露'}s。`);
  lines.push('额定连续能力、限时峰值和PowerBoost分别记录。工作温度上限不证明全温满功率。', '', '## 5. 资料来源', '',
    ...report.sources.filter(s => usedSources.has(s.id)).map(s => `- ${sourceLinks(s).map(l => l.markdown).join(' · ') || cell(s.id)}：${cell(s.title)}；${cell(s.location)}。SHA256：${s.sha256??'未登记'}。`), '',
    '## 6. 待确认事项', '', ...report.nextActions.map(a => `- ${cell(a)}`));
  // Legacy consumers still receive the familiar score explanation, without treating it as a confidence score.
  lines.push('', '得分不表示置信度。任何未知条件都保持待确认。');
  return lines.join('\n');
}

function browserLink(source: Source, outputPath?: string): string {
  if (source.file && outputPath) return relative(dirname(outputPath), source.file).replace(/\\/g,'/').split('/').map(encodeURIComponent).join('/');
  return source.url ?? '';
}
export function reportHTML(report: SolutionReport, outputPath?: string): string {
  const candidates = report.analysis.candidates;
  const need = report.analysis.requirements.calculations?.[0]?.requiredContinuousW ?? report.analysis.requirements.constraints.find(c => c.field === 'output_power_w')?.value ?? 0;
  const maxPower = Math.max(need, ...candidates.flatMap(c => [c.power?.ratedW ?? 0, c.power?.peakW ?? 0, c.power?.verifiedContinuousW ?? 0]), 1);
  const widthLimit = report.analysis.requirements.constraints.find(c => c.field === 'width_mm')?.value;
  const maxWidth=Math.max(widthLimit??0,...candidates.map(c=>{const p=report.catalogSnapshot.products.find(p=>p.id===c.productId);return Number(p?.parameters.width_mm??0)+(p?.widthToleranceMm??0);}),1);
  const keyFields = ['output_voltage_v','output_power_w','width_mm','dc_ok','mounting','temperature_c'];
  const rows = candidates.map(c => `<tr data-model="${escape(c.productId.toLowerCase())}" data-status="${c.status}"><th>${escape(c.productId)}</th><td class="${c.status}">${STATUS[c.status]}</td>${keyFields.map(f => { const k=c.checks.find(k => k.field===f); return `<td class="${k?.status ?? 'unknown'}">${k ? `${CHECK[k.status]}<small>${escape(k.actual)}</small>` : '—'}</td>`; }).join('')}</tr>`).join('');
  const focus = candidates.filter(c => ['SDR-240-24','SDR-480-24','CP20.241-R2'].includes(c.productId));
  const charts = focus.map(c => {
    const p=c.power; const values=[['额定',p?.ratedW],['已核验连续',p?.verifiedContinuousW],['限时峰值',p?.peakW]] as const;
    const bars=values.map(([label,value],i) => `<text x="0" y="${25+i*36}">${label}</text><rect x="100" y="${10+i*36}" width="${(value??0)/maxPower*380}" height="21" fill="${['#9ba9b1','#007f75','#ddb568'][i]}"/><text x="${105+(value??0)/maxPower*380}" y="${25+i*36}">${value??'未知'} W</text>`).join('');
    const width=c.checks.find(k=>k.field==='width_mm');
    const product=report.catalogSnapshot.products.find(p=>p.id===c.productId),nominal=Number(product?.parameters.width_mm??0),maximum=nominal+(product?.widthToleranceMm??0);
    const widthChart=`<svg viewBox="0 0 600 65" role="img" aria-label="本体宽度与上限比较"><text x="0" y="28">最大本体宽度</text><rect x="100" y="12" width="${maximum/maxWidth*380}" height="23" fill="${width?.status==='pass'?'#007f75':'#b53b36'}"/><text x="${105+maximum/maxWidth*380}" y="29">${maximum||'未知'} mm</text>${widthLimit?`<line x1="${100+widthLimit/maxWidth*380}" x2="${100+widthLimit/maxWidth*380}" y1="0" y2="48" stroke="#b53b36" stroke-dasharray="5 4"/><text x="${105+widthLimit/maxWidth*380}" y="60">上限${widthLimit} mm</text>`:''}</svg>`;
    return `<article class="chart"><h3>${escape(c.productId)}</h3><p>${STATUS[c.status]} · ${p?.temperatureC ?? '未明确'}℃</p><svg viewBox="0 0 600 125" role="img" aria-label="功率比较">${bars}<line x1="${100+need/maxPower*380}" x2="${100+need/maxPower*380}" y1="0" y2="119" stroke="#b53b36" stroke-dasharray="5 4"/><text x="${105+need/maxPower*380}" y="119">需求${need} W</text></svg>${widthChart}<p>本体宽度：${escape(width?.actual??'未知')}。上限：${widthLimit??'未规定'}mm。安装间距另计。</p>${p?.peakW ? `<p>峰值${p.peakW}W：${p.peakDurationS ?? '未披露'}s。连续需求使用额定曲线。</p>` : ''}</article>`;
  }).join('');
  const details=candidates.map(c=>`<details><summary>${escape(c.productId)} · ${STATUS[c.status]}</summary><table><thead><tr><th>条件</th><th>要求</th><th>资料值</th><th>结果</th><th>依据</th></tr></thead><tbody>${c.checks.map(k=>`<tr><th>${k.label}</th><td>${escape(k.expected)}</td><td>${escape(k.actual)}</td><td>${CHECK[k.status]}</td><td>${escape(k.quote)}<br>${escape(k.reason)}${k.source ? `<br>${escape(k.source.id)} · ${escape(k.source.location)}` : ''}</td></tr>`).join('')}</tbody></table></details>`).join('');
  const safeJSON=JSON.stringify(report).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(report.title)}</title><style>
*{box-sizing:border-box}body{margin:0;color:#18333b;background:#f5f7f6;font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1240px;margin:auto;padding:36px 28px}h1{font-size:30px;line-height:1.35}h2{border-top:2px solid #203f45;padding-top:20px;margin-top:36px}h3{margin:0 0 8px}p{margin:8px 0}a{color:#006f69}small{display:block;color:#5a6e75}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:9px 12px;border-bottom:1px solid #dce3e2;text-align:left;vertical-align:top;font-size:13px}thead{background:#e7eeec}th{white-space:nowrap}.scroll{overflow:auto}.hero,.chart{background:white;border:1px solid #d4dedb;padding:20px}.charts{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:14px}svg{width:100%;font:12px system-ui}details{margin:12px 0;padding:12px;background:#fff;overflow:auto}summary{cursor:pointer;font-weight:600}.pass,.matches_listed_constraints{color:#007f75}.fail,.incompatible{color:#b53b36}.unknown,.needs_confirmation{color:#8a630e}input,select{font:inherit;padding:8px;border:1px solid #9daea8;margin:10px 12px 10px 0;max-width:100%}.tag{color:#53706e;font-size:12px}@media(max-width:600px){main{padding:18px 14px}h1{font-size:23px}.charts{grid-template-columns:1fr}.hero{padding:15px}}
</style><main><p class="tag">资料库选型 · 可复核报告</p><h1>${escape(report.title)}</h1><p>${escape(report.writingStyle)}</p><section class="hero"><h2 style="border:0;margin-top:0;padding:0">1. 结论</h2><p>${report.conclusion.qualified.length ? `满足已列条件：${report.conclusion.qualified.map(escape).join('、')}` : '本快照没有通过全部已列条件的产品。'}</p><p>${escape(report.conclusion.scope)}</p><small>${escape(report.catalog.version)} · ${report.catalog.revision} · ${report.reportId}</small></section><h2>2. 需求与计算</h2><pre style="white-space:pre-wrap">${escape(report.requestText)}</pre>${(report.analysis.requirements.calculations??[]).map(c=>`<p><strong>${c.loadW}W × (1 + ${c.marginPct}%) = ${c.requiredContinuousW}W额定连续需求</strong></p>`).join('')}<h2>3. 候选核对矩阵</h2><label>筛选型号 <input id="filter" type="search" placeholder="例如 CP20"></label><label>结果 <select id="status"><option value="">全部</option><option value="matches_listed_constraints">满足</option><option value="needs_confirmation">待确认</option><option value="incompatible">不满足</option></select></label><p id="count">${candidates.length}个型号</p><div class="scroll"><table id="matrix"><thead><tr><th>型号</th><th>结论</th>${keyFields.map(f=>`<th>${FIELDS[f as keyof typeof FIELDS].label}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div><h2>4. 功率与尺寸</h2><p>绿色为本工况下已核验的额定连续能力。金色为限时峰值。红线为连续需求。未知值不画成已满足。</p><div class="charts">${charts}</div><h2>5. 资料与逐项证据</h2><ul>${report.sources.map(s=>`<li><a href="${escape(browserLink(s,outputPath))}">${escape(s.id)} · ${escape(s.version)}</a> · ${escape(s.title)} · ${escape(s.location)}${s.url ? ` · <a href="${escape(s.url)}">官网</a>` : ''}</li>`).join('')}</ul>${details}<h2>6. 待确认事项</h2><ul>${report.nextActions.map(a=>`<li>${escape(a)}</li>`).join('')}</ul><p class="tag">报告数据由校验引擎生成。结构化JSON与本页使用相同结果。</p></main><script id="report-data" type="application/json">${safeJSON}</script><script>const rows=[...document.querySelectorAll('#matrix tbody tr')];function filter(){const q=document.querySelector('#filter').value.toLowerCase(),s=document.querySelector('#status').value;let n=0;for(const r of rows){r.hidden=!r.dataset.model.includes(q)||(s&&r.dataset.status!==s);if(!r.hidden)n++;}document.querySelector('#count').textContent=n+'个型号';}document.querySelector('#filter').addEventListener('input',filter);document.querySelector('#status').addEventListener('change',filter);</script></html>`;
}

export async function exportReport(report: SolutionReport, directory: string): Promise<{ reportId:string; markdown:string; jsonPath:string; markdownPath:string; htmlPath:string; links:{ markdown:string; href:string }[] }> {
  if (!directory || !isAbsolute(directory)) throw new Error('报告目录必须由管理员配置为绝对路径。');
  await mkdir(directory,{recursive:true});
  const root=join(directory,`${report.generatedAt.replace(/[:.]/g,'-')}-${report.reportId}`);
  await mkdir(root);
  const jsonPath=join(root,'report.json'),markdownPath=join(root,'report.md'),htmlPath=join(root,'report.html');
  const markdown=reportMarkdown(report);
  await writeFile(jsonPath,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  await writeFile(markdownPath,markdown+'\n',{flag:'wx'});
  await writeFile(htmlPath,reportHTML(report,htmlPath),{flag:'wx'});
  const links=[['交互报告',htmlPath],['结构化JSON',jsonPath],['报告Markdown',markdownPath]].map(([label,file])=>{
    const href=sourceLinks({id:label,title:label,version:report.catalog.version,location:'导出报告',file})[0].href;
    return {href,markdown:`[${label}](${href})`};
  });
  return {reportId:report.reportId,markdown,jsonPath,markdownPath,htmlPath,links};
}

export function compactResult(result: SearchResult) {
  const sources=new Map<string,Source>();
  const candidates=result.candidates.map(c=>({...c,checks:c.checks.map(k=>{
    if(k.source)sources.set(k.source.id,k.source);
    return {...k,source:k.source ? {id:k.source.id,version:k.source.version,location:k.source.location} : null};
  })}));
  return {...result,candidates,sources:[...sources.values()].map(s=>({...s,links:sourceLinks(s)}))};
}
