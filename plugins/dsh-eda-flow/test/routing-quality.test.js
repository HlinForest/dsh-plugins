import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {reviewRoutingQuality} from '../src/routing-quality.js';

const workspace = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));

function schematic(wires = []) {
  const records = wires.map(([x1, y1, x2, y2]) => `  (wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0.18) (type default)))`).join('\n');
  return `(kicad_sch (version 20260101)\n${records}\n)`;
}

function readback({pins = {}, nets = [], nc = [], components = []} = {}) {
  return {pins, pinDetails: {}, nets, nc, components};
}

async function fixture(t, {wires = [], pins = {}, nets = [], nc = [], components = [], pageMm = [420, 297], groups = []} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-routing-quality-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.writeFile(path.join(root, 'Circuit.kicad_sch'), schematic(wires));
  await fs.writeFile(path.join(root, 'readback.json'), JSON.stringify(readback({pins, nets, nc, components})));
  return {
    root,
    audit: {layout: {pageMm}},
    layout: {paper: pageMm[0] > 500 ? 'A0-landscape' : 'A3-landscape', groups},
  };
}

function component(reference, x, y) { return {reference, at: [x, y, 0]}; }
function pairNet(name, first, second) { return {name, nodes: [first, second]}; }

test('the archived C artifact fails while the compact layout-fit artifact passes', {skip: !existsSync(path.join(workspace, 'validation', 'withheld-layout', 'C轮旧生成结果', 'Circuit.kicad_sch'))}, async t => {
  const cases = [
    ['C', path.join(workspace, 'validation', 'withheld-layout', 'C轮旧生成结果'), 'failed'],
    ['layout-fit', path.join(workspace, 'validation', 'layout-fit-real-stage3', 'project'), 'passed'],
  ];
  for (const [name, source, expected] of cases) {
    if (!existsSync(path.join(source, 'Circuit.kicad_sch')) || !existsSync(path.join(source, 'readback.json'))) continue;
    const root = await fs.mkdtemp(path.join(os.tmpdir(), `eda-routing-${name}-`));
    t.after(() => fs.rm(root, {recursive: true, force: true}));
    for (const file of ['Circuit.kicad_sch', 'readback.json']) await fs.copyFile(path.join(source, file), path.join(root, file));
    const audit = JSON.parse(await fs.readFile(path.join(source, 'audit.json'), 'utf8'));
    const layout = JSON.parse(await fs.readFile(path.join(source, 'layout-plan.json'), 'utf8'));
    const result = await reviewRoutingQuality({project: root, audit, layout});
    assert.equal(result.status, expected, `${name} status`);
  }
});

test('paper changes do not change the decision for identical geometry', async t => {
  const wires = [[0, 0, 100, 0], [0, 10, 100, 10], [0, 0, 0, 100], [100, 0, 100, 100], [0, 100, 100, 100]];
  const pins = { 'A.1': [0, 0], 'A.2': [100, 0], 'B.1': [0, 10], 'B.2': [100, 10] };
  const nets = [pairNet('N1', 'A.1', 'A.2'), pairNet('N2', 'B.1', 'B.2')];
  const a3 = await fixture(t, {wires, pins, nets, components: [component('A', 0, 0), component('B', 0, 10)], pageMm: [420, 297]});
  const a0 = await fixture(t, {wires, pins, nets, components: [component('A', 0, 0), component('B', 0, 10)], pageMm: [1189, 841]});
  const first = await reviewRoutingQuality({project: a3.root, audit: a3.audit, layout: a3.layout});
  const second = await reviewRoutingQuality({project: a0.root, audit: a0.audit, layout: a0.layout});
  assert.equal(first.status, 'failed');
  assert.equal(second.status, first.status);
  assert.deepEqual(second.metrics.wire, first.metrics.wire);
});

test('two long lines alone are review-only and do not masquerade as a large loop', async t => {
  const data = await fixture(t, {
    wires: [[0, 0, 100, 0], [0, 20, 100, 20]],
    pins: {'A.1': [0, 0], 'A.2': [100, 0], 'B.1': [0, 20], 'B.2': [100, 20]},
    nets: [pairNet('N1', 'A.1', 'A.2'), pairNet('N2', 'B.1', 'B.2')],
    components: [component('A', 0, 0), component('B', 0, 20)],
  });
  const result = await reviewRoutingQuality({project: data.root, audit: data.audit, layout: data.layout});
  assert.equal(result.status, 'passed');
  assert.equal(result.metrics.wire.longSegmentCount, 2);
  assert.deepEqual(result.metrics.graph.railEnvelopeCandidates, []);
  assert.ok(result.findings.some(item => item.code === 'LONG_WIRE_REVIEW'));
});

test('a schematic with no wires and all pins NC passes without a fake routing error', async t => {
  const data = await fixture(t, {pins: {'U1.1': [0, 0]}, nc: ['U1.1'], components: [component('U1', 0, 0)]});
  const result = await reviewRoutingQuality({project: data.root, audit: data.audit, layout: data.layout});
  assert.equal(result.status, 'passed');
  assert.ok(result.findings.some(item => item.code === 'NO_WIRES_ALL_NC'));
  assert.equal(result.metrics.wire.segmentCount, 0);
});

test('missing or malformed project inputs fail closed and leave a report', async t => {
  const data = await fixture(t, {pins: {'U1.1': [0, 0]}, nc: ['U1.1'], components: [component('U1', 0, 0)]});
  await fs.writeFile(path.join(data.root, 'readback.json'), '{broken');
  const malformed = await reviewRoutingQuality({project: data.root, audit: data.audit, layout: data.layout});
  assert.equal(malformed.status, 'failed');
  assert.ok(malformed.findings.some(item => item.code === 'INPUT_INVALID'));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(data.root, 'routing-quality.json'), 'utf8')), malformed);
  const missing = await reviewRoutingQuality({project: path.join(data.root, 'does-not-exist'), audit: data.audit, layout: data.layout});
  assert.equal(missing.status, 'failed');
  assert.ok(missing.findings.some(item => item.code === 'INPUT_INVALID'));
});

