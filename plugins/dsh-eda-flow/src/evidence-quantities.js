// This is a narrow evidence check, not a semantic datasheet validator. It
// catches newly invented electrical quantities even when a quotation exists.
// It never obtains values from reference CAD or from uncited page text.
const scales = {p:1e-12,n:1e-9,u:1e-6,'µ':1e-6,'μ':1e-6,m:1e-3,'':1,k:1e3,K:1e3,M:1e6,G:1e9,T:1e12};
const number = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
const quantity = new RegExp(`(?<![\\w.])(${number})\\s*(?:(?:[-–~]|to|至)\\s*(${number})\\s*)?([pnumkKMGTµμ]?)\\s*(Ohms?|ohms?|Ω|欧姆|F|V|A|W|Hz|s)(?![A-Za-z])`, 'gu');

export function electricalQuantities(text) {
  const rows=[];
  for (const match of String(text || '').normalize('NFKC').matchAll(quantity)) {
    const unit=/^(?:ohms?|Ω|欧姆)$/i.test(match[4])?'ohm':match[4];
    for (const raw of [match[1],match[2]].filter(value=>value!==undefined)) {
      const value=Number(raw)*scales[match[3]];
      if(Number.isFinite(value))rows.push({text:match[0].trim(),unit,value,key:`${unit}:${Number(value.toPrecision(12))}`});
    }
  }
  return rows;
}

export function unsupportedQuantities(statement, citations) {
  const supported=new Set((citations||[]).flatMap(c=>electricalQuantities(c.quote)).map(q=>q.key));
  return [...new Set(electricalQuantities(statement).filter(q=>!supported.has(q.key)).map(q=>q.text))];
}
