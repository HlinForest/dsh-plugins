import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';

test('six native tools load, validate input, honor cancellation, and unload', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  const fiber = await ctx.plugin(plugin, {});
  assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('kicad_workflow_')).length, 6);
  const call = (name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, callId: 'test', signal });
  const info = await call('kicad_workflow_capabilities');
  assert.equal(info.isError, false); assert.equal(info.value.mcpConfigured, false); assert.equal(info.value.mcpToolCount, 0);
  assert.equal((await call('kicad_workflow_begin', { name: 42 })).isError, true);
  const abort = new AbortController(); abort.abort();
  assert.equal((await call('kicad_workflow_capabilities', {}, abort.signal)).isError, true);
  await fiber.dispose(); assert.equal(ctx.tools.schemas().length, 0);
});
test('invalid configuration fails activation', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await assert.rejects(Promise.resolve(ctx.plugin(plugin, { workspaceRoot: 'relative' })), /absolute/);
});
