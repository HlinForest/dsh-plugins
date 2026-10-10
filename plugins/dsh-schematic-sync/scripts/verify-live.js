import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SyncService } from '../src/service.js';
import { hash } from '../src/io.js';
import { placements, patch } from '../src/sexpr.js';

const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(base, '..');
const out = path.join(base, 'verification', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(out, { recursive: true });
const originalPath = path.join(root, 'DisplayBoard.kicad_sch');
const original = await fs.readFile(originalPath, 'utf8'), originalHash = hash(original);
const current = path.join(out, 'Current.kicad_sch'), target = path.join(out, 'Target.kicad_sch');
await fs.copyFile(path.join(root, 'DisplayBoard.kicad_sym'), path.join(out, 'DisplayBoard.kicad_sym'));
await fs.copyFile(path.join(root, 'sym-lib-table'), path.join(out, 'sym-lib-table'));
await fs.copyFile(path.join(root, 'DisplayBoard.kicad_pro'), path.join(out, 'Current.kicad_pro'));
await fs.copyFile(path.join(root, 'DisplayBoard.kicad_pro'), path.join(out, 'Target.kicad_pro'));
await fs.writeFile(target, original);
const broken = patch(original, [{ op: 'set_properties', ref: 'R1', properties: { Value: '999k', dnp: true } },
  { op: 'delete', uuid: placements(original).find(p => p.ref === 'R2').uuid }]);
await fs.writeFile(current, broken);
const service = new SyncService({ workspaceRoot: out, workDirectory: path.join(out, 'tasks'), kicadCli: process.env.KICAD_CLI || 'D:/Kicad/bin/kicad-cli.exe', python: 'D:/anaconda/python.exe', allowApply: true });
const began = await service.begin({ currentPath: current, targetPath: target });
const compared = await service.compare(began.taskId);
assert.equal(compared.matches, false); assert.ok(compared.differences.some(d => d.ref === 'R1'));
assert.ok(compared.differences.some(d => d.kind === 'missing_component' && d.ref === 'R2'));
assert.ok(compared.differences.some(d => d.kind === 'target_connection'));
const inspected = await service.inspect(began.taskId, 'candidate');
const prepared = await service.prepare(began.taskId, inspected.revision);
const verified = await service.verify(began.taskId);
assert.equal(verified.canApply, true, JSON.stringify(verified));
const lockPath = path.join(out, '~Current.kicad_pro.lck');
await fs.writeFile(lockPath, 'test lock');
await assert.rejects(service.apply(began.taskId, verified.token), /locked/);
await fs.unlink(lockPath);
const applied = await service.apply(began.taskId, verified.token);
assert.equal(placements(await fs.readFile(current, 'utf8')).find(p => p.ref === 'R1').value, placements(original).find(p => p.ref === 'R1').value);
const rolledBack = await service.rollback(began.taskId);
assert.equal(await fs.readFile(current, 'utf8'), broken);
// Use a complete current design for subsequent text-only property tests.
await fs.writeFile(current, original);

const text = '将 R1 改为 330Ω；R1 必须装配。';
const textTask = await service.begin({ currentPath: current, targetText: text });
await service.define(textTask.taskId, textTask.target.revision, { schemaVersion: 1, scope: 'partial', requirements: [{ id: 'r1', kind: 'component', ref: 'R1', properties: { value: '330Ω', dnp: false }, certain: true, evidence: { quote: text } }], unresolved: [] });
const ti = await service.inspect(textTask.taskId, 'candidate');
await service.prepare(textTask.taskId, ti.revision);
const tv = await service.verify(textTask.taskId); assert.equal(tv.canApply, true, JSON.stringify(tv));
assert.equal(tv.comparison.wholeSchematicEquality, false);
// Stale verification is rejected, even when the candidate still parses.
await fs.appendFile(tv.candidateManifest[0].path, '\n');
await assert.rejects(service.apply(textTask.taskId, tv.token), /changed/);
await assert.rejects(service.begin({ currentPath: originalPath, targetText: text }), /escapes/);

const pdfTarget = await service.begin({ currentPath: current, targetPath: verified.pdf });
const preview = await service.reference(pdfTarget.taskId, 1, false);
assert.ok(preview.preview.width > 100); assert.ok(preview.preview.text.includes('R1'));
const imageTarget = await service.begin({ currentPath: current, targetPath: preview.preview.image });
const imagePreview = await service.reference(imageTarget.taskId, 1, true);
assert.equal(imagePreview.status, 'needs_visual_interpretation');
await service.define(imageTarget.taskId, imageTarget.target.revision, { schemaVersion: 1, scope: 'partial', requirements: [{ id: 'ambiguous', kind: 'component', ref: 'R1', properties: { value: '220Ω' }, certain: false, evidence: { page: 1, quote: 'R1 near U1' } }], unresolved: ['Value unreadable'] });
const unknown = await service.compare(imageTarget.taskId); assert.equal(unknown.matches, false);
assert.equal(hash(await fs.readFile(originalPath)), originalHash);
const report = { checkedAt: new Date().toISOString(), native: { before: compared, prepared, verified, applied, rolledBack }, text: tv, pdf: preview, image: imagePreview, originalUntouched: true,
  checks: ['native property/DNP mismatch detected', 'missing component and changed topology detected and repaired', 'target synchronized and same-ref UUID retained', 'KiCad netlist equality after repair', 'ERC zero errors', 'PDF exported', 'KiCad open-project lock blocks application', 'applied to disposable test copy', 'exact backup rollback', 'text property repair', 'stale candidate rejected', 'workspace escape rejected', 'PDF raster/text ingestion', 'image ingestion without pretending vision is configured', 'ambiguous source blocks equality'] };
await fs.writeFile(path.join(out, 'verification.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ verification: path.join(out, 'verification.json'), checks: report.checks, pdf: verified.pdf, currentProjectUntouched: true }, null, 2));
