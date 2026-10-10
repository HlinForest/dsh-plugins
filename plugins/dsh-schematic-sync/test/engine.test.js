import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, schematic, placements, patch, synchronize, property, nodes } from '../src/sexpr.js';
import { parseNetlist, compareNative, compareContract, validateContract, unexpectedChanges } from '../src/compare.js';

const sch = `(kicad_sch (version 20250114) (uuid "root") (paper "A4")
 (lib_symbols (symbol "Device:R" (symbol "R_1_1" (pin passive line (at 0 3.81 270) (number "1") (name "~")))))
 (symbol (lib_id "Device:R") (at 20 20 0) (unit 1) (uuid "r1") (dnp no)
   (property "Reference" "R1") (property "Value" "10k") (property "Footprint" "")
   (instances (project "old" (path "/root" (reference "R1") (unit 1)))))
 (wire (pts (xy 20 20) (xy 25 20)) (uuid "w1")))`;
const board = () => ({ components: [{ ref: 'R1', value: '10k', footprint: '', libId: 'Device:R', dnp: false, properties: {} }, { ref: 'C1', value: '100n', footprint: '', libId: 'Device:C', dnp: false, properties: {} }], nets: [{ name: 'Net-(R1-Pad1)', nodes: [{ ref: 'R1', pin: '1' }, { ref: 'C1', pin: '1' }] }, { name: 'GND', nodes: [{ ref: 'R1', pin: '2' }, { ref: 'C1', pin: '2' }] }] });
const requirement = (extra = {}) => ({ id: 'r1', kind: 'component', ref: 'R1', properties: { value: '10k' }, certain: true, evidence: { quote: 'R1=10k' }, ...extra });
const contract = requirements => ({ schemaVersion: 1, scope: 'partial', requirements, unresolved: [] });

test('parser preserves escaped Unicode strings and rejects malformed input', () => {
  const p = parse('(text "电阻\\\"\\nΩ")'); assert.equal(p.children[1].value, '电阻"\nΩ');
  for (const bad of ['(x', '(x) (y)', '(x "unterminated)', ')']) assert.throws(() => parse(bad));
});
test('property patch preserves wires and handles DNP plus multiple new properties', () => {
  const next = patch(sch, [{ op: 'set_properties', ref: 'R1', properties: { Value: '22k', dnp: true, MPN: 'ABC', Vendor: 'D' } }]);
  assert.ok(next.includes('(wire (pts (xy 20 20) (xy 25 20)) (uuid "w1"))'));
  assert.equal(placements(next)[0].value, '22k'); assert.equal(placements(next)[0].dnp, true);
  assert.equal(placements(next)[0].properties.MPN, 'ABC'); assert.equal(placements(next)[0].properties.Vendor, 'D');
  assert.throws(() => patch(sch, [{ op: 'set_properties', ref: 'R2', properties: { Value: '5k' } }]));
});
test('UUID replacement can repair wires; inserts/deletes preserve unaffected objects', () => {
  const next = patch(sch, [{ op: 'replace', uuid: 'w1', sexpr: '(wire (pts (xy 20 20) (xy 30 20)) (uuid "w1"))' }, { op: 'insert', sexpr: '(label "GND" (at 30 20 0) (uuid "l1"))' }]);
  assert.ok(next.includes('(xy 30 20)')); assert.equal(placements(next)[0].uuid, 'r1');
  assert.ok(!patch(next, [{ op: 'delete', uuid: 'l1' }]).includes('(label'));
  assert.throws(() => patch(sch, [{ op: 'insert', sexpr: '(wire (uuid "w1"))' }]));
  assert.throws(() => patch(sch, [{ op: 'replace', uuid: 'w1', sexpr: '(wire (uuid "w2"))' }]));
  assert.throws(() => patch(sch, [{ op: 'insert', sexpr: '(sheet (uuid "s1"))' }]));
});
test('native sync preserves root/component PCB links and rebinds project instance', () => {
  const target = sch.replaceAll('"root"', '"newroot"').replace('/root', '/newroot').replace('"r1"', '"newr1"').replace('"10k"', '"22k"');
  const next = synchronize(sch, target, 'Board');
  assert.equal(placements(next)[0].uuid, 'r1'); assert.equal(placements(next)[0].value, '22k');
  assert.ok(next.includes('(uuid "root")')); assert.ok(next.includes('(project "Board" (path "/root"'));
});
test('native compare ignores automatic net names and detects shorts/missing pins and explicit labels', () => {
  const a = board(), b = board(); b.nets[0].name = 'Net-(C1-Pad1)';
  assert.equal(compareNative(a, b, sch, sch).matches, true);
  b.nets[1].name = 'AGND'; assert.equal(compareNative(a, b, sch, sch).electricalMatches, false);
  b.nets[1].name = 'GND'; b.nets[0].nodes.push({ ref: 'C1', pin: '2' });
  assert.ok(compareNative(a, b, sch, sch).differences.some(d => d.kind === 'target_connection'));
});
test('layout comparison notices changed library pin geometry and drawing positions', () => {
  assert.equal(compareNative(board(), board(), sch, sch.replace('(at 0 3.81 270)', '(at 0 5.08 270)')).layoutMatches, false);
  const r = compareNative(board(), board(), sch, sch.replace('(at 20 20 0)', '(at 30 20 0)'));
  assert.equal(r.electricalMatches, true); assert.equal(r.matches, false);
});
test('interpreted targets require original evidence, explicit uncertainty and partial scope', () => {
  assert.equal(validateContract(contract([requirement()]), 'text', 'set R1=10k').scope, 'partial');
  assert.throws(() => validateContract(contract([requirement()]), 'text', 'R1=22k'));
  assert.throws(() => validateContract({ ...contract([requirement()]), scope: 'complete' }, 'text', 'R1=10k'));
  assert.throws(() => validateContract(contract([requirement()]), 'image'));
  assert.throws(() => validateContract(contract([requirement(), requirement()]), 'text', 'R1=10k'));
});
test('unknown/unresolved targets never pass, absent pin cannot prove disconnected', () => {
  const c = contract([requirement()]); assert.equal(compareContract(board(), c).matches, true);
  assert.equal(compareContract(board(), c).wholeSchematicEquality, false);
  c.unresolved.push('Unclear wire'); assert.equal(compareContract(board(), c).matches, false);
  const missing = contract([requirement({ kind: 'disconnected', pins: [{ ref: 'R1', pin: '1' }, { ref: 'R2', pin: '1' }] })]);
  assert.equal(compareContract(board(), missing).checks[0].status, 'unknown');
});
test('exact connectivity forbids extra endpoints while subset requirements permit them', () => {
  const b = board(); b.nets[0].nodes.push({ ref: 'U1', pin: '1' });
  const r = requirement({ kind: 'connected', pins: [{ ref: 'R1', pin: '1' }, { ref: 'C1', pin: '1' }] });
  assert.equal(compareContract(b, contract([r])).matches, true);
  r.exact = true; assert.equal(compareContract(b, contract([r])).matches, false);
});
test('XML rejects DTD; retains string pin numbers and DNP', () => {
  assert.throws(() => parseNetlist('<!DOCTYPE x><export/>'));
  const xml = '<export><components><comp ref="R1"><value>10k</value><libsource lib="Device" part="R"/><property name="dnp"/></comp></components><nets><net name="N"><node ref="R1" pin="01"/></net></nets></export>';
  const b = parseNetlist(xml); assert.equal(b.nets[0].nodes[0].pin, '01'); assert.equal(b.components[0].dnp, true);
});
test('partial target blocks deleting/changing unrelated components or rewiring unrelated pins', () => {
  const a = board(), b = board(), c = contract([requirement({ properties: { value: '22k' } })]);
  b.components[0].value = '22k'; assert.deepEqual(unexpectedChanges(a, b, c), []);
  b.components[1].value = '1n'; assert.equal(unexpectedChanges(a, b, c)[0].kind, 'undeclared_property');
  b.components[1].value = '100n'; b.components.pop(); assert.ok(unexpectedChanges(a, b, c).some(x => x.kind === 'undeclared_removal'));
  const next = board(); next.nets[0].nodes.pop(); assert.ok(unexpectedChanges(a, next, c).some(x => x.kind === 'undeclared_topology'));
  const renamed = board(); renamed.nets[1].name = 'VCC'; assert.ok(unexpectedChanges(a, renamed, c).some(x => x.kind === 'undeclared_net_name'));
});
