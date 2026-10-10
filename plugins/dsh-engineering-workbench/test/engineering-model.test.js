import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, suggestMappings, metric, number, reviewRules, calibrate, transform } from '../src/engineering/model.js';
const component = (id, ref, value = '10k') => ({ id, ref, value, libId: 'Device:R', footprint: 'R_0603', dnp: false, at: [10, 10], pins: [{ number: '1' }, { number: '2' }] });
const design = (prefix = 'a', ref = 'R1') => ({ components: [component(prefix, ref)], nets: [{ name: 'GND', nodes: [{ component: prefix, pin: '1' }] }, { name: 'VCC', nodes: [{ component: prefix, pin: '2' }] }], coverage: { connectivity: 'complete' } });
const mapping = [{ left: 'a', right: 'b', confirmed: true, pins: {} }];
test('位号不同、布局不同但连接一致：分别给出结论，不虚构功能等价', () => {
  const a = design(), b = design('b', 'R99'); b.components[0].at = [25, 30];
  const result = compare(a, b, mapping);
  assert.equal(result.conclusions.components, 'pass'); assert.equal(result.conclusions.connectivity, 'pass'); assert.equal(result.conclusions.functional, 'unknown');
  assert.equal(result.differences[0].layer, 'layout');
});
test('重复属性的器件不自动按猜测配对，人工映射不能多对一', () => {
  const a = design(), b = design('b', 'R99'); b.components.push(component('c', 'R100'));
  assert.equal(suggestMappings(a, b)[0].right, '');
  assert.throws(() => compare({ ...a, components: [...a.components, component('d', 'R2')] }, b, [...mapping, { left: 'd', right: 'b' }]), /唯一/);
});
test('漏件、DNP 和不同型号均不被外观或引脚数隐藏', () => {
  for (const [key, val] of [['value', '22k'], ['dnp', true], ['libId', 'Different:R']]) {
    const b = design('b', 'R1'); b.components[0][key] = val; assert.equal(compare(design(), b, mapping).conclusions.components, 'fail');
  }
  assert.equal(compare(design(), { ...design('b'), components: [] }, []).conclusions.connectivity, 'unknown');
});
test('仅网络改名不判连接改变；接错脚和短接必检出', () => {
  const a = design(), b = design('b'); b.nets[0].name = 'SGND';
  assert.equal(compare(a, b, mapping).conclusions.connectivity, 'pass');
  b.nets[0].nodes.push({ component: 'b', pin: '2' }); b.nets.pop();
  assert.equal(compare(a, b, mapping).conclusions.connectivity, 'fail');
  const c = design('b'); c.components.push(component('c', 'R2')); c.nets[0].nodes.push({ component: 'c', pin: '1' }); c.nets[1].nodes.push({ component: 'c', pin: '2' });
  const d = structuredClone(c); d.nets[0].nodes[0].pin = '2'; d.nets[1].nodes[0].pin = '1';
  assert.equal(compare(c, d, c.components.map(x => ({ left: x.id, right: x.id, confirmed: true }))).conclusions.connectivity, 'fail');
});
test('图片模糊、PDF 漏识别、未确认映射都不能判整体通过', () => {
  for (const coverage of ['partial', 'not_extracted']) {
    const b = design('b'); b.coverage.connectivity = coverage; assert.equal(compare(design(), b, mapping).conclusions.connectivity, 'unknown');
  }
  assert.equal(compare(design(), design('b'), [{ ...mapping[0], confirmed: false }]).conclusions.connectivity, 'unknown');
  const incomplete = design('b'); incomplete.coverage.connectivity = 'partial'; incomplete.nets.pop();
  assert.equal(compare(design(), incomplete, mapping).conclusions.connectivity, 'unknown', '漏识别不能作为确定断线证据');
});
test('连接相同但参数不合格，与结构不同但指定指标相等是不同判断', () => {
  const spec = { kind: 'divider', inputs: { vin: 5, rTop: '10k', rBottom: '10k' }, conditions: 'DC, unloaded', evidence: [{ quote: 'bench input' }], min: 3, max: 3.6 };
  let r = compare(design(), design('b'), mapping, [{ id: 'Vout', left: spec, right: spec }]);
  assert.equal(r.conclusions.connectivity, 'pass'); assert.equal(r.conclusions.functional, 'pass'); assert.equal(r.conclusions.requirements, 'fail');
  const b = design('b'); b.components[0].value = '20k';
  r = compare(design(), b, mapping, [{ id: 'Vout', left: spec, right: { ...spec, inputs: { vin: 5, rTop: '20k', rBottom: '20k' } } }]);
  assert.equal(r.conclusions.components, 'fail'); assert.equal(r.conclusions.functional, 'pass');
});
test('计算缺证据、缺工况、零分母、单位非法返回待确认；不写 requirements 不能宣称合格', () => {
  const spec = { kind: 'rc', inputs: { r: '10k', c: '100nF' }, conditions: 'small signal', evidence: [{ quote: 'test' }] };
  assert.ok(Math.abs(metric(spec).value - 159.154943) < .000001);
  for (const patch of [{ evidence: [] }, { conditions: '' }, { inputs: { r: 0, c: 1 } }]) assert.equal(metric({ ...spec, ...patch }).status, 'unknown');
  assert.equal(compare(design(), design('b'), mapping, [{ left: spec, right: spec }]).conclusions.requirements, 'unknown');
  assert.equal(number('4k7'), 4700); assert.equal(number('0.1uF'), 1e-7); assert.equal(number('47k/0603'), null);
});
test('去耦与上拉检查排除 DNP；缺依据保留未知', () => {
  const d = design(); d.components[0].ref = 'C1';
  const c = { id: 'decouple', kind: 'decoupling', component: 'a', pin: '2', returnNet: 'GND', evidence: [{ quote: 'supply decoupling required' }] };
  assert.equal(reviewRules(d, [c])[0].status, 'pass'); d.components[0].dnp = true;
  assert.equal(reviewRules(d, [c])[0].status, 'fail'); assert.equal(reviewRules(d, [{ ...c, evidence: [] }])[0].status, 'unknown');
});
test('电压域与热耗校验拦截已知越界', () => {
  const checks = [{ kind: 'voltage-domain', inputs: { driverMin: 0, driverMax: 5, receiverMin: -.3, receiverMax: 3.6 }, conditions: 'powered', evidence: [{ quote: 'absolute max' }] }, { kind: 'ldo', inputs: { vin: 5, vout: 3.3, current: 1 }, max: 1, conditions: 'ambient 50C', evidence: [{ quote: 'thermal budget 1W' }] }];
  const rows = reviewRules(design(), checks); assert.deepEqual(rows.map(r => r.status), ['fail', 'fail']); assert.equal(rows[1].value, 1.7000000000000002);
});
test('混合格式坐标校准：像素不能直接用作毫米，AD 纵向翻转可逆', () => {
  const matrix = calibrate([[0,0],[10,0]], [[100,50],[200,50]]);
  assert.deepEqual(transform([150,100], matrix), [5,5]);
  const flipped = calibrate([[0,0],[10,0]], [[100,50],[200,50]], true);
  assert.deepEqual(transform([150,100], flipped), [5,-5]);
  assert.throws(() => calibrate([[0,0],[10,0]], [[0,0],[0,0]]), /同一点/);
});

test('限流、功耗和上拉检查；反向 LDO、无效限值和同网规则不报通过', () => {
  const evidence = [{ quote: 'explicit test conditions' }], conditions = 'DC';
  assert.equal(metric({ kind: 'current', inputs: { vin: 5, vf: 2, r: 150 }, max: .01, conditions, evidence }).status, 'fail');
  assert.equal(metric({ kind: 'power', inputs: { current: .1, r: 100 }, max: .5, conditions, evidence }).status, 'fail');
  assert.equal(metric({ kind: 'ldo', inputs: { vin: 3, vout: 5, current: 1 }, conditions, evidence }).status, 'unknown');
  assert.equal(metric({ kind: 'power', inputs: { current: .1, r: 100 }, min: 2, max: 1, conditions, evidence }).status, 'unknown');
  assert.equal(metric({ kind: 'power', inputs: { current: .1, r: 100 }, max: NaN, conditions, evidence }).status, 'unknown');
  const check = { kind: 'pullup', component: 'a', pin: '1', returnNet: 'VCC', evidence };
  assert.equal(reviewRules(design(), [check])[0].status, 'pass');
  assert.equal(reviewRules(design(), [{ ...check, returnNet: 'GND' }])[0].status, 'unknown');
});
