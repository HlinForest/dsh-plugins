import {documentEvidence} from './inline-evidence.js';

const compact=value=>String(value||'').replace(/\s+/g,'').toLowerCase();
const units={mm:1,cm:10,um:.001,'µm':.001,'μm':.001,mil:.0254,inch:25.4,inches:25.4};
const dimensionPattern=/([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(mm|cm|[uµμ]m|mils?|inches|inch)\b/gi;
const dimensionContext=/脚距|孔径|焊盘|间距|中心距|节距|直径|长度|宽度|厚度|pitch|diameter|spacing|drill|pad|height|width|length|thickness/i;
export function dimensions(text){
  return [...String(text||'').matchAll(dimensionPattern)].map(m=>({value:Number(m[1]),unit:m[2].toLowerCase().replace(/mils$/,'mil'),raw:m[0]}));
}
const mm=d=>d.value*units[d.unit];
const equal=(a,b)=>Math.abs(mm(a)-mm(b))<1e-7;
const samePage=(a,b)=>a?.sourceSha256&&a.sourceSha256===b?.sourceSha256&&a.page===b.page;
// Only a matching raw row can connect the two representations. Equal values
// elsewhere on the same page are insufficient provenance.
const rowSupports=(table,excerpt,quote)=>(table.table?.rows||[]).some(row=>{
  const cells=row.map(compact).filter(Boolean);
  return cells.length>0&&cells.join('').includes(compact(excerpt))&&cells.every(cell=>compact(quote).includes(cell));
});

// Physical dimensions are sourced facts. They never become schematic XY or
// an automatically approved footprint. Coverage operates on original pages.
export function mechanicalCandidates(inputs={}){
  const sources=documentEvidence(inputs),byId=new Map(sources.map(s=>[s.id,s]));
  const candidates=sources.flatMap(source=>{
    const lines=String(source.content||'').split(/\r?\n/);
    return lines.flatMap((line,index)=>{
      if(!dimensions(line).length)return [];
      const excerpt=dimensionContext.test(line)?line:[lines[index-1]||'',line].join('\n');
      if(!dimensionContext.test(excerpt))return [];
      return dimensions(line).map(d=>({sourceId:source.id,document:source.document,page:source.page,excerpt,...d}));
    });
  });
  return candidates.filter(candidate=>{
    const source=byId.get(candidate.sourceId);
    if(source.sourceType!=='pdf-table-extraction')return true;
    return !candidates.some(original=>{
      const page=byId.get(original.sourceId);
      return page.sourceType==='pdf-text-extraction'&&samePage(page,source)&&equal(original,candidate)&&
        (compact(candidate.excerpt).includes(compact(original.excerpt))||rowSupports(source,original.excerpt,candidate.excerpt));
    });
  });
}

export function validateMechanicalFacts(facts,inputs){
  if(facts===undefined)return [];
  if(!Array.isArray(facts)||facts.length>100)throw Error('mechanicalFacts 必须是最多 100 条物理尺寸事实。');
  const evidence=documentEvidence(inputs);
  return facts.map(item=>{
    if(!item||Object.keys(item).some(k=>!['property','value','unit','description','citations'].includes(k))
      ||typeof item.property!=='string'||!item.property.trim()||/^(?:x|y|xy|rotation|position|placement)$/i.test(item.property)
      ||!Number.isFinite(item.value)||item.value<=0||!units[item.unit]
      ||!Array.isArray(item.citations)||!item.citations.length)throw Error('物理尺寸需要 property/value/unit/citations；不接受绘图坐标。');
    const citations=item.citations.map(c=>{
      const s=evidence.find(r=>r.id===c?.sourceId);
      if(!s||typeof c.quote!=='string'||compact(c.quote).length<8||!compact(s.content).includes(compact(c.quote)))throw Error('物理尺寸引用未匹配当前资料原文。');
      return {sourceId:c.sourceId,quote:c.quote,document:s.document,page:s.page,section:s.section};
    });
    if(!citations.some(c=>dimensions(c.quote).some(d=>equal(d,item))))throw Error('物理尺寸数值未由本条引用支持。');
    return {...item,citations};
  });
}

export function mechanicalCoverage(facts,inputs){
  const details=(facts||[]).flatMap(f=>f.mechanicalFacts||[]);
  const sources=new Map(documentEvidence(inputs).map(s=>[s.id,s]));
  return mechanicalCandidates(inputs).map(candidate=>({...candidate,covered:details.some(d=>equal(d,candidate)&&d.citations.some(c=>{
    if(c.sourceId===candidate.sourceId)return compact(c.quote).includes(compact(candidate.excerpt));
    const original=sources.get(candidate.sourceId),table=sources.get(c.sourceId);
    return original?.sourceType==='pdf-text-extraction'&&table?.sourceType==='pdf-table-extraction'&&
      samePage(original,table)&&rowSupports(table,candidate.excerpt,c.quote);
  }))}));
}
export function assertMechanicalCoverage(facts,inputs){
  const missing=mechanicalCoverage(facts,inputs).filter(r=>!r.covered);
  if(missing.length)throw Error('PDF 已有物理尺寸尚未保存到 componentFacts[].mechanicalFacts：'+missing.slice(0,12).map(r=>`${r.document} p${r.page}: ${r.raw}（${r.excerpt}）`).join('；')+'。保留局部尺寸与引用，不等同完整封装，不得概括成“没有尺寸”。');
}
