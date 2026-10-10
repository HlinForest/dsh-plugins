import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbench, selectionInput, requirementText } from '../src/service.js';

const fixtures = fileURLToPath(new URL('../../dsh-megmeet/success-demo/snapshots/', import.meta.url));
const input = { load: 180, temperature: 25, width: 65, catalog: 'v1' };
async function instance(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-workbench-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return new Workbench({ workDirectory: dir, catalogPath: path.join(fixtures, 'catalog.v2.json'), catalogV1Path: path.join(fixtures, 'catalog.v1.json') });
}
test('拒绝任意路径参数、数值字符串、非有限数值及无效资料库', () => {
  for (const bad of [{ ...input, path: 'C:/secret' }, { ...input, load: '300' }, { ...input, load: Infinity }, { ...input, temperature: 90 }, { ...input, catalog: '../../private' }]) assert.throws(() => selectionInput(bad));
  assert.match(requirementText(input), /持续负载：180W/);
});
test('三步演示使用真实引擎：SDR240、无解、CP20-R2', async t => {
  const s = await instance(t);
  const first = await s.select(input);
  assert.deepEqual(first.candidates.filter(x => x.status === 'matches_listed_constraints').map(x => x.productId), ['SDR-240-24']);
  const changed = await s.select({ ...input, load: 300, temperature: 55 });
  assert.equal(changed.candidates.filter(x => x.status === 'matches_listed_constraints').length, 0);
  const expanded = await s.select({ ...input, load: 300, temperature: 55, catalog: 'v2' });
  assert.equal(expanded.candidates.find(x => x.productId === 'CP20.241-R2').status, 'matches_listed_constraints');
  assert.equal(expanded.requiredW, 360);
  assert.equal(expanded.sources.length, 11);
  assert.ok(s.status().tasks.every(x => x.state === 'done'));
});
test('资料版本不匹配不能导出；有效报告保存完整结果', async t => {
  const s = await instance(t);
  await assert.rejects(s.selectionReport({ ...input, revision: 'stale' }), /版本已变/);
  const data = await s.select(input);
  const report = await s.selectionReport({ ...input, revision: data.catalogRevision });
  const id = new URL(report.json, 'http://local').searchParams.get('id');
  const file = await s.readAsset(id);
  assert.equal(JSON.parse(file.buffer.toString()).analysis.candidates.length, 30);
});
test('文件只按随机 ID 读取；改变后的文件不会冒充原证据', async t => {
  const s = await instance(t), filename = path.join(s.config.workDirectory, 'report.json');
  await fs.writeFile(filename, '{}');
  const url = await s.asset(filename, 'application/json'), id = new URL(url, 'http://local').searchParams.get('id');
  assert.equal((await s.readAsset(id)).buffer.toString(), '{}');
  await assert.rejects(s.readAsset('../../credentials'), /过期/);
  await fs.writeFile(filename, '{"changed":true}');
  await assert.rejects(s.readAsset(id), /变化/);
});
test('同类电路任务串行保护；失败步骤如实记录', async t => {
  const s = await instance(t); let release;
  const job = s.job('board', 'long task', ['检查'], step => step(0, () => new Promise(resolve => { release = resolve; })));
  await assert.rejects(s.job('board', 'conflict', [], async () => {}), /仍在执行/);
  release(); await job;
  await assert.rejects(s.job('board', 'failure', ['检查'], step => step(0, () => { throw new Error('missing data'); })), /missing data/);
  assert.equal(s.status().tasks[0].state, 'failed');
  assert.equal(s.status().tasks[0].steps[0].state, 'failed');
});
test('原理图动作拒绝任意文件与未支持的元件值', async t => {
  const s = await instance(t);
  await assert.rejects(s.compare({ ref: 'R1', value: '10k', file: 'C:/other' }), /参数/);
  await assert.rejects(s.compare({ ref: '../R1', value: '10k' }), /位号/);
  await assert.rejects(s.compare({ ref: 'R1', value: '<script>' }), /元件值/);
});
