import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readDesign, happy } from '../src/engineering/adapters.js';
import { compare, suggestMappings, reviewRules } from '../src/engineering/model.js';
const fixture = fileURLToPath(new URL('../examples/independent/', import.meta.url));
const cli = process.env.ENGINEERING_KICAD_CLI || 'D:/Kicad/bin/kicad-cli.exe';
const config = { kicadCli: cli, engineeringPython: process.env.ENGINEERING_PYTHON || 'D:/VisualBoard/dsh-engineering-tools/.venv/Scripts/python.exe', happyRoot: process.env.ENGINEERING_HAPPY_ROOT || 'D:/VisualBoard/dsh-engineering-tools/kicad-happy' };
test('成对原生黄金样例：改位号、改布局、改参数、漏件、DNP、短接', { skip: !(await fs.stat(cli).catch(() => null)) }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-golden-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const base = await readDesign(path.join(fixture, 'divider.kicad_sch'), path.join(dir, 'base'), config);
  const cases = JSON.parse(await fs.readFile(path.join(fixture, 'cases.json'), 'utf8'));
  const report = { cases: [], falsePositives: 0, falseNegatives: 0, uncovered: ['full-circuit simulation', 'AD 25/26 native validation', 'unlabelled datasheet extraction accuracy'] };
  for (const sample of cases.native) {
    const b = await readDesign(path.join(fixture, sample.target), path.join(dir, sample.target), config);
    const maps = suggestMappings(base, b).map(m => ({ ...m, confirmed: true }));
    const result = compare(base, b, maps);
    for (const kind of ['components', 'connectivity']) if (sample[kind]) assert.equal(result.conclusions[kind], sample[kind], `${sample.target}: ${kind}`);
    report.cases.push({ sample: sample.target, result: result.conclusions });
  }
  const decouple = { id: 'decoupling', kind: 'decoupling', component: base.components.find(c => c.ref === 'R1').id, pin: '1', returnNet: base.nets.find(n => /(^|\/)GND$/.test(n.name)).name, evidence: [{ quote: 'Fixture C1 explicitly bridges +5V to GND' }] };
  assert.equal(reviewRules(base, [decouple])[0].status, 'pass');
  const missing = await readDesign(path.join(fixture, 'missing-decoupling.kicad_sch'), path.join(dir, 'missing'), config);
  assert.equal(reviewRules(missing, [{ ...decouple, component: missing.components.find(c => c.ref === 'R1').id }])[0].status, 'fail');
  if (process.env.ENGINEERING_EVAL_OUTPUT) { await fs.mkdir(process.env.ENGINEERING_EVAL_OUTPUT, { recursive: true }); await fs.writeFile(path.join(process.env.ENGINEERING_EVAL_OUTPUT, 'native-pairs.json'), JSON.stringify(report, null, 2)); }
});
test('固定上游版本：分压数值与去耦检出对照原生样例；漏件不产生伪去耦', { skip: !(await fs.stat(config.engineeringPython).catch(() => null)) || !(await fs.stat(config.happyRoot).catch(() => null)) }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-upstream-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const first = await happy(path.join(fixture, 'divider.kicad_sch'), dir, config);
  const divider = first.findings.find(f => f.rule_id === 'VD-DET'); assert.ok(divider); assert.equal(divider.r_top.ohms, 10000); assert.equal(divider.r_bottom.ohms, 20000); assert.ok(Math.abs(divider.ratio - 2/3) < 1e-6);
  assert.equal(first.findings.find(f => f.rule_id === 'DC-DET').cap_count, 1);
  const missing = await happy(path.join(fixture, 'missing-decoupling.kicad_sch'), dir, config);
  assert.equal(missing.findings.filter(f => f.rule_id === 'DC-DET' && f.cap_count).length, 0);
  const dnp = await happy(path.join(fixture, 'dnp-capacitor.kicad_sch'), dir, config);
  assert.equal(dnp.findings.filter(f => f.rule_id === 'DC-DET' && f.cap_count).length, 0);
  assert.ok(dnp.suppressed.some(f => f.rule === 'DC-DET' && f.components.includes('C1')));
});
