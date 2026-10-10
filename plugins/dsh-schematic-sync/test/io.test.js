import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inside, hash, assertFresh, withProjectLock, atomicReplace } from '../src/io.js';
import { SyncService } from '../src/service.js';

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(tmpdir(), 'schematic-sync-test-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(tmpdir()));
    assert.ok(path.basename(dir).startsWith('schematic-sync-test-'));
    await fs.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'Board.kicad_sch'); await fs.writeFile(file, 'original');
  return { dir, file };
}
test('read containment and stale-hash checks reject escapes and changed content', async t => {
  const { dir, file } = await fixture(t);
  await assert.rejects(inside(dir, '../outside'), /escapes/);
  const manifest = [{ path: file, hash: hash('original') }]; await assertFresh(manifest);
  await atomicReplace(file, 'modified'); await assert.rejects(assertFresh(manifest), /changed/);
});
test('write locks serialize independent instances and are released after failure', async t => {
  const { file } = await fixture(t);
  await withProjectLock(file, async () => { await assert.rejects(withProjectLock(file, async () => {}), /active/); });
  await assert.rejects(withProjectLock(file, async () => { throw new Error('interrupted'); }), /interrupted/);
  await withProjectLock(file, async () => {});
});
test('rollback restores exact backup and rejects later human edits', async t => {
  const { dir, file } = await fixture(t), workDirectory = path.join(dir, 'tasks');
  const service = new SyncService({ workspaceRoot: dir, workDirectory }); await service.init();
  const id = '11111111-1111-4111-8111-111111111111', taskDir = path.join(workDirectory, id);
  await fs.mkdir(taskDir); await fs.writeFile(path.join(taskDir, 'task.json'), JSON.stringify({ id, current: file }));
  await fs.writeFile(path.join(taskDir, 'original.kicad_sch'), 'original');
  await fs.writeFile(path.join(taskDir, 'applied.json'), JSON.stringify({ before: hash('original'), after: hash('candidate') }));
  await fs.writeFile(file, 'human edit'); await assert.rejects(service.rollback(id), /changed/);
  assert.equal(await fs.readFile(file, 'utf8'), 'human edit');
  await fs.writeFile(file, 'candidate'); assert.equal((await service.rollback(id)).status, 'restored');
  assert.equal(await fs.readFile(file, 'utf8'), 'original');
});
