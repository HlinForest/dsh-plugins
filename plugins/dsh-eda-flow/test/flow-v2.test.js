import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';
import { readJSON, writeJSON, within } from '../src/io.js';
import { harnessAI } from '../src/ai.js';
import { routes } from '../src/http.js';

const plan = { action: 'plan', version: 1, executor: 'local', summary: 'test-only model decision', assumptions: [], gaps: [] };
class LocalFake extends Flow {
  async runProcess(args, output) {
    if (args[0].endsWith('intake.py')) await writeJSON(path.join(output, 'prepared/intake.json'), { gaps: [] });
    else await writeJSON(path.join(output, 'result.json'), { summary: 'test-only execution', gaps: ['test gap'] });
  }
}
async function setup(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-flow-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fake = { async generate({ record }) { await record({ event: 'request', model: 'TEST-DOUBLE' }); return structuredClone(plan); } };
  const flow = new LocalFake({ workspaceRoot: root, workDirectory: root, allowModelCalls: true, ...options }, fake);
  return { root, flow, p: await flow.create({ legacy: true,}) };
}
test('new and default projects have no output; every normal stage requires a model', async t => {
  const { flow, p } = await setup(t, { allowModelCalls: false });
  const example = await flow.create({ legacy: true, caseId: 'display-board' });
  assert(example.stages.every(s => s.source === 'ai' && s.plan === null && !s.output));
  assert(example.inputCatalog.length > 70);
  await assert.rejects(flow.execute(p.id, 1), /需要 Harness 当前模型/);
  await assert.rejects(flow.execute(example.id, 1), /需要 Harness 当前模型/);
  assert.equal((await flow.open(p.id)).modelRequests, 0);
  await assert.rejects(flow.update({ projectId: p.id, stage: 1, source: 'preset' }), /当前模型/);
});
test('prerequisites, draft confirmation and human approval are enforced', async t => {
  const { flow, p } = await setup(t);
  await assert.rejects(flow.execute(p.id, 2), /请先执行并确认/);
  await flow.execute(p.id, 1);
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'model'), /工程师/);
  await assert.rejects(flow.confirm({ projectId: p.id, stage: 1 }, 'human'), error => {
    assert.equal(error.code, 'review');
    assert.deepEqual(error.details.gaps, ['test gap']);
    assert.match(error.message, /本步待确认项/);
    return true;
  });
  await flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'human');
  const p2 = await flow.execute(p.id, 2); assert.deepEqual(p2.stages[1].gaps, ['test gap']); assert.equal(p2.modelRequests, 2);
});
test('upstream edit and output drift invalidate dependent confirmations', async t => {
  const { flow, p } = await setup(t);
  await flow.execute(p.id, 1); await flow.confirm({ projectId: p.id, stage: 1, allowDraft: true }, 'human');
  const p2 = await flow.execute(p.id, 2); await flow.confirm({ projectId: p.id, stage: 2, allowDraft: true }, 'human');
  const p3 = await flow.update({ projectId: p.id, stage: 3, inputs: { stageNotes: { 3: 'new data' } } });
  assert(p3.stages[1].confirmed);
  await assert.rejects(flow.update({ projectId: p.id, stage: 3, inputs: { stageNotes: { 1: 'bypass' } } }), /当前步骤/);
  await fs.writeFile(path.join(p2.stages[0].output, 'result.json'), '{}');
  const changed = await flow.open(p.id); assert.equal(changed.stages[0].status, 'stale'); assert(!changed.stages[1].confirmed);
});
test('default input applicability includes constraints and every note, excludes supplemental PDF', async t => {
  const { flow } = await setup(t); const p = await flow.create({ legacy: true, caseId: 'display-board' });
  assert(await flow.structuredEligible(p));
  p.inputs.datasheets.push({ path: 'provided.pdf' }); assert(await flow.structuredEligible(p));
  p.inputs.stageNotes[6] = 'use a different board size'; assert.equal(await flow.structuredEligible(p), false);
  delete p.inputs.stageNotes[6]; p.inputs.constraints.layerPolicy = 'four layers'; assert.equal(await flow.structuredEligible(p), false);
});
test('full input reader supports continuation and rejects directory escape', async t => {
  const { flow, root } = await setup(t); const p = await flow.create({ legacy: true, caseId: 'display-board' });
  const first = await flow.readEvidence(p, 1, { path: '01_task/requirements.json', length: 50 });
  const second = await flow.readEvidence(p, 1, { path: first.path, offset: first.nextOffset, length: 50 });
  assert.equal(first.nextOffset, 50); assert.equal(second.offset, 50); assert.equal(first.sha256, second.sha256);
  await assert.rejects(within(root, path.dirname(root)), /工作区/);
  await assert.rejects(flow.readEvidence(p, 1, { path: '../project.json' }), /工作区/);
});
test('Harness streaming adapter performs actual read protocol and records provider/model', async () => {
  let prepared=0, reads=0; const records=[];
  const ctx={ get(name) { return name==='agentDefaultModel' ? {currentSelection:()=>({provider:'test',model:'TEST-DOUBLE'})} : {async prepareCall(){ const round=prepared++;return {config:{},async *stream(){yield {type:'text-delta',index:0,text:JSON.stringify(round===0?{action:'read',files:[{scope:'prepared',path:'intake.json'}]}:plan)};yield {type:'finish',reason:{kind:'stop'}};}};}};}};
  const result=await harnessAI(ctx).generate({project:{mode:'design'},stage:{id:1},request:{},record:async r=>records.push(r),read:async()=>{reads++;return {text:'input'};}});
  assert.equal(prepared,2);assert.equal(reads,1);assert.equal(result.model,'TEST-DOUBLE');assert.equal(records.filter(r=>r.event==='request').length,2);
});
test('failed model does not fall back to preset or mark stage complete',async t=>{
  const {flow,p}=await setup(t);flow.ai={async generate(){throw new Error('quota exhausted');}};
  await assert.rejects(flow.execute(p.id,1),/quota exhausted/);const after=await flow.open(p.id);assert.equal(after.stages[0].status,'failed');assert(!after.stages[0].confirmed);
});
test('cross-site operations rejected; generated content served sandboxed',async t=>{
  const {flow,p}=await setup(t);const action=routes(flow).find(r=>r.name==='action');
  await assert.rejects(action.run(new Request('http://localhost/api/eda-flow/action',{method:'POST',headers:{origin:'http://wrong','content-type':'application/json'},body:'{}'})),/跨站/);
  const step=(await flow.execute(p.id,1)).stages[0];await fs.writeFile(path.join(step.output,'unsafe.html'),'<script>alert(1)</script>');
  const response=await routes(flow).find(r=>r.name==='asset').run(new Request(`http://localhost/api/eda-flow/asset?projectId=${p.id}&stage=1&path=unsafe.html`));
  assert.match(response.headers.get('content-security-policy'),/sandbox/);
});
