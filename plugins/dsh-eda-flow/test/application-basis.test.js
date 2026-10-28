import test from 'node:test';
import assert from 'node:assert/strict';
import { applicationInstructions, applicationTool, extractGuidance, projectGuidance } from '../src/application-basis.js';

const evidence = [
  { id: 'u1-p4', document: 'receiver-datasheet.pdf', page: 4, section: 'Application information', content: 'The device operates from a 5 V supply. Connect a 100 nF bypass capacitor close to the supply pins.', simulated: false, sourceType: 'pdf-text-extraction' },
  { id: 'u1-p6', document: 'receiver-datasheet.pdf', page: 6, section: 'Unused pins', content: 'Leave the TEST pin unconnected when the feature is not used.', simulated: false, sourceType: 'pdf-text-extraction' },
  { id: 'legacy-p2', document: 'old-notes.pdf', page: 2, section: 'Application information', content: 'The device operates from a 3.3 V supply.', simulated: true, sourceType: 'pdf-text-extraction' },
];

test('instructions and tool expose a generic application-fact seam', () => {
  assert.equal(applicationTool.name, 'spec_record_guidance');
  assert.equal(applicationTool.inputSchema.properties.guidance.maxItems, 5);
  assert.equal(applicationTool.inputSchema.properties.guidance.minItems, undefined);
  assert.equal(applicationTool.inputSchema.properties.removeIds.maxItems, 5);
  assert.equal(applicationTool.inputSchema.anyOf.length, 2);
  assert.match(applicationInstructions, /supply/);
  assert.match(applicationInstructions, /peripheral/);
  assert.match(applicationInstructions, /不能.*推断|语义推断/);
  assert.match(applicationInstructions, /removeIds/);
  assert.doesNotMatch(applicationInstructions, /TM1616|显示模块|AD mapping/);
});

test('guidance keeps exact source location and ordinary provenance', () => {
  const plan = { guidance: [
    { subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] },
    { subject: 'U1', category: 'peripheral', statement: 'Connect a 100 nF bypass capacitor close to the supply pins.', citations: [{ sourceId: 'u1-p4', quote: 'Connect a 100 nF bypass capacitor close to the supply pins.' }] },
  ] };
  const rows = extractGuidance(plan, { evidence });
  assert.equal(rows.length, 2);
  assert.match(rows[0].id, /^guidance-[0-9a-f]{16}$/);
  assert.equal(rows[0].citations[0].document, 'receiver-datasheet.pdf');
  assert.equal(rows[0].citations[0].page, 4);
  assert.equal(rows[0].citations[0].section, 'Application information');
  assert.equal(rows[0].simulated, false);
  assert.equal(rows[0].citations[0].simulated, false);
  // Key order and citation order are not part of the identity.
  const reordered = extractGuidance({ guidance: [{ citations: [{ quote: plan.guidance[0].citations[0].quote, sourceId: 'u1-p4' }], statement: plan.guidance[0].statement, category: 'supply', subject: 'U1' }] }, { evidence });
  assert.equal(reordered[0].id, rows[0].id);
});

test('guidance accepts unused-pin facts and preserves simulated provenance', () => {
  const rows = extractGuidance({ guidance: [
    { subject: 'U1', category: 'unused-pin', statement: 'Leave the TEST pin unconnected when the feature is not used.', citations: [{ sourceId: 'u1-p6', quote: 'Leave the TEST pin unconnected when the feature is not used.' }] },
    { subject: 'legacy', category: 'supply', statement: 'The device operates from a 3.3 V supply.', citations: [{ sourceId: 'legacy-p2', quote: 'The device operates from a 3.3 V supply.' }] },
  ] }, { evidence });
  assert.equal(rows[0].simulated, false);
  assert.equal(rows[1].simulated, true);
  assert.equal(rows[1].citations[0].simulated, true);
});

test('fabricated, unknown, and non-application citations are rejected', () => {
  const valid = { subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] };
  assert.throws(() => extractGuidance({ guidance: [{ ...valid, citations: [{ sourceId: 'missing', quote: valid.citations[0].quote }] }] }, { evidence }), /来源不存在/);
  assert.throws(() => extractGuidance({ guidance: [{ ...valid, citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 9 V supply.' }] }] }, { evidence }), /未匹配/);
  const cadEvidence = [{ id: 'pcb', document: 'layout.kicad_pcb', page: null, section: 'geometry', content: 'x=10 y=20 mm', simulated: false, sourceType: 'kicad-pcb' }];
  assert.throws(() => extractGuidance({ guidance: [{ subject: 'board', category: 'application', statement: 'x=10 y=20 mm', citations: [{ sourceId: 'pcb', quote: 'x=10 y=20 mm' }] }] }, { evidence: cadEvidence }), /几何/);
  assert.throws(() => extractGuidance({ guidance: [{ ...valid, category: 'geometry' }] }, { evidence }), /合法category/);
});

test('qualitative datasheet layout advice is valid while CAD and coordinate payloads are not', () => {
  const layoutEvidence = [{ id: 'u1-layout', document: 'receiver-datasheet.pdf', page: 8, section: 'Layout recommendations', content: 'PCB layout: place the 100 nF decoupling capacitor close to VDD.', simulated: false, sourceType: 'pdf-text-extraction' }];
  const row = extractGuidance({ guidance: [{ subject: 'U1', category: 'peripheral', statement: 'PCB layout: place the 100 nF decoupling capacitor close to VDD.', citations: [{ sourceId: 'u1-layout', quote: 'PCB layout: place the 100 nF decoupling capacitor close to VDD.' }] }] }, { evidence: layoutEvidence })[0];
  assert.equal(row.citations[0].section, 'Layout recommendations');
  const machineEvidence = [
    { id: 'sch', document: 'design.kicad_sch', page: null, section: 'symbols', content: '(kicad_sch (version 20231120))', simulated: false, sourceType: 'kicad-schematic' },
    { id: 'net', document: 'connections.net', page: null, section: 'netlist', content: 'NET /VDD U1.1 C1.1', simulated: false, sourceType: 'netlist' },
    { id: 'coords', document: 'engineering-notes.txt', page: null, section: 'mechanical', content: 'Reference location X=12.3 Y=4.5 mm.', simulated: false, sourceType: 'text' },
  ];
  for (const source of machineEvidence) {
    assert.throws(() => extractGuidance({ guidance: [{ subject: 'board', category: 'application', statement: source.content, citations: [{ sourceId: source.id, quote: source.content }] }] }, { evidence: machineEvidence }), /几何/);
  }
});

test('accepted IDs support corrections and removal batches without silent duplicates', () => {
  const original = extractGuidance({ guidance: [{ subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] }] }, { evidence })[0];
  const corrected = extractGuidance({ guidance: [{ id: original.id, subject: 'U1', category: 'supply', statement: 'The device operates from a 3.3 V supply.', citations: [{ sourceId: 'legacy-p2', quote: 'The device operates from a 3.3 V supply.' }] }] }, { evidence })[0];
  assert.equal(corrected.id, original.id);
  assert.equal(corrected.statement, 'The device operates from a 3.3 V supply.');
  assert.deepEqual(extractGuidance({ removeIds: [original.id] }, { evidence }), []);
  assert.deepEqual(extractGuidance({ guidance: [] }, { evidence }), []);
  assert.throws(() => extractGuidance({ removeIds: [original.id, original.id] }, { evidence }), /removeIds/);
  assert.throws(() => extractGuidance({ guidance: [{ id: 'guidance-0000000000000000', subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] }, { id: 'guidance-0000000000000000', subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] }] }, { evidence }), /重复/);
  assert.throws(() => extractGuidance({ removeIds: ['not-an-accepted-id'] }, { evidence }), /已接受/);
});

test('project guidance is available only from the confirmed current stage-2 result', () => {
  const row = extractGuidance({ guidance: [{ subject: 'U1', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: 'u1-p4', quote: 'The device operates from a 5 V supply.' }] }] }, { evidence })[0];
  const project = { inputs: { evidence }, stages: [{ id: 2, status: 'done', confirmed: true, result: { guidance: [row] } }] };
  assert.deepEqual(projectGuidance(project), [row]);
  assert.deepEqual(projectGuidance({ ...project, stages: [{ ...project.stages[0], confirmed: false }] }), []);
  assert.deepEqual(projectGuidance({ ...project, stages: [{ ...project.stages[0], status: 'stale' }] }), []);
  assert.deepEqual(projectGuidance({ ...project, stages: [{ id: 2, status: 'done', confirmed: true, plan: { guidance: [row] }, result: {} }] }), []);
});

test('a real quote cannot authorize an invented application value', () => {
  const content = 'Place the bypass capacitor close to VDD. The maximum output current is 50 mA. Power dissipation is 400 mW.';
  const inputs = {evidence:[{id:'limits-p2',document:'part.pdf',page:2,content,sourceType:'pdf-text-extraction'}]};
  const guidance = {subject:'controller',category:'peripheral',statement:'Place a 100 nF bypass capacitor close to VDD.',citations:[{sourceId:'limits-p2',quote:'Place the bypass capacitor close to VDD.'}]};
  assert.throws(() => extractGuidance({guidance:[guidance]}, inputs), /数值.*100 nF|100 nF.*引用/);
  assert.throws(() => extractGuidance({guidance:[{...guidance,category:'limits',statement:'Maximum current is 50 mA and power dissipation is 400 mW.',citations:[{sourceId:'limits-p2',quote:'The maximum output current is 50 mA.'}]}]}, inputs), /400 mW/);
  assert.equal(extractGuidance({guidance:[{...guidance,statement:'Place the bypass capacitor close to VDD.'}]},inputs).length,1);
});

test('application quantities support equivalent SI units while preserving dimensions and signs', () => {
  const content = 'Use 100 nF bypass and 4.7 kOhm pull-up. Output limit is -50 mA. Supply range is 3-6 V.';
  const inputs = {evidence:[{id:'values',document:'part.pdf',page:3,content,sourceType:'pdf-text-extraction'}]};
  const guidance = {subject:'controller',category:'peripheral',statement:'Use 0.1 uF bypass and 4700 Ohm pull-up. Output limit is -0.05 A. Supply range is 3 to 6 V.',citations:[{sourceId:'values',quote:content}]};
  assert.equal(extractGuidance({guidance:[guidance]},inputs).length,1);
  for (const statement of ['Use 100 uF bypass.','Output limit is +50 mA.','The voltage is 50 mV.']) {
    assert.throws(() => extractGuidance({guidance:[{...guidance,statement}]},inputs), /数值/);
  }
});

