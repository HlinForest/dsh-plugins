import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { McpResourceRuntime } from '@deepseek-ai/dsh-mcp-resources';
import * as plugin from '../src/index.js';
import { runProcess } from '../src/workflow.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config = JSON.parse(await fs.readFile(path.join(root, 'examples/local.config.json'), 'utf8'));
const output = path.join(root, '.verification', new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const ctx = new Context(); const records = []; let id = 0;
const call = async (name, args = {}) => {
  const started = Date.now();
  const result = await ctx.tools.execute({ name, arguments: args, callId: 'live-' + (++id), signal: new AbortController().signal });
  records.push({ name, args, milliseconds: Date.now() - started, result });
  assert.equal(result.isError, false, JSON.stringify(result));
  let value = result.value;
  if (name.startsWith('mcp__')) {
    const text = value.content?.find(b => b.type === 'text')?.text;
    try { value = JSON.parse(text); } catch { /* Keep raw content. */ }
    assert.notEqual(value?.success, false, JSON.stringify(value));
  }
  console.log(name + ' OK'); return value;
};
try {
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); await ctx.plugin(McpResourceRuntime);
  let fiber = await ctx.plugin(plugin, config);
  const capabilities = await call('kicad_workflow_capabilities');
  assert.equal(capabilities.mcpToolCount, 233);
  await fs.writeFile(path.join(output, 'tool-catalog.json'), JSON.stringify(ctx.tools.schemas(), null, 2));
  const backend = await call('mcp__kicad__get_backend_state');
  assert.equal(backend.backend, 'swig');
  const smoke = await call('kicad_workflow_begin', { name: 'DSH_KiCad_smoke', mode: 'design' });
  await call('mcp__kicad__create_project', { path: smoke.projectDirectory, name: smoke.projectName });
  await call('mcp__kicad__set_board_size', { width: 30, height: 20, unit: 'mm' });
  await call('mcp__kicad__save_project');
  await call('mcp__kicad__close_project', { save: false });
  await call('mcp__kicad__open_project', { filename: smoke.projectPath });
  const board = await call('mcp__kicad__get_board_info');
  await call('mcp__kicad__run_drc', { reportPath: path.join(smoke.projectDirectory, 'smoke-drc.txt') });
  await call('mcp__kicad__close_project', { save: false });
  await fiber.dispose();
  assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('mcp__kicad__')).length, 0);
  // Upstream get_board_info includes the 0.1 mm Edge.Cuts stroke in its bbox.
  const outlineReadback = await runProcess(config.kicadPython, ['-c', 'import pcbnew,json,sys; b=pcbnew.LoadBoard(sys.argv[1]); q=[p for g in b.GetDrawings() if g.GetLayer()==pcbnew.Edge_Cuts for p in (g.GetStart(),g.GetEnd())]; print(json.dumps({"width":(max(p.x for p in q)-min(p.x for p in q))/1e6,"height":(max(p.y for p in q)-min(p.y for p in q))/1e6}))', smoke.projectPath.replace(/\.kicad_pro$/, '.kicad_pcb')]);
  assert.equal(outlineReadback.code, 0);
  assert.deepEqual(JSON.parse(outlineReadback.stdout), { width: 30, height: 20 });
  fiber = await ctx.plugin(plugin, { ...config, serverEntry: '' });
  const baseline = process.env.KICAD_TEST_BASELINE;
  let replica, checkpoint, delivery;
  if (baseline) {
    replica = await call('kicad_workflow_begin', { name: 'DSH_Replica_verification', mode: 'replica', baselineProject: baseline });
    await call('kicad_workflow_record_unknown', { projectDirectory: replica.projectDirectory, id: 'source-connectivity', description: 'Baseline photo-derived connections remain unverified; RJ5-7 and U1.12 need continuity measurements.', references: ['RJ5', 'RJ6', 'RJ7', 'U1.12'] });
    checkpoint = await call('kicad_workflow_checkpoint', { projectDirectory: replica.projectDirectory });
    if (path.basename(baseline) === 'MD50PG_Replica_P3.kicad_pro') {
      assert.deepEqual(checkpoint.counts, { erc: 11, drc: 0, unrouted: 40, parity: 0, excludedReportedItems: 0 });
    }
    delivery = await call('kicad_workflow_deliver', { projectDirectory: replica.projectDirectory, expectedRevision: checkpoint.revision, layers: ['B.Cu', 'B.Mask', 'B.SilkS', 'F.SilkS', 'Edge.Cuts'] });
    assert.equal(delivery.zipVerification.sha256_members, 'PASS');
  }
  await fiber.dispose();
  assert.equal(ctx.tools.schemas().filter(x => x.name.startsWith('mcp__kicad__')).length, 0);
  await fs.writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: true, capabilities, backend, smoke, board, outlineReadback: JSON.parse(outlineReadback.stdout), replica, checkpoint, delivery, nativeRuntime: true, modelApiCalled: false }, null, 2));
  console.log(JSON.stringify({ ok: true, output, smoke: smoke.projectDirectory, replica: replica?.projectDirectory, archive: delivery?.archive }));
} catch (error) {
  console.error(error); process.exitCode = 1;
  await fs.writeFile(path.join(output, 'error.txt'), String(error.stack ?? error));
} finally {
  await ctx.fiber.dispose();
  await fs.writeFile(path.join(output, 'tool-evidence.json'), JSON.stringify(records, null, 2));
}
