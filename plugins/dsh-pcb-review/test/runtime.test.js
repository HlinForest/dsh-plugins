import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';
import { loadProject } from '../src/service.js';
import { startWatcher } from '../src/watcher.js';

async function setup(t, config = {}) {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  const fiber = await ctx.plugin(plugin, config); let count = 0;
  return { ctx, fiber, call: (name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, callId: `pcb-${++count}`, signal }) };
}
async function copyExample(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-pcb-review-'));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    assert.ok(dir.startsWith(join(tmpdir(), 'dsh-pcb-review-')));
    return rm(dir, { recursive: true, force: true });
  });
  await cp(fileURLToPath(new URL('../examples', import.meta.url)), dir, { recursive: true });
  return dir;
}
test('真实 DSH rc.2 加载七个工具并评审、导出报告', async t => {
  const dir = await copyExample(t), { ctx, call, fiber } = await setup(t, { projectFile: join(dir, 'project.kicad.json'), reportDirectory: join(dir, 'reports') });
  assert.equal(ctx.tools.schemas().length, 7);
  const info = await call('pcb_get_capabilities'); assert.equal(info.isError, false);
  const guide = await call('pcb_component_guide', { query: '隔离芯片' });
  assert.equal(guide.value.kind, 'isolator');
  const inspected = await call('pcb_inspect_project', { ref: 'U1' });
  assert.equal(inspected.value.component.ref, 'U1');
  assert.ok(inspected.value.nets.some(n => n.name === 'SENSE_ADC'));
  const result = await call('pcb_review_project'); assert.equal(result.isError, false, JSON.stringify(result));
  assert.equal(result.value.summary.warning, 2);
  assert.match(result.value.markdown, /C2/);
  const exported = await call('pcb_export_report', { expectedRevision: result.value.revision });
  assert.equal(exported.isError, false, JSON.stringify(exported));
  assert.equal(JSON.parse(await readFile(exported.value.json, 'utf8')).revision, result.value.revision);
  const second = await call('pcb_export_report', { expectedRevision: result.value.revision });
  assert.notEqual(second.value.json, exported.value.json);
  await fiber.dispose(); assert.equal(ctx.tools.schemas().length, 0);
});
test('来源变化拒绝旧报告，工具不接受模型任意指定文件路径', async t => {
  const dir = await copyExample(t), { call } = await setup(t, { projectFile: join(dir, 'project.kicad.json'), reportDirectory: join(dir, 'reports') });
  const before = await call('pcb_review_project');
  await writeFile(join(dir, 'demo.positions.csv'), (await readFile(join(dir, 'demo.positions.csv'), 'utf8')).replace('C1,22,10', 'C1,11,10'));
  assert.equal((await call('pcb_export_report', { expectedRevision: before.value.revision })).isError, true);
  assert.equal((await call('pcb_review_project', { path: 'C:/secret' })).isError, true);
  assert.equal((await call('pcb_component_guide', { query: 123 })).isError, true);
});
test('取消、缺少配置与非法输入明确失败', async t => {
  const { call } = await setup(t);
  assert.equal((await call('pcb_review_project')).isError, true);
  const a = new AbortController(); a.abort();
  assert.equal((await call('pcb_get_capabilities', {}, a.signal)).isError, true);
  assert.equal((await call('pcb_review_snapshot', { snapshotJson: '{invalid' })).isError, true);
  assert.equal((await call('pcb_get_watch_status')).value.state, 'disabled');
});
test('快照工具标明调用者来源；畸形配置不能上线', async t => {
  const { call } = await setup(t), dir = await copyExample(t);
  const { board, config } = await loadProject(join(dir, 'project.kicad.json'));
  const r = await call('pcb_review_snapshot', { snapshotJson: JSON.stringify({ board, context: config.context }) });
  assert.equal(r.isError, false); assert.ok(r.value.notes.some(n => n.includes('调用者提供')));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await assert.rejects(Promise.resolve(ctx.plugin(plugin, { projectFile: 'relative.json' })));
  await assert.rejects(Promise.resolve(ctx.plugin(plugin, { watch: true })));
});
test('监听等待稳定数据、去重，问题解决后再次出现会重新提醒', async t => {
  const { report: base } = await loadProject(fileURLToPath(new URL('../examples/project.kicad.json', import.meta.url)));
  let current = structuredClone(base); const events = [];
  const watcher = startWatcher({ projectFile: 'test', pollSeconds: 3600, notify: async e => events.push(e), load: async () => ({ report: current }) });
  t.after(() => watcher.dispose());
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 0);
  await watcher.tick(); assert.equal(events.length, 1);
  await watcher.tick(); assert.equal(events.length, 1);
  current = { ...structuredClone(base), revision: 'resolved', findings: base.findings.filter(f => f.rule !== 'INPUT_CAP') };
  await watcher.tick(); await watcher.tick(); assert.equal(events.length, 1);
  current = { ...structuredClone(base), revision: 'reappeared' };
  await watcher.tick(); await watcher.tick(); assert.equal(events.length, 2);
  assert.equal(events[1].findings.length, 2);
  watcher.dispose(); await watcher.tick(); assert.equal(events.length, 2);
});
test('监听失败单独告警且可恢复；新数值触发同一问题更新', async t => {
  const { report } = await loadProject(fileURLToPath(new URL('../examples/project.kicad.json', import.meta.url)));
  let fail = true, current = structuredClone(report); const events = [];
  const watcher = startWatcher({ projectFile: 'test', pollSeconds: 3600, notify: async e => events.push(e), load: async () => { if (fail) throw new Error('导出失败'); return { report: current }; } });
  t.after(() => watcher.dispose()); await new Promise(resolve => setImmediate(resolve));
  await watcher.tick(); assert.equal(events.length, 1); assert.equal(watcher.getStatus().state, 'error');
  fail = false; await watcher.tick(); await watcher.tick(); assert.equal(events.length, 2);
  current.revision = 'moved'; current.findings[3].details = '移动后距离 20 mm';
  await watcher.tick(); await watcher.tick(); assert.equal(events.length, 3); assert.equal(events[2].findings.length, 1);
});
