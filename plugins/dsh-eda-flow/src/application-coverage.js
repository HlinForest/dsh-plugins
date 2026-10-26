import {createHash} from 'node:crypto';
import {documentEvidence} from './inline-evidence.js';
import {electricalQuantities} from './evidence-quantities.js';

const compact=s=>String(s||'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const passiveContext=/电容|电阻|上拉|下拉|去耦|旁路|capacitor|capacitance|resistor|resistance|decoupl|bypass|pull[- ]?(?:up|down)/iu;
const quantities=s=>electricalQuantities(s).filter(q=>q.unit==='F'||q.unit==='ohm');
const keys=s=>new Set(quantities(s).map(q=>q.key));

// Minimum source coverage, not a full semantic datasheet validator. The
// design may reject a recommendation later with a reason; extraction must
// not erase its explicit value or replace it with "not specified".
export function applicationCandidates(inputs={}){
  const sources=documentEvidence(inputs);
  return sources.flatMap(source=>{
    // Table records supplement the same original page. Do not make the
    // model repeat every fact merely to cover its two representations.
    if(source.sourceType==='pdf-table-extraction'&&sources.some(s=>s.sourceType==='pdf-text-extraction'&&s.sourceSha256===source.sourceSha256&&s.page===source.page))return [];
    return String(source.content||'').split(/[。！？!?；;]|\.(?=\s+[A-Z])/u).flatMap((value,index)=>{
      const excerpt=value.trim();if(!passiveContext.test(excerpt))return [];
      const found=[...new Map(quantities(excerpt).map(q=>[q.key,q])).values()];
      if(!found.length)return [];
      return [{id:'application-'+createHash('sha256').update(JSON.stringify([source.id,index,excerpt])).digest('hex').slice(0,16),
        sourceId:source.id,document:source.document,page:source.page,excerpt,quantities:found}];
    });
  });
}

export function applicationCoverage(guidance,inputs={}){
  const sources=new Map(documentEvidence(inputs).map(s=>[s.id,s]));
  return applicationCandidates(inputs).map(candidate=>{
    const source=sources.get(candidate.sourceId);
    const coveredBy=new Set();
    const missing=candidate.quantities.filter(quantity=>!guidance.some(g=>{
      if(!keys(g.statement).has(quantity.key))return false;
      const matched=(g.citations||[]).some(c=>{
        if(!keys(c.quote).has(quantity.key))return false;
        if(c.sourceId===candidate.sourceId){
          const a=compact(candidate.excerpt),b=compact(c.quote);
          if(a.includes(b)||b.includes(a))return true;
          // A valid quotation may start inside this clause and end in the
          // next one. Compare its source interval, not only whole strings.
          const body=compact(source.content),startA=body.indexOf(a),startB=body.indexOf(b);
          if(startA<0||startB<0)return false;
          const overlap=body.slice(Math.max(startA,startB),Math.min(startA+a.length,startB+b.length));
          return overlap.includes(compact(quantity.text));
        }
        const other=sources.get(c.sourceId);
        return other?.sourceType==='pdf-table-extraction'&&source?.sourceSha256&&
          source.sourceSha256===other.sourceSha256&&source.page===other.page&&passiveContext.test(c.quote);
      });
      if(matched)coveredBy.add(g.id);return matched;
    }));
    return {...candidate,covered:missing.length===0,missingQuantities:missing,coveredBy:[...coveredBy].filter(Boolean)};
  });
}

export function assertApplicationCoverage(guidance,inputs){
  const missing=applicationCoverage(guidance,inputs).filter(row=>!row.covered);
  if(missing.length)throw Error('规格书已有阻容应用数值尚未提取为带引用的 guidance：'+missing.slice(0,12).map(r=>
    `${r.document||r.sourceId} p${r.page??'正文'}: ${r.missingQuantities.map(q=>q.text).join('、')}（${r.excerpt.slice(-1200)}）`).join('；')+
    '。请记录这些资料事实及适用条件。应用示例不等于本项目必须采用；是否采用在第三步说明，不可概括成资料没有给数值。');
}
