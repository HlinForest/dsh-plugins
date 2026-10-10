import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';

test('DSH rc.2 loads all 10 tools, validates inputs and disposes cleanly', async t => {
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  const fiber = await ctx.plugin(plugin, {});
  assert.equal(ctx.tools.schemas().length, 10);
  const call = (name, args = {}, signal = new AbortController().signal) => ctx.tools.execute({ name, arguments: args, callId: 'test', signal });
  const info = await call('schematic_capabilities'); assert.equal(info.isError, false, JSON.stringify(info));
  assert.equal(info.value.configured, false);
  assert.equal((await call('schematic_capabilities', { arbitraryPath: 'C:/' })).isError, true);
  assert.equal((await call('schematic_begin', { currentPath: 'x.kicad_sch', targetText: 'R1=1k' })).isError, true);
  const a = new AbortController(); a.abort(); assert.equal((await call('schematic_capabilities', {}, a.signal)).isError, true);
  await fiber.dispose(); assert.equal(ctx.tools.schemas().length, 0);
});
