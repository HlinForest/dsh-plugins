import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog, parseRequirements, validateCandidate, validateCatalog } from '../lib/domain.js';
test('双路同时输出与单组输出是明确硬性不匹配，其他复杂条件继续保留',async()=>{
  const catalog=await loadCatalog('');
  catalog.products[0].parameters.output_channels=1;
  catalog.products[0].evidence.output_channels={sourceId:catalog.sources[0].id,quote:'单组输出'};
  validateCatalog(catalog);
  const requirements=parseRequirements('输出电压：24V和12V，双路同时输出\n各路满载电流：24V输出20A，12V输出6A');
  assert.equal(requirements.constraints.find(c=>c.field==='output_channels').value,2);
  assert.ok(requirements.unresolved.length>=2);
  const candidate=validateCandidate(catalog,requirements,catalog.products[0].id);
  assert.equal(candidate.status,'incompatible');
  assert.equal(candidate.checks.find(c=>c.field==='output_channels').status,'fail');
});
test('未披露路数、否定与任选表达不能推定双路已满足',async()=>{
  const catalog=await loadCatalog('');
  assert.equal(validateCandidate(catalog,parseRequirements('双路同时输出'),catalog.products[0].id).checks[0].status,'unknown');
  for(const text of ['不需要双路输出','单路或双路输出均可','可选双路输出']) {
    const r=parseRequirements(text);
    assert.equal(r.constraints.filter(c=>c.field==='output_channels').length,0,text);
    assert.ok(r.unresolved.length>0);
  }
});
test('输出路数只能是正整数，数值标签按路解析',()=>{
  assert.equal(parseRequirements('输出路数：2路').constraints[0].value,2);
  for(const text of ['输出路数：0路','输出路数：1.5路','输出路数：2']) assert.ok(parseRequirements(text).unresolved.length>0);
});
