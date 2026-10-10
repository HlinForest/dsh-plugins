import test from 'node:test';
import assert from 'node:assert/strict';
import { schematicChanges } from '../src/schematic-changes.js';

const sheet = content => `(kicad_sch (uuid "sheet") (lib_symbols) ${content})`;
const part = (ref, val, x) => `(symbol (lib_id "Device:R") (at ${x} 20 0) (unit 1) (uuid "${ref}") (property "Reference" "${ref}") (property "Value" "${val}"))`;
const wire = (id, end) => `(wire (pts (xy 10 20) (xy ${end} 20)) (uuid "${id}"))`;

test('前后变化保留两侧各自位置，改值和移位可定位', () => {
  const diff = schematicChanges(sheet(part('R1', '10k', 10)), sheet(part('R1', '22k', 70)));
  assert.deepEqual(diff.counts, { components: 1, wires: 0, other: 0 });
  assert.deepEqual(diff.changes[0].before.points, [[10, 20]]);
  assert.deepEqual(diff.changes[0].after.points, [[70, 20]]);
  assert.equal(diff.changes[0].fields.find(f => f.name === '数值').before, '10k');
  assert.equal(diff.parts.before[0].value, '10k');
  assert.equal(diff.parts.after[0].value, '22k');
});

test('导线新增、删除、重布以及网络标签改名均显示；忽略排版空白', () => {
  const before = sheet(wire('moved', 30) + wire('removed', 50) + '(label "GND" (at 10 20 0) (uuid "label"))');
  const after = sheet(wire('moved', 40) + wire('added', 60) + '(label "SGND" (at 10 20 0) (uuid "label"))');
  const diff = schematicChanges(before, after);
  assert.equal(diff.counts.wires, 3);
  assert.equal(diff.changes.find(c => c.id === 'removed').after, null);
  assert.equal(diff.changes.find(c => c.id === 'added').before, null);
  assert.deepEqual(diff.changes.find(c => c.id === 'label').fields[0], { name: '网络标签', before: 'GND', after: 'SGND' });
  assert.equal(schematicChanges(before, before.replaceAll(' ', '\n')).changes.length, 0);
});

test('删除与新增元件不借用另一侧坐标', () => {
  const diff = schematicChanges(sheet(part('R1', '10k', 10)), sheet(part('R2', '22k', 70)));
  assert.equal(diff.changes[0].after, null);
  assert.equal(diff.changes[1].before, null);
});

test('只调整符号引脚排列也显示为变化，聚焦范围包含真实引脚', () => {
  const base = sheet(part('R1', '10k', 10));
  const library = (x, y) => `(lib_symbols (symbol "Device:R" (symbol "R_1_1" (pin passive line (at ${x} ${y} 0) (number "1")))))`;
  const diff = schematicChanges(base.replace('(lib_symbols)', library(-10, 30)), base.replace('(lib_symbols)', library(10, -30)));
  assert.equal(diff.changes.length, 1);
  assert.equal(diff.changes[0].fields[0].name, '引脚 / 符号图形');
  assert.deepEqual(diff.changes[0].before.points[1], [0, -10]);
  assert.deepEqual(diff.changes[0].after.points[1], [20, 50]);
});
