import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RestorationRuns } from '../src/restoration/service.js';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'native-intake-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const schematic = path.join(root, '原图.SchDoc'), pcb = path.join(root, '板.PcbDoc');
  await fs.writeFile(schematic, 'source sch'); await fs.writeFile(pcb, 'source pcb');
  const service = new RestorationRuns({ workspaceRoot: root, workDirectory: root });
  return { root, schematic, pcb, service };
}
test('native intake rejects paths outside workspace and wrong source types before running a decoder', async t => {
  const f = await fixture(t);
  const outside = path.join(os.tmpdir(), 'outside-' + path.basename(f.root) + '.SchDoc');
  await fs.writeFile(outside, 'outside'); t.after(() => fs.rm(outside, { force: true }));
  await assert.rejects(f.service.dispatch({ action: 'prepare-native', schematic: outside, pcb: f.pcb }), /工作目录/);
  await assert.rejects(f.service.dispatch({ action: 'prepare-native', schematic: f.pcb, pcb: f.pcb }), /schdoc/);
  await assert.rejects(fs.stat(path.join(f.root, 'native-intake')));
});
test('unsupported native semantics retain explicit files and diagnostics but never create a run', async t => {
  const f = await fixture(t);
  f.service.command = async (_exe, args) => {
    const request = JSON.parse(await fs.readFile(args[1]));
    await fs.writeFile(path.join(request.root, 'extraction.json'), JSON.stringify({ eligible: false, issues: ['Unsupported hierarchy'] }));
  };
  await assert.rejects(f.service.dispatch({ action: 'prepare-native', schematic: f.schematic, pcb: f.pcb }), /Unsupported hierarchy/);
  const [entry] = await fs.readdir(path.join(f.root, 'native-intake'));
  const snapshot = path.join(f.root, 'native-intake', entry, '00_native');
  assert.equal(await fs.readFile(path.join(snapshot, path.basename(f.schematic)), 'utf8'), 'source sch');
  assert.equal(await fs.readFile(f.schematic, 'utf8'), 'source sch');
  await assert.rejects(fs.stat(path.join(f.root, 'restoration')));
});
test('source mutation while extracting is rejected instead of freezing mixed revisions', async t => {
  const f = await fixture(t);
  f.service.command = async (_exe, args) => {
    const request = JSON.parse(await fs.readFile(args[1]));
    await fs.writeFile(path.join(request.root, 'extraction.json'), JSON.stringify({ eligible: true, issues: [] }));
    await fs.writeFile(f.schematic, 'changed by another editor');
  };
  await assert.rejects(f.service.dispatch({ action: 'prepare-native', schematic: f.schematic, pcb: f.pcb }), /原文件发生变化/);
  await assert.rejects(fs.stat(path.join(f.root, 'restoration')));
});
