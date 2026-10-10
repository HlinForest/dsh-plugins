import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateReport, loadCatalog, parseRequirements, searchProducts, validateCandidate, validateCatalog } from '../lib/domain.js';

const catalog = await loadCatalog('');
const request = await readFile(new URL('../examples/requirements.demo.txt', import.meta.url), 'utf8');

test('完整需求得到一个通过已列条件产品和一个缺失效率资料产品', () => {
  const r = parseRequirements(request);
  assert.equal(r.constraints.length, 11);
  assert.deepEqual(r.unresolved, []);
  const result = searchProducts(catalog, r);
  assert.equal(result.demo, true);
  assert.equal(result.humanReviewRequired, true);
  assert.equal(result.totalEvaluated, 5);
  assert.equal(result.excludedIncompatible, 3);
  assert.deepEqual(result.candidates.map(c => [c.productId, c.status]), [['DEMO-PS-A', 'matches_listed_constraints'], ['DEMO-PS-C', 'needs_confirmation']]);
  assert.equal(result.candidates[1].checks.find(c => c.field === 'efficiency_pct').status, 'unknown');
});

test('单位、带负号区间、英语标签和上下限比较可正确换算', () => {
  const cases = [
    ['输出功率：不低于3kW', 'output_power_w', 'gte', 3000],
    ['output power: >= 0.003MW', 'output_power_w', 'gte', 3000],
    ['输出电压：48000mV', 'output_voltage_v', 'eq', 48],
    ['效率：不超过96%', 'efficiency_pct', 'lte', 96],
    ['效率：大于等于96%', 'efficiency_pct', 'gte', 96],
  ];
  for (const [text, field, operator, value] of cases) {
    const r = parseRequirements(text);
    assert.deepEqual(r.unresolved, [], text);
    assert.equal(r.constraints[0].field, field);
    assert.equal(r.constraints[0].operator, operator);
    assert.equal(r.constraints[0].value, value);
  }
  const c = parseRequirements('工作温度：-20-60℃').constraints[0];
  assert.equal(c.min, -20);
  assert.equal(c.max, 60);
});

test('VAC/VDC 的输入类型不会被电压数字掩盖', () => {
  const r = parseRequirements('输入电压：180–264VDC');
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.constraints.find(c => c.field === 'input_type').textValue, 'DC');
  assert.equal(validateCandidate(catalog, r, 'DEMO-PS-A').status, 'incompatible');
});

test('紧贴数字的DC前缀也必须参与输入类型校验', () => {
  const r = parseRequirements('输入电压：DC180–264V');
  assert.deepEqual(r.unresolved, []);
  assert.equal(r.constraints.find(c => c.field === 'input_type').textValue, 'DC');
  assert.equal(validateCandidate(catalog, r, 'DEMO-PS-A').status, 'incompatible');
});

test('严格不等式、复合工况、缺失单位和未支持需求保持待确认', () => {
  for (const text of ['效率：>96%', '效率：96%以上且在50%负载', '输出功率：3000', '输出功率：3000mW', '输入电压：1MV', '工作温度：60–20℃', '效率：101%', '通信协议：CAN或RS485', '认证：不需要UL', '尺寸小于200×100×50mm', '输出功率：3kW持续，6kW峰值']) {
    const r = parseRequirements(text);
    assert.equal(r.constraints.length, 0, text);
    assert.ok(r.unresolved.length > 0, text);
    assert.equal(validateCandidate(catalog, r, 'DEMO-PS-A').status, 'needs_confirmation', text);
  }
});

test('工作区间必须完全覆盖，不能仅检查交集或一个标称值', () => {
  const r = parseRequirements('输入电压：180–264V');
  assert.equal(validateCandidate(catalog, r, 'DEMO-PS-D').checks[0].status, 'fail');
  const copy = structuredClone(catalog);
  copy.products[0].parameters.input_voltage_v = 220;
  assert.equal(validateCandidate(copy, r, 'DEMO-PS-A').checks[0].status, 'unknown');
});

test('有参数但没有依据时不能判为通过', () => {
  const copy = structuredClone(catalog);
  delete copy.products[0].evidence.output_power_w;
  validateCatalog(copy);
  const c = validateCandidate(copy, parseRequirements('输出功率：≥3000W'), 'DEMO-PS-A');
  assert.equal(c.checks[0].status, 'unknown');
  assert.equal(c.status, 'needs_confirmation');
});

test('协议与认证精确匹配，不能由子串推断兼容', () => {
  for (const text of ['通信协议：CAN-FD', '认证：UL62368-1']) {
    const c = validateCandidate(catalog, parseRequirements(text), 'DEMO-PS-A');
    assert.equal(c.checks[0].status, 'fail');
  }
  assert.equal(validateCandidate(catalog, parseRequirements('通信协议：rs-485'), 'DEMO-PS-A').checks[0].status, 'pass');
});

test('未知条件不会被匹配分数隐藏，空需求不产生确定推荐', () => {
  const r = parseRequirements('输出功率：≥3000W\n防护等级：IP67');
  const c = validateCandidate(catalog, r, 'DEMO-PS-A');
  assert.equal(c.score, 100);
  assert.equal(c.status, 'needs_confirmation');
  assert.deepEqual(r.unresolved, ['防护等级：IP67']);
  assert.equal(validateCandidate(catalog, parseRequirements('客户需要一个电源'), 'DEMO-PS-A').score, 0);
});

test('补充结构化约束必须引用原文，不能覆盖自动提取的硬约束', () => {
  assert.throws(() => parseRequirements('功率至少3千瓦', [{ field: 'output_power_w', operator: 'gte', value: 3000, sourceQuote: '伪造原文' }]), /逐字/);
  const parsed = parseRequirements('功率至少3千瓦', [{ field: 'output_power_w', operator: 'gte', value: 3000, sourceQuote: '功率至少3千瓦' }]);
  assert.equal(parsed.constraints[0].origin, 'provided');
  assert.deepEqual(parsed.unresolved, []);
  const r = parseRequirements('输出功率：≥3000W', [{ field: 'output_power_w', operator: 'gte', value: 1000, hard: false, sourceQuote: '输出功率：≥3000W' }]);
  assert.equal(validateCandidate(catalog, r, 'DEMO-PS-B').status, 'incompatible');
});

test('非法补充约束、来源、重复产品和过长需求被拒绝', () => {
  for (const c of [
    { field: 'output_power_w', operator: 'gte', value: -1, sourceQuote: '需求' },
    { field: 'output_power_w', operator: 'range', min: 3, max: 1, sourceQuote: '需求' },
    { field: 'protocols', operator: 'gte', value: 3, sourceQuote: '需求' },
    { field: 'output_power_w', operator: 'eq', value: NaN, sourceQuote: '需求' },
  ]) assert.throws(() => parseRequirements('需求', [c]));
  assert.throws(() => parseRequirements('x'.repeat(101), [], 100), /最多/);
  const bad = structuredClone(catalog);
  bad.products[0].evidence.output_power_w.sourceId = 'missing';
  assert.throws(() => validateCatalog(bad), /不存在的来源/);
  const duplicate = structuredClone(catalog);
  duplicate.products.push(duplicate.products[0]);
  assert.throws(() => validateCatalog(duplicate), /重复产品/);
  assert.throws(() => searchProducts(catalog, parseRequirements('需求'), { limit: 0 }), /limit/);
});

test('报告保留演示标识、缺失资料、未解析要求和来源版本', () => {
  const result = searchProducts(catalog, parseRequirements(request + '安装尺寸需要确认'));
  const report = generateReport(result);
  assert.match(report.markdown, /演示数据/);
  assert.match(report.markdown, /待确认/);
  assert.match(report.markdown, /安装尺寸需要确认/);
  assert.match(report.markdown, /DEMO-1/);
  assert.match(report.markdown, /非.*置信度|不是置信度|不表示置信度/);
  assert.match(report.markdown, /工程师/);
});

test('需求与资料中的HTML、Markdown链接和表格分隔符不会成为报告结构', () => {
  const r = parseRequirements('输出功率：3000W\n<script>alert(1)</script> | [链接](javascript:alert(1))');
  const report = generateReport(searchProducts(catalog, r), '<img src=x onerror=alert(1)>');
  assert.doesNotMatch(report.markdown, /<script>|<img/);
  assert.match(report.markdown, /&lt;script&gt;/);
  assert.ok(report.markdown.includes('\\|'));
  assert.ok(report.markdown.includes('\\[链接\\]'));
});

test('管理员真实产品库可以从绝对路径加载，错误JSON不会回退为演示库', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-megmeet-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'catalog.json');
  const real = structuredClone(catalog);
  real.demo = false;
  real.dataset = '测试专用自建库';
  await writeFile(file, JSON.stringify(real));
  assert.equal((await loadCatalog(file)).demo, false);
  await writeFile(file, '{broken');
  await assert.rejects(loadCatalog(file), SyntaxError);
  await assert.rejects(loadCatalog('relative.json'), /绝对路径/);
});

test('同一实例的并发分析不会混合不同客户的需求', async () => {
  const results = await Promise.all(['输出功率：≥3000W', '输出功率：≤1500W'].map(async text => searchProducts(catalog, parseRequirements(text))));
  assert.ok(results[0].candidates.every(p => p.productId !== 'DEMO-PS-B'));
  assert.deepEqual(results[1].candidates.map(p => p.productId), ['DEMO-PS-B']);
});
