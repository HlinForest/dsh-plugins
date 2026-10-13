import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { RestorationRuns, projectFiles, replayCodeFiles } from '../src/restoration/service.js';
const digest = b => createHash('sha256').update(b).digest('hex');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'restore-test-')); t.after(() => fs.rm(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'); await fs.mkdir(input);
  const p = '02_extracted/native_schematic/';
  const data = { '00_native/test.SchDoc': 'original schematic', '00_native/test.PcbDoc': 'original board',
    [p + 'components.json']: [{ reference: 'R1', source_locator: { record_index: 8 }, owned_record_indices: [9], raw_fields: { UniqueID: 'ABC' }, parameters: [] }],
    [p + 'pins.json']: [{ reference: 'R1', pin: '1', fields: { 'Location.X': '20' } }],
    [p + 'FileHeader.records.json']: { records: [{ index: 9, fields: { RECORD: '4', OwnerIndex: '7', Text: 'body' } }] },
    [p + 'recomputed_connectivity.json']: { pins: [{ ref: 'R1', pin: '1', endpoint: [30, 10] }], nets: [{ nodes: [['R1', '1']], labels: [] }] },
  };
  const files = [];
  for (const [name, value] of Object.entries(data)) { const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)); const file = path.join(input, name); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, bytes); files.push({ path: name, sha256: digest(bytes), bytes: bytes.length }); }
  const manifest = path.join(input, 'manifest.json'); await fs.writeFile(manifest, JSON.stringify({ format: 'harness-native-input/1', project: 'fixture', files }));
  const service = new RestorationRuns({ workspaceRoot: root, workDirectory: root }); return { root, input, manifest, files, service };
}
test('freeze copies only original allowlist and preserves endpoint semantics', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.input, 'old-R6.kicad_sch'), 'excluded');
  const run = await f.service.dispatch({ action: 'create', manifest: f.manifest });
  assert.equal(run.fileCount, 6); assert.equal(run.completeOneToOneVerified, false);
  assert.equal(await fs.stat(path.join(f.service.dir(run.id), 'input', 'old-R6.kicad_sch')).catch(() => null), null);
  const part = await f.service.dispatch({ action: 'inspect', runId: run.id, reference: 'R1' });
  assert.deepEqual(part.pins[0].electricalEndpoint, [30, 10]); assert.equal(part.ownedRecords[0].fields.Text, 'body');
  assert.equal((await f.service.dispatch({ action: 'list' })).length, 1);
});
test('changed source hash and injected historical script are rejected', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.input, f.files[0].path), 'changed');
  await assert.rejects(f.service.dispatch({ action: 'create', manifest: f.manifest }), /哈希/);
  const m = JSON.parse(await fs.readFile(f.manifest)); m.files[0].path = '00_native/old_rebuild.py'; await fs.writeFile(f.manifest, JSON.stringify(m));
  await assert.rejects(f.service.dispatch({ action: 'create', manifest: f.manifest }), /白名单/);
});
test('traversal and duplicate paths cannot enter evidence snapshots', async t => {
  const f = await fixture(t), m = JSON.parse(await fs.readFile(f.manifest));
  m.files.push({ ...m.files[0], path: '../outside.SchDoc' }); await fs.writeFile(f.manifest, JSON.stringify(m));
  await assert.rejects(f.service.create({ manifest: f.manifest }), /白名单/);
  m.files.pop(); m.files.push({ ...m.files[0] }); await fs.writeFile(f.manifest, JSON.stringify(m));
  await assert.rejects(f.service.create({ manifest: f.manifest }), /白名单/);
});
test('input tampering blocks use; project or report mutation invalidates review', async t => {
  const f = await fixture(t), view = await f.service.dispatch({ action: 'create', manifest: f.manifest }), run = await f.service.load(view.id);
  const dir = path.join(f.root, 'project'); await fs.mkdir(dir); const project = path.join(dir, 'x.kicad_pro'); await fs.writeFile(project, '{}'); await fs.writeFile(path.join(dir, 'x.kicad_sch'), 'first');
  const report = path.join(f.service.dir(run.id), 'report.json'); await fs.writeFile(report, '{}');
  run.validation = { project, stage: 'full', status: 'PARTIAL', schematicStatus: 'PARTIAL', report, reportHash: digest('{}'), projectHash: digest(JSON.stringify(await projectFiles(project))) }; await f.service.save(run);
  assert.equal((await f.service.present(run)).validationFresh, true);
  await assert.rejects(f.service.dispatch({ action: 'review', runId: run.id, reportHash: digest('{}'), decision: 'demo-reviewed', note: 'x' }), /工程师/);
  await f.service.dispatch({ action: 'review', runId: run.id, reportHash: digest('{}'), decision: 'demo-reviewed', note: 'x' }, undefined, 'human');
  await fs.writeFile(path.join(dir, 'x.kicad_sch'), 'second');
  const changed = await f.service.present(await f.service.load(run.id)); assert.equal(changed.validation.status, 'STALE'); assert.equal(changed.review.stale, true);
  await fs.writeFile(path.join(f.service.dir(run.id), 'input', f.files[0].path), 'changed');
  await assert.rejects(f.service.dispatch({ action: 'inspect', runId: run.id }), /变化/);
});
test('nonzero command exit cannot count as success even when it creates an output', async t => {
  const f = await fixture(t), output = path.join(f.root, 'created.txt'), log = path.join(f.root, 'command.json');
  await assert.rejects(f.service.command(process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1],"partial");process.exit(3)', output], log), /失败/);
  assert.equal((await fs.readFile(output)).toString(), 'partial'); assert.equal((JSON.parse(await fs.readFile(log))).exitCode, 3);
});
test('replay code freshness ignores generated engineering files but detects source edits', async t => {
  const f = await fixture(t), entry = path.join(f.root, 'restore.py'); await fs.writeFile(entry, 'print(1)');
  const before = await replayCodeFiles(entry); const output = path.join(f.root, 'generated'); await fs.mkdir(output); await fs.writeFile(path.join(output, 'x.kicad_pcb'), 'generated board');
  assert.deepEqual(await replayCodeFiles(entry), before);
  await fs.writeFile(entry, 'print(2)'); assert.notDeepEqual(await replayCodeFiles(entry), before);
});

test('project freshness includes local drawing sheets and font dependencies', async t => {
  const f = await fixture(t), project = path.join(f.root, 'project.kicad_pro');
  await fs.writeFile(project, '{}');
  await fs.writeFile(path.join(f.root, 'frame.kicad_wks'), 'first frame');
  await fs.mkdir(path.join(f.root, 'fonts'));
  await fs.writeFile(path.join(f.root, 'fonts', 'design.ttf'), 'font bytes');
  const before = await projectFiles(project);
  assert.ok(before.some(row => row.path === 'frame.kicad_wks'));
  assert.ok(before.some(row => row.path === 'fonts/design.ttf'));
  await fs.writeFile(path.join(f.root, 'frame.kicad_wks'), 'changed frame');
  assert.notDeepEqual(await projectFiles(project), before);
});
test('changed rule mapping or font evidence invalidates an existing review', async t => {
  const f = await fixture(t), view = await f.service.dispatch({ action: 'create', manifest: f.manifest });
  const dir = path.join(f.root, 'project'); await fs.mkdir(dir);
  const project = path.join(dir, 'x.kicad_pro'); await fs.writeFile(project, '{}');
  const report = path.join(f.service.dir(view.id), 'report.json'); await fs.writeFile(report, '{}');
  for (const name of ['design_rule_mapping.json', 'font_usage_manifest.json', 'design.ttc']) {
    const file = path.join(dir, name); await fs.writeFile(file, 'original evidence');
    const run = await f.service.load(view.id);
    run.validation = { project, stage: 'full', status: 'PARTIAL', schematicStatus: 'PARTIAL', report, reportHash: digest('{}'), projectHash: digest(JSON.stringify(await projectFiles(project))) };
    await f.service.save(run);
    await f.service.dispatch({ action: 'review', runId: run.id, reportHash: digest('{}'), decision: 'demo-reviewed', note: 'test fixture only' }, undefined, 'human');
    await fs.writeFile(file, 'changed evidence');
    const changed = await f.service.present(await f.service.load(run.id));
    assert.equal(changed.validation.status, 'STALE', name); assert.equal(changed.review.stale, true, name);
  }
});
test('datasheet binding requires actual refs, model/package and hashed page evidence', async t => {
  const f = await fixture(t), run = await f.service.dispatch({ action: 'create', manifest: f.manifest });
  f.service.engineering = { load: async () => ({ id: 'manual', kind: 'datasheet', label: 'test PDF' }), manuals: { document: async () => ({ sourceHash: 'a'.repeat(64), pages: [{ page: 1 }] }), status: async () => ({ book: { facts: [{ name: 'voltage', value: '5', citations: [{ page: 1, quote: 'Supply 5 V', sourceHash: 'a'.repeat(64) }], reviewed: false }] } }) } };
  const request = { action: 'bind-datasheet', runId: run.id, taskId: 'manual', mpn: 'TEST', package: '0603', references: ['missing'] };
  await assert.rejects(f.service.dispatch(request), /位号/);
  const bound = await f.service.dispatch({ ...request, references: ['R1'] }); assert.equal(bound.datasheets[0].reviewed, false); assert.equal(bound.datasheets[0].reading.book.facts[0].citations[0].page, 1);
});
