import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Flow } from '../src/service.js';

const inlineText = 'The receiver requires a regulated 5 V supply.';
const requirements = [{ id: 'supply', description: 'Provide the receiver with its documented supply.' }];

async function setup(t, generateText, label) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guidance-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const flow = new Flow({ workspaceRoot: root, workDirectory: root, allowModelCalls: true }, { generateText });
  t.after(() => flow.close());
  let project = await flow.create({ label, designMode: 'new-design' });
  project = await flow.update({ projectId: project.id, stage: 1, inputs: { requirements: 'Design a receiver input with a documented 5 V supply.' } });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  project = await flow.update({ projectId: project.id, stage: 2, inputs: { datasheetText: inlineText } });
  return { flow, project };
}

function finish() {
  return { action: 'finish', provider: 'test-double', model: 'guidance-empty-test', summary: 'inline source reviewed', requirements, gaps: [], assumptions: [] };
}

test('stage 2 accepts finish with guidance:[] when the model uses no guidance tool', async t => {
  let calls = 0;
  const { flow, project } = await setup(t, async args => {
    calls += 1;
    assert.equal(args.stage.id, 2);
    assert.equal(args.request.inputs.datasheetText, inlineText);
    const source = args.request.inputs.evidence.find(row => row.content === inlineText);
    assert(source, 'saved inline datasheet text should be model evidence');
    assert.equal(source.sourceType, 'user-provided-text');
    const result = { ...finish(), guidance: [] };
    assert.equal(await args.validateFinish(result), null);
    return result;
  }, 'guidance empty without tool');

  const completed = await flow.execute(project.id, 2);
  assert.equal(calls, 1);
  assert.equal(completed.stages[1].status, 'done');
  assert.deepEqual(completed.stages[1].result.guidance, []);
});

test('stage 2 removal of all accepted guidance prevents finish from resurrecting it', async t => {
  const { flow, project } = await setup(t, async args => {
    assert.equal(args.stage.id, 2);
    const source = args.request.inputs.evidence.find(row => row.content === inlineText);
    assert(source, 'saved inline datasheet text should be model evidence');
    const oldGuidance = {
      subject: 'receiver',
      category: 'supply',
      statement: inlineText,
      citations: [{ sourceId: source.id, quote: inlineText }],
    };
    const accepted = await args.invoke('spec_record_guidance', { guidance: [oldGuidance] });
    assert.equal(accepted.total, 1);
    const removed = await args.invoke('spec_record_guidance', { removeIds: accepted.accepted });
    assert.deepEqual(removed, { accepted: [], total: 0 });

    const result = { ...finish(), guidance: [oldGuidance] };
    assert.equal(await args.validateFinish(result), null);
    assert.equal(result.guidance, undefined, 'finish must discard removed guidance');
    return result;
  }, 'guidance removal does not resurrect');

  const completed = await flow.execute(project.id, 2);
  assert.equal(completed.stages[1].status, 'done');
  assert.deepEqual(completed.stages[1].result.guidance, []);
});
