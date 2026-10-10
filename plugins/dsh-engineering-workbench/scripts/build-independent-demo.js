import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { modifyKiCad, inventory } from '../src/engineering/kicad.js';
const out = fileURLToPath(new URL('../examples/independent/', import.meta.url)); await fs.mkdir(out, { recursive: true });
const id = name => { const s = createHash('md5').update('workbench-independent-demo:' + name).digest('hex'); return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`; };
const effects = '(effects (font (size 1.27 1.27)))';
const library = name => `(symbol "Demo:${name}" (pin_names (offset 0)) (in_bom yes) (on_board yes)
 (property "Reference" "${name}" (at 0 0 0) ${effects}) (property "Value" "${name}" (at 0 0 0) ${effects})
 (symbol "${name}_0_1" ${name === 'R' ? '(rectangle (start -1.016 2.54) (end 1.016 -2.54) (stroke (width 0.254) (type default)) (fill (type none)))' : '(polyline (pts (xy -2.032 0.762) (xy 2.032 0.762)) (stroke (width 0.254) (type default)) (fill (type none))) (polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762)) (stroke (width 0.254) (type default)) (fill (type none)))'})
 (symbol "${name}_1_1" (pin passive line (at 0 3.81 270) (length ${name === 'R' ? 1.27 : 3.048}) (name "1" ${effects}) (number "1" ${effects})) (pin passive line (at 0 -3.81 90) (length ${name === 'R' ? 1.27 : 3.048}) (name "2" ${effects}) (number "2" ${effects}))))`;
const symbol = (ref, val, x, y) => `(symbol (lib_id "Demo:${ref[0]}") (at ${x} ${y} 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid "${id(ref)}") (property "Reference" "${ref}" (at ${x+5.08} ${y-1.27} 0) ${effects}) (property "Value" "${val}" (at ${x+5.08} ${y+1.27} 0) ${effects}) (property "Footprint" "${ref[0] === 'R' ? 'Resistor_SMD:R_0603_1608Metric' : 'Capacitor_SMD:C_0603_1608Metric'}" (at ${x} ${y} 0) (effects (font (size 1.27 1.27)) hide)) (property "Datasheet" "" (at ${x} ${y} 0) (effects (font (size 1.27 1.27)) hide)) (instances (project "divider" (path "/${id('root')}" (reference "${ref}") (unit 1)))))`;
const wire = (name, a, b) => `(wire (pts (xy ${a}) (xy ${b})) (stroke (width 0) (type default)) (uuid "${id(name)}"))`;
const label = (name, x, y, suffix = '') => `(label "${name}" (at ${x} ${y} 0) (effects (font (size 1.27 1.27)) (justify left bottom)) (uuid "${id(name+suffix)}"))`;
const base = `(kicad_sch (version 20250114) (generator "eeschema") (uuid "${id('root')}") (paper "A4")
 (title_block (title "Independent workbench demo / unloaded divider") (rev "A"))
 (lib_symbols ${library('R')} ${library('C')})
 ${symbol('R1','10k',76.2,76.2)} ${symbol('R2','20k',76.2,96.52)} ${symbol('C1','100nF',104.14,76.2)}
 ${wire('middle','76.2 80.01','76.2 92.71')} ${wire('supply','76.2 72.39','104.14 72.39')}
 ${label('+5V',76.2,72.39)} ${label('OUT',76.2,86.36)} ${label('GND',76.2,100.33)} ${label('GND',104.14,80.01,'-cap')}
)`;
const write = (name, text) => fs.writeFile(path.join(out, name + '.kicad_sch'), text.replace(/[ \t]+$/gm, ''));
inventory(base, 'divider.kicad_sch'); await write('divider', base);
await write('changed-value', modifyKiCad(base, 'divider.kicad_sch', [{ op: 'properties', id: 'divider.kicad_sch#' + id('R1'), properties: { Value: '22k' } }]));
await write('missing-decoupling', modifyKiCad(base, 'divider.kicad_sch', [{ op: 'delete', id: 'divider.kicad_sch#' + id('C1') }]));
await write('dnp-capacitor', modifyKiCad(base, 'divider.kicad_sch', [{ op: 'properties', id: 'divider.kicad_sch#' + id('C1'), properties: { dnp: true } }]));
await write('shorted-resistor', modifyKiCad(base, 'divider.kicad_sch', [{ op: 'wire', from: [76.2,72.39], to: [76.2,80.01] }]));
await write('renamed-reference', base.replaceAll('"R1"', '"R99"'));
await write('moved-layout', modifyKiCad(base, 'divider.kicad_sch', [{ op: 'move', id: 'divider.kicad_sch#' + id('C1'), at: [114.3,76.2] }]));
await fs.writeFile(path.join(out, 'cases.json'), JSON.stringify({ schemaVersion: 1, source: 'hand-authored educational fixtures; not production circuitry', native: [
  { target: 'renamed-reference.kicad_sch', connectivity: 'pass' }, { target: 'moved-layout.kicad_sch', connectivity: 'pass' },
  { target: 'changed-value.kicad_sch', components: 'fail', connectivity: 'pass' }, { target: 'missing-decoupling.kicad_sch', components: 'unknown' },
  { target: 'dnp-capacitor.kicad_sch', components: 'fail' }, { target: 'shorted-resistor.kicad_sch', connectivity: 'fail' }],
  condition: 'Vin=5V; output unloaded; ideal DC divider. Expected baseline Vout=3.333333V. Changed 22k top resistor produces 2.380952V.' }, null, 2));
console.log('Created 7 native schematic examples and their expected outcomes.');
