import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as megmeet from 'dsh-megmeet';
import * as pcb from 'dsh-pcb-review';
import * as plugin from '../src/index.js';
import { Actions, ACTIONS } from '../src/actions.js';
import { Workbench } from '../src/service.js';

async function temp(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-actions-'));
  t.after(async () => { assert.equal(path.dirname(dir), path.resolve(os.tmpdir())); await fs.rm(dir, { recursive: true, force: true }); });
  return dir;
}
async function harness(t) {
  const dir = await temp(t), ctx = new Context(), routes = new Map();
  t.after(() => ctx.fiber.dispose());
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); } } });
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await ctx.plugin(megmeet, { catalogPath: fileURLToPath(new URL('../../dsh-megmeet/examples/catalog.demo.json', import.meta.url)), reportDirectory: dir, maxCandidates: 10 });
  const projectFile = fileURLToPath(new URL('../../dsh-pcb-review/examples/project.kicad.json', import.meta.url));
  await ctx.plugin(pcb, { projectFile, reportDirectory: dir });
  await ctx.plugin(plugin, { workDirectory: dir, workspaceRoot: dir });
  const request = async (endpoint, body, origin = 'http://local') => {
    const response = await routes.get('/api/engineering-workbench/' + endpoint).fetch(new Request('http://local/api/engineering-workbench/' + endpoint, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', origin }, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const value = await response.json(); return { response, ...value };
  };
  return { dir, ctx, routes, request, call: async (group, action, args = {}) => request('action', { group, action, args }) };
}
test('真实需求原文通过原生插件解析，无固定 24V / 20% / 安装条件注入', async t => {
  const { call } = await harness(t);
  const args = { text: '输入电压：180–264VAC；输出电压：48VDC；输出功率至少3kW；通信协议：CAN、RS485。' };
  const parsed = await call('selection', 'parse', args); assert.equal(parsed.ok, true);
  assert.equal(parsed.value.constraints.find(c => c.field === 'output_voltage_v').value, 48);
  assert.ok(!parsed.value.constraints.some(c => ['power_margin_pct', 'width_mm', 'orientation', 'altitude_m'].includes(c.field)));
  const bad = await call('selection', 'parse', { ...args, constraints: [{ field: 'width_mm', operator: 'lte', value: 65, sourceQuote: 'forged' }] });
  assert.equal(bad.ok, false);
});
test('所有六个选型动作可用，指定候选与版本绑定并导出三种文件', async t => {
  const { call, dir } = await harness(t);
  const info = await call('selection', 'info'); assert.equal(info.ok, true, info.error);
  const text = '输出电压：48VDC；输出功率至少3kW。';
  const search = await call('selection', 'search', { text, includeIncompatible: true, limit: 5 }); assert.equal(search.ok, true);
  const productId = search.value.candidates[0].productId;
  assert.equal((await call('selection', 'validate', { text, productId })).ok, true);
  const args = { text, productIds: [productId], title: '真实业务输入报告', expectedCatalogRevision: search.value.catalogRevision };
  assert.equal((await call('selection', 'report', args)).ok, true);
  const exported = await call('selection', 'export', args); assert.equal(exported.ok, true);
  assert.equal(exported.value.artifacts.length, 3);
  assert.ok(exported.value.artifacts.every(a => a.url.startsWith('/api/engineering-workbench/file?id=')));
  const jsonArtifact = exported.value.artifacts.find(a => a.key === 'jsonPath');
  const report = JSON.parse(await fs.readFile(jsonArtifact.path, 'utf8'));
  assert.equal(report.requestText, text); assert.equal(report.analysis.candidates.length, 1);
  assert.equal((await call('selection', 'export', { ...args, expectedCatalogRevision: 'stale' })).ok, false);
});
test('PCB 清单、完整网络、规则、快照、导出和监听均经过原生工具', async t => {
  const { call } = await harness(t);
  assert.equal((await call('pcb', 'capabilities')).value.kinds.length, 12);
  assert.equal((await call('pcb', 'guide', { query: 'STM32' })).value.kind, 'mcu');
  const inspection = await call('pcb', 'inspect', { ref: 'U1' }); assert.equal(inspection.value.component.ref, 'U1');
  const report = await call('pcb', 'review'); assert.equal(report.ok, true);
  assert.equal((await call('pcb', 'export', { expectedRevision: report.value.revision })).value.artifacts.length, 2);
  assert.equal((await call('pcb', 'setWatch', { enabled: true, pollSeconds: 3600 })).ok, true);
  assert.equal((await call('pcb', 'watch')).value.settings.enabled, true);
  assert.equal((await call('pcb', 'setWatch', { enabled: false })).value.state, 'disabled');
  assert.equal((await call('pcb', 'snapshot', { snapshotJson: '{invalid' })).ok, false);
});
test('拒绝任意工具名、跨站动作与未确认写回', async t => {
  const { call, request } = await harness(t);
  assert.equal((await call('shell', 'execute', { command: 'anything' })).ok, false);
  assert.equal((await call('selection', 'constructor')).ok, false);
  assert.equal((await request('action', { group: 'selection', action: 'info' }, 'https://other.test')).ok, false);
  assert.equal((await call('schematic', 'apply', { taskId: randomUUID(), verificationToken: randomUUID() })).ok, false);
  assert.equal((await call('schematic', 'rollback', { taskId: randomUUID() })).ok, false);
  assert.equal(Object.values(ACTIONS).reduce((n, v) => n + Object.keys(v).length, 0), 24);
});
test('写回确认绑定任务、验证版本与单次操作，过期确认不执行', async t => {
  const dir = await temp(t), id = randomUUID(), token = randomUUID();
  const taskDir = path.join(dir, 'tasks', id); await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(path.join(taskDir, 'task.json'), JSON.stringify({ id, current: path.join(dir, 'Board.kicad_sch'), relative: 'Board.kicad_sch', createdAt: new Date().toISOString(), target: { kind: 'text', hash: 'target', text: 'R1改为10k' } }));
  await fs.writeFile(path.join(taskDir, `verified-${token}.json`), JSON.stringify({ token, canApply: true, checkedAt: new Date().toISOString() }));
  let writes = 0;
  const a = new Actions(new Workbench({ workDirectory: dir, syncWorkDirectory: path.join(dir, 'tasks') }), async () => { writes++; return { status: 'applied' }; });
  const c = await a.confirmation({ action: 'apply', taskId: id, verificationToken: token });
  await assert.rejects(a.call({ group: 'schematic', action: 'apply', args: { taskId: id, verificationToken: 'changed' }, confirmation: c.id }), /确认/);
  assert.equal(writes, 0);
  const good = await a.confirmation({ action: 'apply', taskId: id, verificationToken: token });
  await a.call({ group: 'schematic', action: 'apply', args: { taskId: id, verificationToken: token }, confirmation: good.id });
  assert.equal(writes, 1);
  await assert.rejects(a.call({ group: 'schematic', action: 'apply', args: { taskId: id, verificationToken: token }, confirmation: good.id }), /确认/);
  const expired = await a.confirmation({ action: 'apply', taskId: id, verificationToken: token }); a.confirmations.get(expired.id).expires = 0;
  await assert.rejects(a.call({ group: 'schematic', action: 'apply', args: { taskId: id, verificationToken: token }, confirmation: expired.id }), /确认/);
  assert.equal(writes, 1);
});
test('工程文件选择器限制根目录，不展示凭据、依赖或任意类型文件', async t => {
  const dir = await temp(t);
  await fs.writeFile(path.join(dir, 'Board.kicad_sch'), 'schematic'); await fs.writeFile(path.join(dir, 'secrets.env'), 'sensitive');
  await fs.mkdir(path.join(dir, '.private')); await fs.mkdir(path.join(dir, 'node_modules'));
  const a = new Actions(new Workbench({ workspaceRoot: dir, workDirectory: dir }), async () => ({}));
  assert.deepEqual((await a.files()).entries.map(f => f.name), ['Board.kicad_sch']);
  await assert.rejects(a.files('..'), /工程目录/);
  await assert.rejects(a.task('../task'), /任务 ID/);
});

test('导出报告原件链接走受控文件接口，筛选脚本隔离运行且原报告变更会失效', async t => {
  const dir = await temp(t), source = path.join(dir, "source's file.pdf");
  await fs.writeFile(source, '%PDF-test');
  const html = path.join(dir, 'report.html'), json = path.join(dir, 'report.json');
  await fs.writeFile(json, JSON.stringify({ sources: [{ file: source }] }));
  await fs.writeFile(html, '<a href="source&#39;s%20file.pdf">Source</a><script>document.title="filter";</script>');
  const service = new Workbench({ workDirectory: dir }), actions = new Actions(service, async () => ({}));
  const artifact = await actions.reportAsset(html, json), id = new URL(artifact.url, 'http://local').searchParams.get('id');
  const presented = await service.readAsset(id);
  assert.match(presented.buffer.toString(), /href="\/api\/engineering-workbench\/file\?id=/);
  assert.match(presented.policy, /sandbox allow-scripts;/);
  assert.match(presented.policy, /script-src 'sha256-/);
  assert.doesNotMatch(presented.policy, /allow-same-origin|unsafe-inline.*script/);
  await fs.appendFile(html, 'changed');
  await assert.rejects(service.readAsset(id), /文件已变化/);
});
