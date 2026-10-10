import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as megmeet from 'dsh-megmeet';
import * as plugin from '../src/index.js';

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
  const task = status.value.tasks.find(x => x.label === 'megmeet_get_catalog_info');
  assert.ok(task, 'actual tools/execute middleware was observed');
  assert.equal(task.origin, 'chat');
  assert.equal(task.state, 'done');
  assert.ok(task.finishedAt >= task.startedAt);
  assert.equal('arguments' in task, false);
  assert.equal('result' in task, false);
});
