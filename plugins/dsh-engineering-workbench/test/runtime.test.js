import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as megmeet from 'dsh-megmeet';
import * as plugin from '../src/index.js';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('真实 DSH 工具调用经过工作台观察器，结果与参数不泄露到状态面板', async t => {
  const ctx = new Context();
  t.after(() => ctx.fiber.dispose());
  const routes = new Map();
  ctx.provide('connection', { fetch: { register(route) { routes.set(route.path, route); } } });
  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(megmeet);
  await ctx.plugin(plugin, {});
  const result = await ctx.tools.execute({ name: 'megmeet_get_catalog_info', arguments: {}, callId: 'workbench-observer-test', signal: new AbortController().signal });
  assert.equal(result.isError, false);
  const status = await (await routes.get('/api/engineering-workbench/status').fetch(new Request('http://local/api/engineering-workbench/status'))).json();
  assert.equal(status.value.tools.megmeet_, 6);
  const task = status.value.tasks.find(x => x.label === '读取产品资料库');
  assert.ok(task, 'actual tools/execute middleware was observed');
  assert.equal(task.origin, 'chat');
  assert.equal(task.state, 'done');
  assert.ok(task.finishedAt >= task.startedAt);
  assert.equal('arguments' in task, false);
  assert.equal('result' in task, false);
});

test('独立工程工具不依赖业务插件；模型不能请求覆盖确认', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'workbench-tool-')); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  ctx.provide('connection', { fetch: { register() {} } });
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await ctx.plugin(plugin, { workspaceRoot: dir, workDirectory: dir });
  const call = request => ctx.tools.execute({ name: 'engineering_task', arguments: { request: JSON.stringify(request) }, callId: 'independent-tool-test', signal: new AbortController().signal });
  const result = await call({ action: 'list' }); assert.equal(result.isError, false); assert.deepEqual(result.value, []);
  const denied = await call({ action: 'confirmation', taskId: 'model-cannot-sign', operation: 'apply' }); assert.equal(denied.isError, true);
});
