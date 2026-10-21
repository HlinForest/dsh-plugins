// Enforce published source facts before a self-consistent wrong circuit can freeze.
export function validateSourceInventory(design,evidence=[]){
 const expected=evidence.filter(r=>r.objectRole&&r.reference&&Array.isArray(r.pins));
 if(!expected.length)return ['旧模拟资料缺少完整器件与装配记录，不能作为当前显示板验收依据。请新建显示板演示；旧输入和产物保留。'];
 const errors=[],actual=new Map((design?.components||[]).map(c=>[c.ref,c]));
 const complete=expected.every(r=>r.sourceType!=="model-specification-fact");
 if(complete&&actual.size!==expected.length)errors.push(`资料要求${expected.length}个对象（含工艺对象），设计提供${actual.size}个。`);
 for(const row of expected){
  const c=actual.get(row.reference);
  if(!c){errors.push(`缺少资料对象：${row.reference}`);continue;}
  for(const key of ['value','dnp','in_bom','on_board','objectRole','originalFootprint','materialCode','materialDescription','assemblyType'])if(key in row&&c[key]!==row[key])errors.push(`资料不一致：${row.reference}.${key}`);
  const symbolId=row.symbolId||evidence.find(r=>r.binding===row.reference&&r.symbolId&&r.appearance)?.symbolId;
  if(symbolId&&c.librarySymbol!==symbolId)errors.push(`资料外观符号不一致：${row.reference} 应使用 ${symbolId}`);
  const pins=ps=>JSON.stringify((ps||[]).map(p=>[p.number,p.name,p.type]).sort((a,b)=>a[0].localeCompare(b[0])));
  if(pins(c.pins)!==pins(row.pins))errors.push(`资料引脚不一致：${row.reference}`);
 }
 for(const ref of actual.keys())if(complete&&!expected.some(r=>r.reference===ref))errors.push(`资料未定义的替代器件：${ref}`);
 return errors;
}
