import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { Context } from '@deepseek-ai/cordis';
import { LlmAdapter, LlmRuntime } from '@deepseek-ai/dsh-llm';
import { Flow } from '../src/service.js';
import { harnessAI } from '../src/ai.js';
import { PreciseTools, invokePrecise } from '../src/precise-tools.js';
import { presentation } from '../src/presentation.js';
import { readJSON, tree, hash } from '../src/io.js';
import { createLegacyProject } from './fixtures/legacy-project.js';

const finish = { action: 'finish', summary: '模拟模型测试结果；非真实 Harness 模型验收', gaps: [], assumptions: [] };

test('fixed redesign freezes local library without page layout and refuses incomplete CAD finish', async t => {
  const actions = [tool('precise_fixed_library',{}),finish,tool('precise_fixed_library',{references:['*','D1']}),finish,
    tool('precise_create',{request_key:'create',name:'FixedTest',paper:'A3'}),
    tool('precise_place_fixed',{request_key:'place',components:[{reference:'*',at:[150,100]}]}),read(),check('check'),finish,
    {action:'question',questions:['测试停止：固定器件尚未放齐']},read(),{action:'question',questions:['续跑读取已保留器件']}];
  const { flow, ctx }=await context(t,actions);
  let p=await createLegacyProject(flow,{label:'Historical frozen geometry fixture',caseId:'display-board',designMode:'fixed-redesign',bundle:false,controlledLayout:false,layoutEngine:undefined});
  // Compatibility fixture for projects created before the controlled-layout opt-in.
  // This fixture represents the pre-controlled-layout text flow.  Keep the
  // layout engine unset as well; otherwise the historical project is treated
  // as a fresh native-KiCad design and receives modern finish requirements.
  delete p.controlledLayout; delete p.layoutEngine; await flow.save(p);
  assert(p.inputs.requirements.length<1000);
  assert.equal(p.fixedLibrary.originalPageCoordinates,false);
  await flow.confirm({projectId:p.id,stage:1},'human');
  for(const stage of [2,3]) {p=await flow.execute(p.id,stage);assert.equal(p.stages[stage-1].status,'done');await flow.confirm({projectId:p.id,stage,allowDraft:true},'human');}
  p=await flow.execute(p.id,4);assert.equal(p.stages[3].status,'waiting-input');
  const log=await readJSON(path.join(p.stages[3].output,'model-log.json'));
  assert(log.some(x=>x.event==='finish-rejected'&&x.issue.includes('固定器件')));
  const before=p.stages[3].output;
  p=await flow.execute(p.id,4);assert.equal(p.stages[3].status,'waiting-input');
  const resumed=await readJSON(path.join(p.stages[3].output,'tool-log.json'));
  assert(resumed[0].result.items.some(x=>x.reference==='*'));
  const provenance=await readJSON(path.join(p.stages[3].output,'resume-provenance.json'));
  assert.equal(provenance.sourceOutput,before);assert.notEqual(p.stages[3].output,before);
  assert(JSON.parse(ctx.requests.at(-1).messages[0].content[0].text).request.resume);
  assert.equal(ctx.realModelCalls,0);
});
function mockHost(actions) {
  const registered = new Map(), calls = [], requests = [];
  const runtimeContext = new Context(), llm = new LlmRuntime(runtimeContext);
  class LocalAdapter extends LlmAdapter {
    async *stream(request) {
      requests.push(request); const action = actions.shift(); assert(action, 'Test double has no queued response');
      const response = typeof action === 'function' ? action(request) : action;
      yield { type: 'text-delta', index: 0, text: typeof response === 'string' ? response : JSON.stringify(response) };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
  llm.registerAdapter(['test-double'], new LocalAdapter());
  return { calls, requests, registered, realModelCalls: 0, dispose: () => runtimeContext.fiber.dispose(),
    tools: {
      register: tool => registered.set(tool.name, tool),
      async execute(call) { calls.push(call); const value = await registered.get(call.name).execute(call.arguments, { signal: call.signal }); return { value }; },
    },
    get(name) {
      if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'test-double', model: 'TEST-DOUBLE' }) };
      if (name === 'llm') return llm;
    },
  };
}
async function context(t, actions = []) {
  const workspace = await fs.mkdtemp(path.join(process.env.EDA_TEST_ROOT || os.tmpdir(), 'eda-text-mcp-test-'));
  t.after(() => fs.rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const config = { workspaceRoot: workspace, workDirectory: workspace, allowModelCalls: true, kicadPython: process.env.EDA_TEST_PYTHON || 'D:/anaconda/python.exe', kicadCli: process.env.EDA_TEST_KICAD || 'D:/Kicad/bin/kicad-cli.exe' };
  const ctx = mockHost(actions), mcp = new PreciseTools(config, ctx); mcp.register();
  t.after(ctx.dispose);
  return { workspace, config, ctx, mcp, flow: new Flow(config, harnessAI(ctx), mcp) };
}
const tool = (name, args) => ({ action: 'tool', name, arguments: args });
const read = () => tool('precise_read', { include_objects: true });
const check = key => tool('precise_check_export', { request_key: key, formats: ['netlist', 'erc', 'pdf', 'svg', 'bom'] });
const fixture = {
  request_key: 'fixture-components',
  symbols: [
    { name: 'TestSupply', pins: [{ number: '1', name: 'VCC', at: [0, 0, 0], length: 2.54, type: 'power_out' }, { number: '2', name: 'GND', at: [0, -10.16, 0], length: 2.54, type: 'power_out' }] },
    { name: 'TestLoad', pins: [{ number: '1', name: '1', at: [0, 0, 180], length: 2.54, type: 'passive' }, { number: '2', name: '2', at: [0, -10.16, 180], length: 2.54, type: 'passive' }] },
  ],
  items: [
    { id: 'source', kind: 'component', symbol: 'TestSupply', reference: 'J1', at: [25.4, 25.4], value: 'External 5V' },
    { id: 'load', kind: 'component', symbol: 'TestLoad', reference: 'R1', at: [50.8, 25.4], value: '1k', dnp: false },
    { id: 'upper', kind: 'wire', points: [[25.4, 25.4], [50.8, 25.4]] },
    { id: 'lower', kind: 'wire', points: [[25.4, 35.56], [50.8, 35.56]] },
    { id: 'vcc', kind: 'label', text: '+5V', at: [25.4, 25.4] },
    { id: 'gnd', kind: 'label', text: 'GND', at: [25.4, 35.56] },
  ],
};

test('new defaults are inline text, PCB skipped; API rejects legacy creation', async t => {
  const { flow } = await context(t);
  await assert.rejects(flow.dispatch({ action: 'create', caseId: 'display-board', legacy: true }, undefined, 'human'), /历史|legacy|不支持/);
  const p = await flow.dispatch({ action: 'create', caseId: 'display-board' }, undefined, 'human');
  assert.equal(p.mode, 'text-mcp'); assert.equal(p.schemaVersion, 3); assert.equal(p.scope, 'schematic');
  assert.equal(p.designMode, 'new-design'); assert.equal(p.inputs.evidence, undefined); assert.equal(p.inputsBundle, undefined); assert.equal(p.inputCatalog.length, 0);
  assert.equal(p.stages[5].status, 'skipped'); assert.equal(p.stages[5].confirmed, false);
  await assert.rejects(flow.replay(p.id), /不支持固定调用重放/);
  await assert.rejects(flow.update({ projectId: p.id, stage: 2, inputs: { schematic: 'old.SchDoc' } }), /不能加载工程对象包/);
  const legacy = await createLegacyProject(flow, { label: 'Existing historical fixture' });
  assert.equal((await flow.open(legacy.id)).origin, 'legacy-conversion');
});

test('questions remain visible; updated text invalidates downstream and keeps PCB skipped', async t => {
  const actions = [{ action: 'question', questions: ['供电电压是多少？'] }, finish];
  const { flow, ctx } = await context(t, actions);
  let p = await createLegacyProject(flow, { label: 'Historical question fixture', designMode: 'reconstruction', mode: 'text-mcp', bundle: false, controlledLayout: false, layoutEngine: undefined });
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '设计显示板。', power: '5V', interfaces: '6pin', acceptance: '连接逐针核对', basis: '工程师接口定义', review: '保留真实未关闭项', constraints: { packagePolicy: '贴片', rulePolicy: '精确坐标' } } });
  await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  p = await flow.execute(p.id, 2);
  assert.equal(p.stages[1].status, 'waiting-input'); assert.deepEqual(p.stages[1].questions, ['供电电压是多少？']);
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 2 }, 'human'), /没有有效/);
  await flow.update({ projectId: p.id, stage: 2, inputs: { stageNotes: { 2: '问：供电电压？答：5 V。' } } });
  p = await flow.execute(p.id, 2); assert.equal(p.stages[1].status, 'done'); assert.equal(p.stages[5].status, 'skipped');
  assert(ctx.requests[1].messages[0].content[0].text.includes('5 V'));
  assert(ctx.requests[0].messages[0].content[0].text.includes('设计显示板'));
  const firstInput = JSON.parse(ctx.requests[0].messages[0].content[0].text).request.inputs;
  assert.equal(firstInput.power, '5V'); assert.equal(firstInput.interfaces, '6pin'); assert.equal(firstInput.acceptance, '连接逐针核对');
  assert.equal(firstInput.basis, '工程师接口定义'); assert.equal(firstInput.review, '保留真实未关闭项'); assert.equal(firstInput.constraints.packagePolicy, '贴片'); assert.equal(firstInput.constraints.rulePolicy, '精确坐标');
  assert.equal(ctx.realModelCalls, 0);
});

test('host model receives tool failure and repairs via next live protocol turn', async t => {
  const actions = [tool('not_allowed', {}), request => {
    assert(request.messages.at(-1).content[0].text.includes('本步未授权该工具'));
    return finish;
  }];
  const { ctx } = await context(t, actions); const records = [];
  const answer = await harnessAI(ctx).generateText({ project: { mode: 'text-mcp' }, stage: { id: 2 }, request: { inputs: { requirements: 'x' } }, record: async r => records.push(r) });
  assert.equal(answer.action, 'finish'); assert.equal(records.find(r => r.event === 'tool-result').result.ok, false);
  assert.equal(ctx.requests.length, 2);
});

test('text stages use registered host tools and real stdio KiCad; immutable upstream, BOM/PDF and skipped PCB', { timeout: 180000 }, async t => {
  const actions = [finish, finish,
    // An unsupported argument is intentionally returned to the model, then fixed.
    tool('precise_create', { request_key: 'bad', name: 'Fixture', root: 'D:/escape' }),
    tool('precise_create', { request_key: 'create', name: 'Fixture', title: '文字 MCP 测试' }),
    tool('precise_apply', { request_key: 'invalid-visibility', symbols: [{ name: 'Conflicting', pins: [{ number: '1', name: 'X', at: [0,0], length: 2.54, type: 'input', name_visible: false }] }] }),
    'Symbols are ready. Now place the circuit objects.\n\n' + JSON.stringify(tool('precise_apply', fixture)), read(), check('same-model-key'), finish,
    read(), check('same-model-key'), finish, read(), check('same-model-key'), finish];
  const { flow, ctx, mcp } = await context(t, actions);
  let p = await createLegacyProject(flow, { label: 'Historical MCP fixture', designMode: 'reconstruction', mode: 'text-mcp', bundle: false, controlledLayout: false, layoutEngine: undefined });
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '测试：5 V 外部电源接 1k 负载；使用通用 MCP 从空白生成。', datasheetText: '外部电源接线是本测试的工程要求，不伪称规格书。' } });
  await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  for (const number of [2, 3, 4, 5, 7]) {
    p = await flow.execute(p.id, number); assert.equal(p.stages[number - 1].status, 'done');
    await flow.confirm({ projectId: p.id, stage: number, allowDraft: true }, 'human');
  }
  p = await flow.open(p.id);
  assert.equal(p.stages[5].status, 'skipped'); assert.equal(p.stages[5].confirmed, false);
  assert.equal(p.stages[3].planOrigin, 'test-double'); assert.equal(p.liveHarnessValidation, 'pending');
  assert(p.stages[6].result.schematicPdf.endsWith('.pdf')); assert(p.stages[6].result.archive.endsWith('.zip'));
  const data = await presentation(p); assert.equal(data.components.length, 2); assert.equal(data.pins.length, 4); assert.equal(data.nets.length, 2);
  assert.equal(data.components.find(c => c.ref === 'R1').value, '1k');
  assert.match(await fs.readFile(path.join(p.stages[6].output, p.stages[6].result.bom), 'utf8'), /PinCount,ObjectRole/);
  const upstream = p.stages[3]; assert.equal(hash(await tree(upstream.output)), upstream.outputHash);
  const log = await readJSON(path.join(upstream.output, 'tool-log.json')); assert(log.some(x => !x.ok)); assert(log.some(x => x.name === 'precise_apply' && x.ok));
  assert(log.some(x => x.error?.includes('set symbol-level pin_names_visible')));
  assert.deepEqual(log.find(x => x.arguments.request_key === fixture.request_key).arguments, fixture);
  const modelLog = await readJSON(path.join(upstream.output, 'model-log.json'));
  assert(modelLog.some(x => x.event === 'response' && x.raw.startsWith('Symbols are ready.')));
  assert(!modelLog.some(x => x.event === 'format-retry'));
  const bomStage = p.stages[4], bomLog = await readJSON(path.join(bomStage.output, 'tool-log.json'));
  assert(bomLog.find(x => x.arguments.request_key === 'same-model-key').result.outputs.netlist.path.startsWith(path.join(bomStage.output, 'project')));
  assert(ctx.calls.every(c => c.name.startsWith('eda_precise_') && c.arguments.executionToken));
  assert.equal(mcp.sessions.size, 0); assert.equal(ctx.realModelCalls, 0);
  const stolen = ctx.calls[0]; await assert.rejects(ctx.tools.execute(stolen), /令牌无效/);
  const evidence = await readJSON(path.join(p.stages[6].output, 'frozen-evidence.json'));
  assert.equal(evidence.planOrigin, 'test-double'); assert.equal(evidence.stages[5].status, 'skipped');
  p = await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '改成 3.3 V' } });
  assert.equal(p.stages[3].status, 'stale'); assert.equal(p.stages[5].status, 'skipped'); assert.equal(p.stages[6].confirmed, false);
});

test('text chat receives complete visible input and invalid PDFs are not marked readable', async t => {
  const { flow, ctx, workspace } = await context(t, [finish]);
  const p = await flow.create({ label: 'Chat text fixture' });
  await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: '输入任务', power: '3.3V', interfaces: 'SPI', basis: '接口定义', acceptance: 'NC明确', review: '待核对', constraints: { packagePolicy: 'SMD' } } });
  const pdf = path.join(workspace, 'datasheet.pdf'); await fs.writeFile(pdf, '%PDF-fixture-metadata-only');
  await assert.rejects(flow.attach({ projectId: p.id, stage: 3, path: pdf }));
  assert.equal((await flow.open(p.id)).uploads.length, 0);
  await flow.startChat({ projectId: p.id, stage: 3, text: '核对当前输入' }); await flow.jobs.get(p.id).promise;
  const input = JSON.parse(ctx.requests[0].messages[0].content[0].text).request.inputs;
  assert.equal(input.power, '3.3V'); assert.equal(input.interfaces, 'SPI'); assert.equal(input.review, '待核对'); assert.equal(input.constraints.packagePolicy, 'SMD');
  assert(!ctx.requests[0].messages[0].content[0].text.includes('%PDF-fixture'));
});

test('finish alone cannot make a schematic stage pass', async t => {
  const { flow, ctx } = await context(t, [finish, finish, finish, { action: 'question', questions: ['缺少器件细节'] }]);
  let p = await createLegacyProject(flow, { label: 'Historical no-CAD fixture', designMode: 'reconstruction', mode: 'text-mcp', bundle: false, controlledLayout: false, layoutEngine: undefined }); await flow.update({ projectId: p.id, stage: 1, inputs: { requirements: 'test' } }); await flow.confirm({ projectId: p.id, stage: 1 }, 'human');
  for (const n of [2, 3]) { await flow.execute(p.id, n); await flow.confirm({ projectId: p.id, stage: n }, 'human'); }
  p = await flow.execute(p.id, 4); assert.equal(p.stages[3].status, 'waiting-input');
  assert(ctx.requests.at(-1).messages.at(-1).content[0].text.includes('finishAccepted'));
});

test('MCP adapter confines root and respects cancellation', async t => {
  const { config, workspace } = await context(t);
  await assert.rejects(invokePrecise(config, path.dirname(workspace), 'precise_read', {}), /当前工作区/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(invokePrecise(config, path.join(workspace, 'cancelled'), 'precise_create', { request_key: 'x', name: 'Cancelled' }, controller.signal), /取消/);
});
