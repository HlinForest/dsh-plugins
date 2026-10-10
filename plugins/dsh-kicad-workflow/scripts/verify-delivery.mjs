import fs from 'node:fs/promises';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import * as plugin from '../src/index.js';
const config = JSON.parse(await fs.readFile(new URL('../examples/local.config.json', import.meta.url), 'utf8'));
const ctx = new Context();
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(plugin, { ...config, serverEntry: '' });
  const call = async (name, args) => {
    const result = await ctx.tools.execute({ name, arguments: args, callId: name, signal: new AbortController().signal });
    if (result.isError) throw new Error(JSON.stringify(result));
    return result.value;
  };
  const projectDirectory = path.resolve(process.argv[2]);
  const status = await call('kicad_workflow_status', { projectDirectory });
  const result = await call('kicad_workflow_deliver', { projectDirectory, expectedRevision: status.revision, layers: ['B.Cu', 'B.Mask', 'B.SilkS', 'F.SilkS', 'Edge.Cuts'] });
  await fs.writeFile(new URL('../.verification/final-delivery.json', import.meta.url), JSON.stringify({ ok: true, nativeRuntime: true, modelApiCalled: false, result }, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await ctx.fiber.dispose(); }
