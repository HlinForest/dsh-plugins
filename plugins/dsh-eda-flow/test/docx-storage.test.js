import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { randomUUID } from 'node:crypto';

test('manually uploaded DOCX survives restart without JSON state or extraction exchange files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-docx-'));
  const config = { workspaceRoot: root, workDirectory: root, kicadPython: 'D:/anaconda/python.exe' };
  let flow = new Flow(config);
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  let project = await flow.create({ label: 'DOCX display', designMode: 'new-design', demoPreset: 'display-board' });
  assert.deepEqual(project.uploads,[]);
  const source = new URL('./fixtures/legacy/cases/display-board/mentor/DisplayBoard-Mock-Specifications.docx',import.meta.url);
  project = await flow.upload({projectId:project.id,stage:2},[new File([await fs.readFile(source)],'User-Specifications.docx')]);
  assert.match(project.uploads[0].name, /\.docx$/);
  assert(project.inputs.evidence.some(r => r.content.includes('IRM-3638M3-X')));
  assert(project.inputs.evidence.every(r => r.sourceType === 'docx-text-extraction' && r.page === null && r.section));
  const files = await fs.readdir(flow.dir(project.id), { recursive: true });
  assert(!files.some(f => /(?:project|extract-request|extraction)\.json$/.test(f)));
  await flow.close(); flow = new Flow(config);
  assert.deepEqual((await flow.open(project.id)).inputs, project.inputs);
  const changed = await flow.update({ projectId: project.id, stage: 1, inputs: { requirements: '改为三位显示' } });
  assert.equal(changed.inputs.requirements, '改为三位显示');
  assert.equal(changed.stages[1].confirmed, false);
});

test('legacy migration preserves originals and protected legacy records do not block new projects', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-migration-'));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root });
  t.after(async () => { await flow.close(); await fs.rm(root, { recursive: true, force: true }); });
  const project = await flow.create({ label: 'legacy', designMode: 'new-design' });
  const original = JSON.stringify(project);
  await fs.writeFile(path.join(flow.dir(project.id), 'project.json'), original);
  await fs.unlink(path.join(flow.dir(project.id), 'project.sqlite'));
  assert.equal((await flow.open(project.id)).label, project.label);
  assert.equal(await fs.readFile(path.join(flow.dir(project.id), 'project.json'), 'utf8'), original);
  const blockedId = randomUUID(), blocked = path.join(flow.dir(blockedId), 'project.json');
  await fs.mkdir(flow.dir(blockedId)); await fs.writeFile(blocked, '%TSD-Header-test');
  const next = await flow.create({ label: 'new', designMode: 'new-design' });
  assert.equal((await flow.load(next.id)).label, 'new');
  assert.equal((await flow.list()).find(p => p.id === blockedId).unavailable, true);
  await assert.rejects(flow.open(blockedId), e => e.code === 'encrypted');
  assert.equal(await fs.readFile(blocked, 'utf8'), '%TSD-Header-test');
});
