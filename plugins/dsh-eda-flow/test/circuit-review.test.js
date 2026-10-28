import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewCircuit } from '../src/circuit-review.js';

const pin = (number, name = '') => ({ number: String(number), name, type: 'passive', pad: String(number) });
const component = (ref, value, electricalRole, librarySymbol = 'Device:R') => ({
  id: ref.toLowerCase(), ref, value, mpn: '', footprint: '', librarySymbol,
  dnp: false, in_bom: true, on_board: true, electricalRole,
  pins: [pin(1), pin(2)],
});
const display = () => ({
  id: 'disp', ref: 'DSP1', value: 'display', mpn: '', footprint: '', librarySymbol: 'Display_Character:CA56-12EWA',
  dnp: false, in_bom: true, on_board: true,
  pins: [pin(1, 'A'), pin(2, 'K')],
});
// Real evidence rows use an opaque symbolId for fact provenance.  It is not a
// library symbol name and must still classify the row through componentKind.
const ledEvidence = [{ ref: 'DSP1', componentKind: 'display', symbolId: 'Evidence:Fact_abc123' }];

const baseDesign = () => ({
  components: [
    display(),
    {
      id: 'u1', ref: 'U1', value: 'driver', mpn: '', footprint: '', librarySymbol: 'Driver:Generic',
      dnp: false, in_bom: true, on_board: true,
      pins: [
        { ...pin(1), name: 'OUT', type: 'output' },
        { ...pin(2), name: 'GND', type: 'power_in' },
      ],
    },
    component('R1', '100Ω', 'current-limit'),
    component('R2', '0Ω', 'routing-bridge'),
  ],
  nets: [
    { name: 'DRIVE_A', nodes: ['U1.1', 'R1.1'] },
    { name: 'LED_A', nodes: ['R1.2', 'DSP1.1'] },
    { name: '+5V', nodes: ['R2.1'] },
    { name: 'GND', nodes: ['R2.2', 'DSP1.2', 'U1.2'] },
  ],
  nc: [],
  loadAssessments: [{ ref: 'DSP1', currentControl: 'resistor', components: ['R1'], basis: { source: 'display datasheet.pdf', citation: 'forward-current path' }, unresolved: [] }],
});

test('unresolved current control cannot leave a display channel directly driven, including through zero-ohm bridges', () => {
  for (const bridge of [false, true]) {
    const design = baseDesign();
    design.loadAssessments = [{ ref: 'DSP1', currentControl: 'unresolved', unresolved: ['Vf and target current are unknown'] }];
    if (bridge) {
      Object.assign(design.components.find(c => c.ref === 'R1'), { value: '0R', electricalRole: 'routing-bridge' });
    } else {
      design.nets[0].nodes.push('DSP1.1');
      design.nets[1].nodes = ['R1.2'];
    }
    const result = reviewCircuit(design, { evidence: ledEvidence });
    assert(result.errors.some(error => error.code === 'load-uncontrolled-connected-path' && error.channel === 'A'));
  }
});

test('a deferred disconnected channel or a positive current-limiter candidate retains unresolved parameters', () => {
  for (const disconnected of [false, true]) {
    const design = baseDesign();
    design.loadAssessments = [{ ref: 'DSP1', currentControl: 'unresolved', unresolved: ['Vf and target current are unknown'] }];
    if (disconnected) design.nets[1].nodes = ['R1.2'];
    const result = reviewCircuit(design, { evidence: ledEvidence });
    assert.equal(result.errors.some(error => error.code === 'load-uncontrolled-connected-path'), false);
    assert.equal(result.readiness.ready, false);
  }
});

test('non-LED legacy designs remain reviewable without load assessments', () => {
  const design = {
    components: [component('R1', '1k', undefined), component('R2', '1k', undefined)],
    nets: [{ name: 'A', nodes: ['R1.1', 'R2.1'] }, { name: 'B', nodes: ['R1.2', 'R2.2'] }],
    nc: [],
  };
  const result = reviewCircuit(design, { evidence: { components: [] } });
  assert.equal(result.errors.some(error => error.code === 'load-assessment-missing'), false);
});

test('display evidence requires a generic load assessment and does not infer it from a renamed reference', () => {
  const design = baseDesign();
  delete design.loadAssessments;
  design.components[0].ref = 'DISPLAY_A';
  const result = reviewCircuit(design, { evidence: [{ ...ledEvidence[0], ref: 'DISPLAY_A' }] });
  assert(result.errors.some(error => error.code === 'load-assessment-missing'));
});

test('zero-ohm components require an explicit semantic purpose', () => {
  const design = baseDesign();
  design.components.find(c => c.ref === 'R2').electricalRole = undefined;
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'zero-ohm-purpose-missing' && error.ref === 'R2'));
});

test('a zero-ohm part cannot be used as a current limiter, while an unknown value is not guessed', () => {
  const design = baseDesign();
  design.components.find(c => c.ref === 'R1').value = 'unknown';
  design.components.find(c => c.ref === 'R1').electricalRole = 'current-limit';
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'current-limit-value-unknown' && error.ref === 'R1'));
  assert.equal(result.errors.some(error => error.message.includes('47')), false);

  const zero = baseDesign();
  zero.components.find(c => c.ref === 'R1').value = '0Ω';
  const zeroResult = reviewCircuit(zero, { evidence: ledEvidence });
  assert(zeroResult.errors.some(error => error.code === 'current-limit-value-nonpositive' && error.ref === 'R1'));
});

test('an isolated resistor cannot be borrowed into a load assessment', () => {
  const design = baseDesign();
  design.components.push(component('R3', '220Ω', 'current-limit'));
  design.nets.push({ name: 'ISOLATED_A', nodes: ['R3.1'] }, { name: 'ISOLATED_B', nodes: ['R3.2'] });
  design.loadAssessments[0].components = ['R3'];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'load-path-missing' && error.ref === 'R3'));
});

test('a positive resistor on one net is not treated as a cross-net current limiter', () => {
  const design = baseDesign();
  design.components.find(c => c.ref === 'R1').pins = [pin(1), pin(2)];
  design.nets = [
    { name: '+5V', nodes: ['R1.1', 'R1.2', 'R2.1'] },
    { name: 'GND', nodes: ['R2.2', 'DSP1.2'] },
    { name: 'LED_A', nodes: ['DSP1.1'] },
  ];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'current-limit-same-net' && error.ref === 'R1'));
});

test('regulated control needs a source citation and unresolved control keeps the result not-ready', () => {
  const regulated = baseDesign();
  regulated.loadAssessments = [{ ref: 'DSP1', currentControl: 'regulated', components: [], basis: '内部判断', unresolved: [] }];
  const regulatedResult = reviewCircuit(regulated, { evidence: ledEvidence });
  assert(regulatedResult.errors.some(error => error.code === 'regulated-source-missing'));

  const unresolved = baseDesign();
  unresolved.loadAssessments = [{ ref: 'DSP1', currentControl: 'unresolved', components: [], basis: '', unresolved: ['额定工作电流待规格书确认'] }];
  const unresolvedResult = reviewCircuit(unresolved, { evidence: ledEvidence });
  assert.equal(unresolvedResult.readiness.ready, false);
  assert.equal(unresolvedResult.readiness.status, 'not-ready');
  assert(unresolvedResult.unresolved.some(item => item.includes('额定工作电流')));
});

test('routing bridges are zero ohm but their net topology remains an explicit engineering choice', () => {
  const design = baseDesign();
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert.equal(result.errors.some(error => error.ref === 'R2' && error.code === 'routing-bridge-net-mismatch'), false);
  assert.equal(result.passiveRoles.find(role => role.ref === 'R2').electricalRole, 'routing-bridge');
});

test('sharing the load ground is not enough to borrow an unrelated resistor into its current path', () => {
  const design = baseDesign();
  design.components.push(component('R3', '220Ω', 'current-limit'));
  design.nets.push({ name: 'FLOATING', nodes: ['R3.1'] }, { name: 'GND', nodes: ['R3.2', 'DSP1.2'] });
  design.loadAssessments[0].components = ['R3'];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'load-path-missing' && error.ref === 'R3'));
});

test('regulated control accepts only a current-context guidance id or a matching source quote', () => {
  const unknown = baseDesign();
  unknown.loadAssessments = [{ ref: 'DSP1', currentControl: 'regulated', components: [], basis: 'anything.pdf', unresolved: [] }];
  const unknownResult = reviewCircuit(unknown, { evidence: ledEvidence });
  assert(unknownResult.errors.some(error => error.code === 'regulated-source-missing'));

  const cited = baseDesign();
  cited.loadAssessments = [{ ref: 'DSP1', currentControl: 'regulated', components: [], basis: { sourceId: 'fact-1', quote: '恒流输出' }, unresolved: [] }];
  const citedResult = reviewCircuit(cited, {
    evidence: [...ledEvidence, { id: 'fact-1', content: '器件提供恒流输出，需按资料确认额定值。' }],
  });
  assert.equal(citedResult.errors.some(error => error.code === 'regulated-source-missing'), false);
});

test('resistance units preserve mΩ/MΩ distinction and numeric IC values are not treated as resistors', () => {
  const design = baseDesign();
  design.components.find(c => c.ref === 'R1').value = '10mΩ';
  const bridge = design.components.find(c => c.ref === 'R2');
  bridge.value = '0R';
  design.components.push({
    id: 'u2', ref: 'U2', value: '1MΩ', mpn: '', footprint: '', librarySymbol: 'Driver:Numeric',
    dnp: false, in_bom: true, on_board: true, pins: [pin(1), pin(2)], electricalRole: 'other',
  });
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert.equal(result.passiveRoles.find(role => role.ref === 'R1').parsedValue, 0.01);
  assert.equal(result.passiveRoles.find(role => role.ref === 'R2').parsedValue, 0);
  assert.equal(result.passiveRoles.find(role => role.ref === 'U2').parsedValue, null);
  assert.equal(result.errors.some(error => error.ref === 'U2' && error.code === 'passive-role-not-resistor'), false);
  assert.equal(result.readiness.hardwareVerified, false);
  assert.equal(result.readiness.electricalPerformanceVerified, false);

  const twentyTwoK = baseDesign();
  twentyTwoK.components.find(c => c.ref === 'R1').value = '22K';
  const twentyTwoKResult = reviewCircuit(twentyTwoK, { evidence: ledEvidence });
  assert.equal(twentyTwoKResult.passiveRoles.find(role => role.ref === 'R1').parsedValue, 22000);
});

test('a resistor on only one of several named display channels cannot make the load ready', () => {
  const design = baseDesign();
  design.components[0].pins = [pin(1, 'A'), pin(2, 'B'), pin(3, 'K')];
  design.nets = [
    { name: 'DRIVE_A', nodes: ['U1.1', 'R1.1'] },
    { name: 'LED_A', nodes: ['R1.2', 'DSP1.1'] },
    { name: 'DRIVE_B', nodes: ['U1.2', 'DSP1.2'] },
    { name: 'GND', nodes: ['R2.2', 'DSP1.3'] },
    { name: '+5V', nodes: ['R2.1'] },
  ];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'load-channel-uncovered' && error.channel === 'B'));
  assert.equal(result.readiness.ready, false);
});

test('an ambiguous display pinout remains unresolved unless channels are explicitly declared', () => {
  const design = baseDesign();
  design.components[0].pins = [pin(1), pin(2), pin(3)];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.unresolved.some(item => item.includes('DSP1')));
  assert.equal(result.readiness.ready, false);
});

test('library LED/display symbols require load assessment even when evidence is absent', () => {
  const design = baseDesign();
  design.components[0].librarySymbol = 'Device:LED';
  delete design.loadAssessments;
  const result = reviewCircuit(design, { evidence: [] });
  assert(result.errors.some(error => error.code === 'load-assessment-missing' && error.ref === 'DSP1'));
});

test('regulated guidance must say constant-current and bind to an actually connected driver', () => {
  const design = baseDesign();
  design.loadAssessments = [{
    ref: 'DSP1', currentControl: 'regulated', components: ['R1'], driverRefs: ['U1'],
    basis: 'g-cap', unresolved: [],
  }];
  const weak = reviewCircuit(design, { evidence: [...ledEvidence, { id: 'g-cap', content: 'place capacitor nearby' }] });
  assert(weak.errors.some(error => error.code === 'regulated-source-not-constant-current'));

  const strong = reviewCircuit(design, { evidence: [...ledEvidence, { id: 'g-cc', content: 'constant-current output regulates LED current' }] });
  design.loadAssessments[0].basis = 'g-cc';
  const strongResult = reviewCircuit(design, { evidence: [...ledEvidence, { id: 'g-cc', content: 'constant-current output regulates LED current' }] });
  assert.equal(strong.errors.some(error => error.code === 'regulated-source-missing'), true);
  assert.equal(strongResult.errors.some(error => error.code === 'regulated-source-not-constant-current'), false);
  assert.equal(strongResult.errors.some(error => error.code === 'regulated-driver-disconnected'), false);
});

test('regulated control must cover every named channel instead of borrowing another channel', () => {
  const design = baseDesign();
  design.components[0].pins = [pin(1, 'A'), pin(2, 'B'), pin(3, 'K')];
  design.nets = [
    { name: 'DRIVE_A', nodes: ['U1.1', 'DSP1.1'] },
    { name: 'FLOAT_B', nodes: ['DSP1.2'] },
    { name: 'GND', nodes: ['DSP1.3', 'U1.2'] },
  ];
  design.loadAssessments = [{
    ref: 'DSP1', currentControl: 'regulated', components: [], driverRefs: ['U1'],
    basis: { sourceId: 'src-cc-channel', quote: 'constant-current output regulates LED current' },
    unresolved: [],
  }];
  const result = reviewCircuit(design, {
    evidence: [...ledEvidence, { id: 'src-cc-channel', content: 'constant-current output regulates LED current' }],
  });
  assert(result.errors.some(error => error.code === 'load-channel-uncovered' && error.channel === 'B'));
  assert.equal(result.readiness.ready, false);
});

test('missing passive role and undefined selected component are reported precisely', () => {
  const design = baseDesign();
  design.components.find(c => c.ref === 'R1').electricalRole = undefined;
  design.loadAssessments[0].components = ['R1', 'R404'];
  const result = reviewCircuit(design, { evidence: ledEvidence });
  assert(result.errors.some(error => error.code === 'load-component-role-missing' && error.ref === 'R1'));
  assert(result.errors.some(error => error.code === 'load-component-unknown' && error.ref === 'R404'));
});

test('series damping and pull roles require a positive resistor across distinct nets', () => {
  const zero = {
    components: [component('R1', '0R', 'series-damping')],
    nets: [{ name: 'N', nodes: ['R1.1', 'R1.2'] }],
  };
  const zeroResult = reviewCircuit(zero, { evidence: { components: [] } });
  assert(zeroResult.errors.some(error => error.code === 'passive-role-value-nonpositive' && error.ref === 'R1'));
  assert(zeroResult.errors.some(error => error.code === 'passive-role-same-net' && error.ref === 'R1'));

  const nonResistor = {
    components: [component('C1', '100pF', 'pull-up', 'Device:C')],
    nets: [{ name: 'A', nodes: ['C1.1'] }, { name: 'B', nodes: ['C1.2'] }],
  };
  const nonResistorResult = reviewCircuit(nonResistor, { evidence: { components: [] } });
  assert(nonResistorResult.errors.some(error => error.code === 'passive-role-not-resistor' && error.ref === 'C1'));
});

test('guidance statement cannot manufacture a regulated claim when its verified quote is only a placement suggestion', () => {
  const design = baseDesign();
  design.loadAssessments = [{ ref: 'DSP1', currentControl: 'regulated', components: ['R1'], driverRefs: ['U1'], basis: 'g-layout', unresolved: [] }];
  const result = reviewCircuit(design, {
    evidence: [...ledEvidence, { id: 'src-layout', content: 'place capacitor nearby; constant-current is not specified here' }],
    guidance: [{
      id: 'g-layout', statement: '该器件为恒流驱动，建议电容靠近芯片。',
      citations: [{ sourceId: 'src-layout', quote: 'place capacitor nearby' }],
    }],
  });
  assert(result.errors.some(error => error.code === 'regulated-source-not-constant-current'));
});

test('regulated basis quote is evaluated by itself and explicit non-constant wording is rejected', () => {
  const design = baseDesign();
  design.loadAssessments = [{
    ref: 'DSP1', currentControl: 'regulated', components: ['R1'], driverRefs: ['U1'],
    basis: { sourceId: 'src-mixed', quote: 'place capacitor nearby' }, unresolved: [],
  }];
  const mixed = reviewCircuit(design, {
    evidence: [...ledEvidence, { id: 'src-mixed', content: 'constant-current output is not part of this device; place capacitor nearby' }],
  });
  assert(mixed.errors.some(error => error.code === 'regulated-source-not-constant-current'));

  design.loadAssessments[0].basis = { sourceId: 'src-negative-en', quote: 'constant-current output is not part of this device' };
  const negativeEnglish = reviewCircuit(design, {
    evidence: [...ledEvidence, { id: 'src-negative-en', content: 'constant-current output is not part of this device' }],
  });
  assert(negativeEnglish.errors.some(error => error.code === 'regulated-source-not-constant-current'));

  design.loadAssessments[0].basis = { sourceId: 'src-negative', quote: '本器件不具备恒流功能' };
  const negative = reviewCircuit(design, {
    evidence: [...ledEvidence, { id: 'src-negative', content: '本器件不具备恒流功能' }],
  });
  assert(negative.errors.some(error => error.code === 'regulated-source-not-constant-current'));
});

test('explicit unresolved items block readiness in resistor or regulated modes too', () => {
  const resistor = baseDesign();
  resistor.loadAssessments[0].unresolved = ['LED Vf 待规格书确认'];
  const resistorResult = reviewCircuit(resistor, { evidence: ledEvidence });
  assert(resistorResult.unresolved.some(item => item.includes('LED Vf')));
  assert.equal(resistorResult.readiness.ready, false);

  const regulated = baseDesign();
  regulated.loadAssessments = [{
    ref: 'DSP1', currentControl: 'regulated', components: ['R1'], driverRefs: ['U1'],
    basis: { sourceId: 'src-cc', quote: 'constant-current output regulates LED current' },
    unresolved: ['额定电流待核实'],
  }];
  const regulatedResult = reviewCircuit(regulated, {
    evidence: [...ledEvidence, { id: 'src-cc', content: 'constant-current output regulates LED current' }],
  });
  assert(regulatedResult.unresolved.some(item => item.includes('额定电流')));
  assert.equal(regulatedResult.readiness.ready, false);
});
