import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseKiCad, parseProtel, applyPositions } from '../src/adapters.js';
import { review, toMarkdown } from '../src/engine.js';
import { componentGuide } from '../src/knowledge.js';
import { loadProject } from '../src/service.js';
const example = file => fileURLToPath(new URL(`../examples/${file}`, import.meta.url));
async function demo() { return loadProject(example('project.kicad.json')); }

test('KiCad 与 AD 导出同一电路，装配状态明确时检查结论一致', async () => {
  const a = await demo(), b = await loadProject(example('project.altium.json'));
  assert.deepEqual(a.report.summary, { warning: 2, unknown: 3, checked: 1, not_applicable: 0 });
  assert.deepEqual(a.report.findings, b.report.findings);
  assert.deepEqual(a.report.boardCounts, { components: 7, nets: 5 });
});
test('DNP 电容不满足输入滤波要求，装配后该项解决', async () => {
  const { board, config, report } = await demo();
  assert.match(report.findings[0].details, /C2=10nF（DNP/);
  assert.equal(report.findings[0].status, 'warning');
  board.components.find(c => c.ref === 'C2').dnp = false;
  assert.equal(review(board, config.context).findings[0].status, 'checked');
});
test('电容接错参考地不会算作已有滤波，未知地保持待确认', async () => {
  const { board, config } = await demo();
  board.components.find(c => c.ref === 'C2').dnp = false;
  const ground = board.nets.find(n => n.name === 'GND');
  ground.nodes = ground.nodes.filter(n => n.ref !== 'C2');
  board.nets.push({ name: 'OTHER_GND', nodes: [{ ref: 'C2', pin: '2' }] });
  assert.equal(review(board, config.context).findings[0].status, 'warning');
  config.context.signals[0].groundNet = 'NOT_EXPORTED';
  assert.equal(review(board, config.context).findings[0].status, 'unknown');
});
test('高速信号不默认要求加电容，强制规则必须给出项目依据', async () => {
  const { board, config } = await demo();
  const finding = review(board, config.context).findings[1];
  assert.equal(finding.status, 'unknown'); assert.match(finding.details, /不能默认加电容/);
  delete config.context.signals[0].basis;
  assert.throws(() => review(board, config.context), /basis/);
});
test('禁止电容规则仅在项目明确声明时生效', async () => {
  const { board, config } = await demo();
  config.context.signals[1].capacitorPolicy = 'forbidden'; config.context.signals[1].basis = '演示接口负载限制';
  assert.equal(review(board, config.context).findings[1].status, 'warning');
  board.components.find(c => c.ref === 'C3').dnp = true;
  assert.equal(review(board, config.context).findings[1].status, 'checked');
});
test('AD 装配状态未知时不会把电容认定为已装', async () => {
  const board = parseProtel(await readFile(example('demo.protel.net'), 'utf8'));
  const { config } = await demo();
  assert.equal(review(board, config.context).findings[0].status, 'unknown');
  assert.equal(review(board, config.context).findings[2].status, 'unknown');
});
test('位置缺失不通过，坐标距离不冒充安规距离', async () => {
  const { board, config } = await demo();
  const f = review(board, config.context).findings[3];
  assert.equal(f.status, 'warning'); assert.match(f.details, /12\.000 mm/); assert.match(f.details, /不代表焊盘距离/);
  delete board.components.find(c => c.ref === 'U1').position;
  assert.equal(review(board, config.context).findings[3].status, 'unknown');
});
test('安规缺少工况不报合格；只比较提供的限值与测量', async () => {
  const { board } = await demo();
  const isolation = [{ id: 'ISO', refs: ['U2'], standard: '测试标准条款（虚构）', workingVoltageV: 230, pollutionDegree: 2, materialGroup: 'IIIa', altitudeM: 2000, basis: '测试输入', requiredClearanceMm: 3, requiredCreepageMm: 5, measuredClearanceMm: 2, measuredCreepageMm: 6 }];
  let r = review(board, { isolation });
  assert.deepEqual(r.findings.map(f => f.status), ['warning', 'checked']);
  assert.match(r.findings[1].details, /未从铜皮几何重新测量/);
  delete isolation[0].standard;
  assert.deepEqual(review(board, { isolation }).findings.map(f => f.status), ['unknown', 'unknown']);
});
test('空规则显示缺少检查点，错误位号与错误引脚不会报通过', async () => {
  const { board, config } = await demo();
  assert.equal(review(board).findings[0].rule, 'COVERAGE');
  config.context.signals[0].pin = '999';
  assert.equal(review(board, config.context).findings[0].status, 'unknown');
  assert.throws(() => review(board, { componentOverrides: [{ ref: 'FAKE', dnp: false }] }), /未知器件/);
});
test('拒绝跨网重复引脚、重复位号及非法数字', async () => {
  const { board, config } = await demo();
  let changed = structuredClone(board); changed.nets[0].nodes.push({ ref: 'U1', pin: '2' });
  assert.throws(() => review(changed), /引脚重复/);
  changed = structuredClone(board); changed.components.push(changed.components[0]);
  assert.throws(() => review(changed), /不能重复/);
  config.context.proximity[0].maxMm = NaN;
  assert.throws(() => review(board, config.context), /有限数字/);
});
test('网表解析拒绝 XML 外部实体、截断块和不支持的文件', async () => {
  assert.throws(() => parseKiCad('<!DOCTYPE export [<!ENTITY e SYSTEM "file:///secret">]><export/>'), /DTD/);
  assert.throws(() => parseKiCad('<export><components>'), /XML 格式/);
  assert.throws(() => parseProtel('[\nR1\nR_0603\n1k'), /未闭合/);
  assert.throws(() => parseProtel('binary PcbDoc'), /块起点/);
});
test('Protel 空封装行保留，CSV 拒绝空值、重复与错误单位', () => {
  const b = parseProtel('[\nR1\n\n10k\n]\n(\nGND\nR1-1\n)');
  assert.equal(b.components[0].value, '10k'); assert.equal(b.components[0].footprint, undefined);
  for (const csv of ['ref,x,y\nR1,,2', 'ref,x,y\nR1,1,2\nR1,2,3', 'ref,x,y\nR1,1mil,2']) assert.throws(() => applyPositions(structuredClone(b), csv));
});
test('器件查询保留分类推测与资料缺失状态', () => {
  const mcu = componentGuide('STM32F103C8T6');
  assert.equal(mcu.kind, 'mcu'); assert.equal(mcu.exactPartVerified, false);
  assert.ok(mcu.checks.some(x => x.category === '安规'));
  assert.ok(mcu.checks.some(x => x.category === '工艺'));
  assert.equal(componentGuide('UNKNOWN-123').kind, 'generic');
});
test('报告把针脚归属目标器件，设计文本不能注入 HTML 或链接', async () => {
  const { report } = await demo();
  const output = toMarkdown(report);
  assert.match(output, /U1\.3；关联 C2/); assert.doesNotMatch(output, /C2\.3/);
  report.project = '<script>alert(1)</script>';
  report.findings[0].basis = '[伪造链接](file:///secret)';
  const escaped = toMarkdown(report);
  assert.doesNotMatch(escaped, /<script>/); assert.ok(escaped.includes('\\[伪造链接\\]'));
});
