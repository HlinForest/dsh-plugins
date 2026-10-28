import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePassiveObligations, reviewPassiveCoverage } from '../src/passive-coverage.js';

const source = (id, content, document = 'board-spec.pdf', page = 2) => ({ id, content, document, page });

function baseInputs(overrides = {}) {
  return {
    requirements: '保留八个零欧跨线电阻，另设置三个100pF电容。',
    power: '由主板提供5V并共地。',
    interfaces: 'DIN、CLK、STB为控制接口。',
    evidence: [source('spec-1', '器件规格摘录：推荐外围仅供参考。')],
    ...overrides,
  };
}

function part(ref, value, extra = {}) {
  return { ref, value, ...extra };
}

test('compiles only explicit user inventory and keeps exact source location', () => {
  const obligations = compilePassiveObligations({ inputs: baseInputs() });
  assert(Array.isArray(obligations));
  assert.equal(obligations.length, 2);
  const jumper = obligations.find(row => row.kind === 'resistor');
  const caps = obligations.find(row => row.kind === 'capacitor');
  assert.equal(jumper.quantity, 8);
  assert.equal(jumper.value, '0Ω');
  assert.equal(jumper.electricalRole, 'routing-bridge');
  assert.equal(jumper.authority, 'user');
  assert.equal(jumper.source.field, 'requirements');
  assert.equal(jumper.source.text, '保留八个零欧跨线电阻');
  assert.equal(caps.quantity, 3);
  assert.equal(caps.value, '100pF');
  assert.equal(caps.kind, 'capacitor');
});

test('source-cited recommendations are advisory and use quote, not guidance statement', () => {
  const inputs = baseInputs({ requirements: '设计5V控制板。' });
  inputs.evidence = [source('ds-1', '推荐外围：2 x 10k resistors 接在输入端。', 'tm1616.pdf', 4)];
  const guidance = [{
    subject: 'U1', category: 'peripheral',
    statement: '模型建议采用两个10k电阻。',
    citations: [{ sourceId: 'ds-1', quote: '推荐外围：2 x 10k resistors 接在输入端。', document: 'tm1616.pdf', page: 4 }],
  }];
  const obligations = compilePassiveObligations({ inputs, guidance });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].authority, 'guidance');
  assert.equal(obligations[0].hard, false);
  assert.equal(obligations[0].quantity, 2);
  assert.equal(obligations[0].value, '10kΩ');
  assert.equal(obligations[0].source.quote, '推荐外围：2 x 10k resistors 接在输入端。');
  const review = reviewPassiveCoverage({ components: [part('Rfoo', '10kΩ')] }, { inputs, guidance });
  assert.deepEqual(review.errors, []);
  assert(review.warnings.some(row => /推荐|guidance|2/.test(row)));
  assert.equal(review.coverage[0].status, 'under');
});

test('hard user quantity/value mismatch is an error, while three 100pF facts are covered', () => {
  const inputs = baseInputs();
  const design = {
    components: [
      ...['J-A', 'J-B', 'J-C', 'J-D', 'J-E', 'J-F'].map(ref => part(ref, '0R', { electricalRole: 'routing-bridge' })),
      part('C-A', '100pF'), part('C-B', '0.1nF'), part('C-C', '100pF'),
    ],
  };
  const review = reviewPassiveCoverage(design, { inputs });
  assert(review.errors.some(row => /8|数量|零欧/.test(row)), review.errors.join('\n'));
  assert(!review.errors.some(row => /100pF|电容/.test(row)), review.errors.join('\n'));
  const hardRows = review.coverage.filter(row => row.obligation.authority === 'user');
  assert.equal(hardRows.find(row => row.obligation.kind === 'capacitor').status, 'satisfied');
  const wrongValue = reviewPassiveCoverage({ components: [
    ...Array.from({ length: 8 }, (_, index) => part(`R${index + 1}`, '1R', { electricalRole: 'routing-bridge' })),
    part('C1', '100pF'), part('C2', '100pF'), part('C3', '100pF'),
  ] }, { inputs });
  assert(wrongValue.errors.some(row => /0Ω|值|value/i.test(row)), wrongValue.errors.join('\n'));
});

test('routing bridge role is required and arbitrary zero-ohm parts cannot satisfy it', () => {
  const inputs = baseInputs({ requirements: '保留2个零欧跨线电阻。' });
  const withoutRole = reviewPassiveCoverage({ components: [part('X1', '0R'), part('X2', '0Ω')] }, { inputs });
  assert(withoutRole.errors.some(row => /routing-bridge|跨线|用途/.test(row)), withoutRole.errors.join('\n'));
  const withRole = reviewPassiveCoverage({ components: [
    part('X1', '0R', { electricalRole: 'routing-bridge' }),
    part('X2', '0Ω', { electricalRole: 'routing-bridge' }),
  ] }, { inputs });
  assert.deepEqual(withRole.errors, []);
});

test('unknown or unrelated numeric phrases do not become passive obligations', () => {
  const inputs = baseInputs({
    requirements: '5V供电，芯片有16个引脚，最大电流50mA，版本2。',
    power: '建议靠近芯片放置去耦，但未给数量和参数。',
    interfaces: '输入端按规格书连接。',
  });
  const guidance = [{
    subject: 'U1', category: 'limits', statement: '使用两个10k电阻。',
    citations: [{ sourceId: 'limit', quote: '绝对最大输出电流50mA；芯片有16个引脚。', page: 9 }],
  }];
  const obligations = compilePassiveObligations({ inputs, guidance });
  assert.deepEqual(obligations, []);
});

test('renamed parts and different projects are matched by electrical kind/value, never fixed references', () => {
  const inputs = baseInputs({ requirements: '保留2 x 0Ω routing-bridge resistors和1个0.1nF capacitor。' });
  const design = { components: [
    part('R_A', '0Ω', { electricalRole: 'routing-bridge' }),
    part('LINK_B', 'zero-ohm', { electricalRole: 'routing-bridge' }),
    part('C_DIFFERENT_PROJECT', '100pF'),
  ] };
  const review = reviewPassiveCoverage(design, { inputs });
  assert.deepEqual(review.errors, []);
  assert(review.coverage.every(row => row.status === 'satisfied'));
});

test('does not turn negated inventory or a minimum into an exact quantity', () => {
  const negated = compilePassiveObligations({ inputs: {
    requirements: '不需要八个零欧跨线电阻；不要3个100pF电容。',
    power: '', interfaces: '',
  } });
  assert.deepEqual(negated, []);

  const minimum = compilePassiveObligations({ inputs: {
    requirements: 'at least 2 x 10k resistors are allowed.',
    power: '', interfaces: '',
  } });
  assert.equal(minimum.length, 1);
  assert.notEqual(minimum[0].quantity, 2);
  assert.equal(minimum[0].minimumQuantity, 2);
  assert.equal(minimum[0].scope, 'at-least');
});

test('requires a quantity/value separator and rejects partial values and boundary numerics', () => {
  const obligations = compilePassiveObligations({ inputs: {
    requirements: '100pF电容；10k电阻；3个4k7电阻；2 x 10kunknown resistors；版本2.0，芯片16个引脚。',
    power: '', interfaces: '',
  } });
  assert.deepEqual(obligations, []);
});

test('explicit/library kind wins and malformed or pure ref-style values are not passives', () => {
  const inputs = { requirements: '保留1个100pF电容和1个10k电阻。', power: '', interfaces: '' };
  const review = reviewPassiveCoverage({ components: [
    { ref: 'C1', librarySymbol: 'Device:C', value: '100R' },
    { ref: 'R1', librarySymbol: 'MCU:Controller', value: '10k' },
    { ref: 'R2', librarySymbol: 'Device:R', value: '10kunknown' },
  ] }, { inputs });
  assert.equal(review.coverage.find(row => row.obligation.kind === 'capacitor').actualQuantity, 0);
  assert.equal(review.coverage.find(row => row.obligation.kind === 'resistor').actualQuantity, 0);
  assert.equal(review.errors.length, 2);
});

test('same-clause independent examples are surfaced as ambiguous, never silently merged into hard one', () => {
  const obligations = compilePassiveObligations({ inputs: {
    requirements: '一个100pF电容和另一个100pF电容。', power: '', interfaces: '',
  } });
  assert.equal(obligations.length, 1);
  assert.equal(obligations[0].ambiguous, true);
  assert.equal(obligations[0].hard, false);
  assert.equal(obligations[0].quantity, undefined);
  const review = reviewPassiveCoverage({ components: [] }, { inputs: {
    requirements: '一个100pF电容和另一个100pF电容。', power: '', interfaces: '',
  } });
  assert.deepEqual(review.errors, []);
  assert(review.warnings.some(row => /歧义/.test(row)));
});

test('skips optional, full-clause negated, and unsupported numeric-range phrases', () => {
  for (const requirements of [
    '可选3个100pF电容。',
    '三个100pF电容不需要。',
    '0-3个100pF电容。',
  ]) {
    assert.deepEqual(compilePassiveObligations({ inputs: { requirements, power: '', interfaces: '' } }), [], requirements);
  }
});

test('reports exact surplus as a warning and checks at-most by the specified value', () => {
  const exactInputs = { requirements: '保留2个100pF电容。', power: '', interfaces: '' };
  const surplus = reviewPassiveCoverage({ components: [
    part('C1', '100pF'), part('C2', '100pF'), part('C3', '100pF'),
  ] }, { inputs: exactInputs });
  assert.equal(surplus.coverage[0].status, 'surplus');
  assert.deepEqual(surplus.errors, []);
  assert(surplus.warnings.some(row => /超出|surplus|额外/.test(row)), surplus.warnings.join('\n'));

  const atMost = compilePassiveObligations({ inputs: {
    requirements: '最多3个100pF电容。', power: '', interfaces: '',
  } });
  const atMostReview = reviewPassiveCoverage({ components: [part('C1', '1uF')] }, { obligations: atMost });
  assert.equal(atMostReview.coverage[0].status, 'satisfied');
  assert.deepEqual(atMostReview.errors, []);
  const mixed = reviewPassiveCoverage({ components: [
    part('C1', '100pF'), part('C2', '100pF'), part('C3', '100pF'),
    part('C4', '1uF'), part('C5', '100nF'),
  ] }, { obligations: atMost });
  assert.equal(mixed.coverage[0].actualQuantity, 3);
  assert.deepEqual(mixed.errors, []);
  const over = reviewPassiveCoverage({ components: [
    part('C1', '100pF'), part('C2', '100pF'), part('C3', '100pF'), part('C4', '100pF'),
  ] }, { obligations: atMost });
  assert.equal(over.coverage[0].status, 'over');
  assert.equal(over.errors.length, 1);
});
