import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection';
import * as plugin from '../src/index.js';
import { version } from '../src/contracts.js';

test('real Harness registers UI API and eda_flow with no workbench and no model service', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-runtime-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const ctx = new Context(); t.after(() => ctx.fiber.dispose());
  new HostConnectionService(ctx, [], {}); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime);
  await ctx.plugin(plugin, { workspaceRoot: dir, workDirectory: dir, kicadPython: 'unused', kicadCli: 'unused', allowModelCalls: false });
  const handler = ctx.connection.createSharedFetchHandler('/api');
  const response = await handler.fetch(new Request('http://local/api/eda-flow/bootstrap'));
  const state = (await response.json()).value;
  assert.equal(state.version, version); assert.equal(state.aiEnabled, false); assert.equal(state.stages.length, 7);
  assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('eda_precise_')).length, 7);
  const result = await ctx.tools.execute({ name: 'eda_flow', arguments: { request: '{"action":"list"}' }, callId: 'independent-flow', signal: new AbortController().signal });
  assert.equal(result.isError, false); assert.deepEqual(result.value, []);
});
