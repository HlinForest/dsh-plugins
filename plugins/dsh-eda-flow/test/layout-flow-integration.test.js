import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Flow} from '../src/service.js';
import {checkFreeze} from '../src/controlled-layout.js';
import {hash, readJSON, tree, writeJSON} from '../src/io.js';

const configFor = root => ({
  workspaceRoot: root,
  workDirectory: root,
  kicadPython: 'D:/anaconda/python.exe',
  kicadCli: 'D:/Kicad/bin/kicad-cli.exe',
  allowModelCalls: true,
});

const sourceText = 'Reference RX9, part SENSOR-X. Pin 17 OUT output, pin 42 GND power_in, pin 101 VCC power_in. The device operates from a 5 V supply. The OUT pin provides the receiver signal.';

function makePdf(file) {
  execFileSync('D:/anaconda/python.exe', ['-c', [
    'import pymupdf,sys',
    'doc=pymupdf.open()',
    'page=doc.new_page()',
    'page.insert_textbox((40,40,560,120),sys.argv[2])',
    'doc.save(sys.argv[1])',
  ].join(';'), file, sourceText], {windowsHide: true});
}

function receiverDesign(sourceFactId) {
  return {
    components: [
      {sourceFactId, ref: 'RX9'},
      {id: 'bypass', ref: 'C8', value: '100n', mpn: '', footprint: '', librarySymbol: 'Device:C',electricalRole:'decoupling', dnp: false, in_bom: true, on_board: true,
        pins: [{number: '1', name: '', type: 'passive', pad: '1'}, {number: '2', name: '', type: 'passive', pad: '2'}]},
      {id: 'pull-down', ref: 'R7', value: '10k', mpn: '', footprint: '', librarySymbol: 'Device:R', dnp: false, in_bom: true, on_board: true,
        pins: [{number: '1', name: '', type: 'passive', pad: '1'}, {number: '2', name: '', type: 'passive', pad: '2'}]},
      {id: 'power-entry', ref: 'J1', value: '5V_IN', mpn: '', footprint: '', librarySymbol: 'Connector_Generic:Conn_01x01', dnp: false, in_bom: true, on_board: true,
        pins: [{number: '1', name: 'Pin_1', type: 'passive', pad: '1'}]},
    ],
    nets: [
      {name: 'OUT', nodes: [{ref: 'RX9', pinName: 'OUT'}, 'R7.1']},
      {name: 'GND', nodes: [{ref: 'RX9', pinName: 'GND'}, 'C8.2', 'R7.2']},
      {name: 'VCC', nodes: [{ref: 'RX9', pinName: 'VCC'}, 'C8.1', 'J1.1']},
    ],
    nc: [],
    supplied_nets: ['GND', 'VCC'],
    peripheralAssessments:[{ref:'RX9',pins:{supply:'101',return:'42',output:'17'},
      supply:{strategy:'unresolved',components:[],basis:'This test source does not specify the filter.',unresolved:['Filter requirements remain unknown.']},
      output:{strategy:'unresolved',components:[],basis:'This test source does not specify output bias.',unresolved:['Output structure remains unknown.']}}],
    operatingPoints:[{id:'supply',kind:'supply-transient',owner:'RX9',components:['C8'],inputs:Object.fromEntries(
      Object.entries({loadStepCurrent:[.1,'mA'],supportTime:[1,'us'],maxDroop:[.1,'V'],effectiveCapacitanceRatio:[1,'ratio'],equivalentEsr:[.1,'ohm']})
        .map(([k,[value,unit]])=>[k,{value,unit,basis:{assumption:'Isolated layout-test condition, not a device rating.'}}]))}],
    functions: [{
      requirementId: 'signal',
      description: 'RX9 output reaches the pull-down node while C8 remains assigned to RX9 supply and return.',
      checks: [{kind: 'connected', nodes: [{ref: 'RX9', pinName: 'OUT'}, 'R7.1']}],
      limitations: ['Capacitor value and receiver performance still require engineering verification.'],
      layout: [{kind: 'decoupling', anchor: {ref: 'RX9', pinName: 'VCC'}, return: {ref: 'RX9', pinName: 'GND'}, members: ['C8']}],
    }],
    unresolved: [],
  };
}

const finish = (summary = 'layout-flow integration test') => ({
  action: 'finish', provider: 'test-double', model: 'layout-flow-integration-test-double',
  summary, gaps: [], assumptions: [],
});

test('named decoupling ownership survives reviewed short ID, freeze, and stage-4 inspect; tampering invalidates freeze', {timeout: 180000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'layout-intent-flow-'));
  t.after(() => fs.rm(root, {recursive: true, force: true, maxRetries: 5}));
  const pdf = path.join(root, 'receiver-spec.pdf');
  makePdf(pdf);

  let sourceFactId;
  let reviewedDesignId;
  const ai = {async generateText(args) {
    if (args.stage.id === 2) {
      const page = args.request.inputs.evidence.find(row => row.content.includes('Reference RX9'));
      assert(page, 'the uploaded source PDF must be visible to the model');
      const fact = {
        reference: 'RX9', value: 'SENSOR-X', componentKind: 'infrared-receiver', objectRole: 'electrical',
        pins: [
          {number: '17', name: 'OUT', type: 'output'},
          {number: '42', name: 'GND', type: 'power_in'},
          {number: '101', name: 'VCC', type: 'power_in'},
        ],
        citations: [{sourceId: page.id, quote: sourceText}],
      };
      const recorded = await args.invoke('spec_record_facts', {componentFacts: [fact]});
      assert.deepEqual(recorded, {accepted: ['RX9'], total: 1});
      await args.invoke('spec_record_guidance',{guidance:[{subject:'RX9 supply',category:'supply',statement:'The device operates from a 5 V supply.',citations:[{sourceId:page.id,quote:'The device operates from a 5 V supply.'}]}]});
      const result = {...finish('record receiver source facts'), requirements: [{id: 'signal', description: 'RX9 output drives a pull-down node.'}]};
      assert.equal(await args.validateFinish(result), null);
      return result;
    }
    if (args.stage.id === 3) {
      const candidate = receiverDesign(sourceFactId);
      candidate.applicationDecisions=args.request.applicationGuidance.map(g=>({guidanceId:g.id,action:'adopt',components:['RX9'],reason:'Use the source supply for the selected receiver.',operatingPoints:[],unresolved:['The supply margin remains unverified.']}));
      const reviewed = await args.invoke('design_review', {design: candidate});
      assert.equal(reviewed.valid, true,reviewed.errors?.join('\n'));
      assert.equal(typeof reviewed.reviewedDesignId, 'string');
      reviewedDesignId = reviewed.reviewedDesignId;
      const shortFinish = {...finish('reviewed receiver design'), reviewedDesignId};
      assert.equal(await args.validateFinish(shortFinish), null);
      assert.equal(shortFinish.design.functions[0].layout[0].anchor, 'RX9.101');
      assert.equal(shortFinish.design.functions[0].layout[0].return, 'RX9.42');
      assert.deepEqual(shortFinish.design.functions[0].layout[0].members, ['C8']);
      assert.deepEqual(shortFinish.design.applicationDecisions,candidate.applicationDecisions);
      return shortFinish;
    }
    if (args.stage.id === 4) {
      const inspected = await args.invoke('layout_inspect', {});
      const relation = inspected.design.functions[0].layout[0];
      assert.deepEqual(relation, {kind: 'decoupling', anchor: 'RX9.101', return: 'RX9.42', members: ['C8']});
      return {...finish('inspect retained frozen ownership'), action: 'question', questions: ['图面生成前保留当前去耦归属，等待工程师确认布局。']};
    }
    throw new Error(`unexpected stage ${args.stage.id}`);
  }};

  const flow = new Flow(configFor(root), ai);
  t.after(() => flow.close());
  let project = await flow.create({label: 'named decoupling ownership', designMode: 'new-design'});
  await flow.update({projectId: project.id, stage: 1, inputs: {requirements: 'Use the RX9 source receiver and one local bypass capacitor; derive connections from source pin names without a supplied full netlist.'}});
  await flow.confirm({projectId: project.id, stage: 1}, 'human');
  project = await flow.attach({projectId: project.id, stage: 2, path: pdf, binding: 'receiver'});
  project = await flow.execute(project.id, 2);
  assert(project.stages[1].result, `stage 2 result missing: ${JSON.stringify(project.stages[1])}`);
  assert(Array.isArray(project.stages[1].result.evidenceFacts), `stage 2 facts missing: ${JSON.stringify(project.stages[1].result)}`);
  sourceFactId = project.stages[1].result.evidenceFacts[0].id;
  await flow.confirm({projectId: project.id, stage: 2, allowDraft: true}, 'human');
  project = await flow.execute(project.id, 3);
  assert.equal(project.stages[2].plan.reviewedDesignId, undefined, 'the execution-scoped short ID is consumed after restoring the reviewed design');
  const frozenBeforeConfirm = project.stages[2].plan.design.functions[0].layout[0];
  assert.deepEqual(frozenBeforeConfirm, {kind: 'decoupling', anchor: 'RX9.101', return: 'RX9.42', members: ['C8']});
  project = await flow.confirm({projectId: project.id, stage: 3, allowDraft: true}, 'human');
  const frozen = await checkFreeze(flow, project);
  assert.deepEqual(frozen.design.functions[0].layout[0], frozenBeforeConfirm);
  assert.equal(frozen.design.functions[0].layout[0].members[0], 'C8');

  project = await flow.execute(project.id, 4);
  assert.equal(project.stages[3].status, 'waiting-input');
  assert.equal(project.stages[3].result, null, 'inspect-only question must not publish a layout');

  const tampered = await flow.load(project.id);
  tampered.stages[2].plan.design.functions[0].layout[0].members = ['R7'];
  await flow.save(tampered);
  await assert.rejects(() => checkFreeze(flow, tampered), /冻结清单或已确认第三步发生变化/);
});

function simplePowerDesign() {
  const component = (id, ref, librarySymbol, value, pins) => ({id, ref, librarySymbol, value, mpn: '', footprint: '', dnp: false, in_bom: true, on_board: true, pins});
  return {
    components: [
      {...component('entry', 'J1', 'Connector_Generic:Conn_01x02', 'POWER', [{number: '1', name: 'Pin_1', type: 'passive', pad: '1'}, {number: '2', name: 'Pin_2', type: 'passive', pad: '2'}]), footprint: 'Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical'},
      {...component('c1', 'C1', 'Device:C', '100n', [{number: '1', name: '', type: 'passive', pad: '1'}, {number: '2', name: '', type: 'passive', pad: '2'}]), footprint: 'Capacitor_SMD:C_0603_1608Metric'},
      {...component('c2', 'C2', 'Device:C', '1u', [{number: '1', name: '', type: 'passive', pad: '1'}, {number: '2', name: '', type: 'passive', pad: '2'}]), footprint: 'Capacitor_SMD:C_0603_1608Metric'},
    ],
    nets: [
      {name: 'VCC', nodes: ['J1.1', 'C1.1', 'C2.1']},
      {name: 'GND', nodes: ['J1.2', 'C1.2', 'C2.2']},
    ],
    nc: [], supplied_nets: [],
    functions: [{requirementId: 'power', description: 'Retain the local bypass pair.', checks: [{kind: 'connected', nodes: ['J1.1', 'C1.1']}, {kind: 'connected', nodes: ['J1.2', 'C1.2']}], limitations: []}],
    unresolved: [],
  };
}

function fixtureAudit(layout) {
  return {
    status: 'passed', errors: [], symbols: 3, pins: 6, nets: 2, nc: [],
    erc: {errors: 0, warnings: 0, violations: []},
    layout: {pageMm: [420, 297], localWireGroups: 0, textOverlaps: 0, wireBodyCrossings: 0, wireTextCrossings: 0},
    paperSelection: {requested: layout.paper, selected: layout.paper},
    effectiveLayout: structuredClone(layout),
    scope: 'test fixture: native audit passed; routing is checked independently',
  };
}

async function writeGeneratedFixture(project, bad) {
  await fs.mkdir(project, {recursive: true});
  const pins = bad
    ? {'A.1': [0, 0], 'A.2': [0, 10], 'B.1': [120, 0], 'B.2': [120, 10]}
    : {'A.1': [0, 0], 'A.2': [0, 10], 'B.1': [10, 0], 'B.2': [10, 10]};
  const wires = bad
    ? [[0, 0, 120, 0], [0, 10, 120, 10], [0, 0, 0, 120], [120, 0, 120, 120], [0, 120, 120, 120]]
    : [[0, 0, 10, 0], [0, 10, 10, 10]];
  const records = wires.map(([x1, y1, x2, y2]) => `  (wire (pts (xy ${x1} ${y1}) (xy ${x2} ${y2})) (stroke (width 0.18) (type default)))`).join('\n');
  await fs.writeFile(path.join(project, 'Circuit.kicad_sch'), `(kicad_sch (version 20260101)\n${records}\n)`, 'utf8');
  await writeJSON(path.join(project, 'readback.json'), {
    components: [
      {reference: 'A', at: [0, 0, 0], properties: [], in_bom: true, on_board: true, dnp: false},
      {reference: 'B', at: [bad ? 120 : 10, 10, 0], properties: [], in_bom: true, on_board: true, dnp: false},
    ],
    pins, pinDetails: {}, nets: [{name: 'N1', nodes: ['A.1', 'B.1']}, {name: 'N2', nodes: ['A.2', 'B.2']}], nc: [],
  });
  await writeJSON(path.join(project, 'audit.json'), fixtureAudit({template: 'generic-v1', paper: 'A3-landscape', gapMm: 7.62, groups: [{id: 'fixture', title: 'fixture', references: ['A', 'B']}]}));
  await fs.writeFile(path.join(project, 'Circuit.pdf'), '%PDF-1.4\nfixture\n', 'utf8');
  await fs.writeFile(path.join(project, 'Circuit.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>', 'utf8');
  await fs.writeFile(path.join(project, 'bom.csv'), 'Reference,Value\nA,A\nB,B\n', 'utf8');
}

test('native audit can pass while routing fails; stage-4 cannot finish and keeps the previous valid layout', {timeout: 180000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'routing-gate-flow-'));
  t.after(() => fs.rm(root, {recursive: true, force: true, maxRetries: 5}));
  let fixtureMode = 'good';
  const finishAction = finish('generated fixture');
  const ai = {async generateText(args) {
    if (args.stage.id === 2) return {...finish('record requirements'), requirements: [{id: 'power', description: 'Retain the local bypass pair.'}]};
    if (args.stage.id === 3) return {...finish('freeze fixture design'), design: simplePowerDesign()};
    if (args.stage.id === 4 || args.stage.id === 5) {
      await args.invoke('layout_inspect', {});
      const layout = {template: 'generic-v1', paper: 'A3-landscape', gapMm: 7.62, groups: [{id: 'fixture', title: 'fixture', references: ['A', 'B']}]};
      if (fixtureMode === 'bad') {
        const operation = args.stage.id === 4 ? 'layout_generate' : 'layout_verify';
        await assert.rejects(() => args.invoke(operation, operation === 'layout_generate' ? layout : {}), /绕线检查未通过/);
        assert.match(await args.validateFinish(finishAction), /必须实际生成并调用 layout_verify/);
        return {...finish('routing review required'), action: 'question', questions: ['绕线可读性审查未通过，保留上一版原理图并等待重新排版。']};
      }
      if (args.stage.id === 4) await args.invoke('layout_generate', layout);
      await args.invoke('layout_verify', {});
      assert.equal(await args.validateFinish(finishAction), null);
      return finishAction;
    }
    throw new Error(`unexpected stage ${args.stage.id}`);
  }};
  const flow = new Flow(configFor(root), ai);
  t.after(() => flow.close());
  const originalRun = flow.runProcess.bind(flow);
  const badProjects = [];
  flow.runProcess = async (args, output, signal, event) => {
    const script = String(args[0] || '');
    if (script.endsWith(path.join('mcp', 'generic_layout.py'))) {
      const request = await readJSON(args[1]);
      if (request.operation === 'generate' || request.operation === 'verify') {
        if (fixtureMode === 'bad') badProjects.push({operation: request.operation, project: request.output});
        await writeGeneratedFixture(request.output, fixtureMode === 'bad');
        await writeJSON(args[2], fixtureAudit(request.layout));
        return;
      }
    }
    return originalRun(args, output, signal, event);
  };

  let project = await flow.create({label: 'routing gate fixture', designMode: 'new-design'});
  await flow.update({projectId: project.id, stage: 1, inputs: {requirements: 'Keep a local bypass pair on a simple power input.'}});
  await flow.confirm({projectId: project.id, stage: 1}, 'human');
  await flow.execute(project.id, 2);
  await flow.confirm({projectId: project.id, stage: 2, allowDraft: true}, 'human');
  await flow.execute(project.id, 3);
  project = await flow.confirm({projectId: project.id, stage: 3, allowDraft: true}, 'human');
  await flow.execute(project.id, 4);
  project = await flow.open(project.id);
  assert.equal(project.stages[3].status, 'done');
  const stage4Baseline = structuredClone(project.lastValidLayout);
  assert(stage4Baseline?.project, 'the first layout must become the valid published baseline');
  const stage4FilesHash = hash(await tree(stage4Baseline.project));
  const stage4Routing = await readJSON(path.join(stage4Baseline.project, 'routing-quality.json'));
  assert.equal(stage4Routing.status, 'passed');
  project = await flow.confirm({projectId: project.id, stage: 4, allowDraft: true}, 'human');

  // Stage 5 receives a copy of the confirmed stage-4 project and only verifies
  // it.  The new routing report belongs to the copy; the historical stage-4
  // tree and its recorded hash must remain byte-for-byte stable.
  project = await flow.execute(project.id, 5);
  assert.equal(project.stages[4].status, 'done');
  const stage5Baseline = structuredClone(project.lastValidLayout);
  assert(stage5Baseline?.project);
  assert.equal(hash(await tree(stage4Baseline.project)), stage4FilesHash);
  const stage5Routing = await readJSON(path.join(stage5Baseline.project, 'routing-quality.json'));
  assert.equal(stage5Routing.status, 'passed');
  const frozenAfterStage5 = await checkFreeze(flow, project);
  assert.equal(frozenAfterStage5.hash, stage5Baseline.electricalHash);
  project = await flow.confirm({projectId: project.id, stage: 5, allowDraft: true}, 'human');

  // A long-wire mutation in the stage-5 copy is caught by verify itself.  It
  // cannot replace the already valid stage-5 publication baseline.
  fixtureMode = 'bad';
  await flow.update({projectId: project.id, stage: 5, inputs: {stageNotes: {5: 'Verify the current copy and reject a long-wire mutation.'}}});
  project = await flow.execute(project.id, 5);
  assert.equal(project.stages[4].status, 'waiting-input');
  assert.equal(project.stages[4].result, null);
  assert.equal(project.lastValidLayout.project, stage5Baseline.project);
  assert.equal(project.lastValidLayout.electricalHash, stage5Baseline.electricalHash);
  assert.equal(hash(await tree(stage4Baseline.project)), stage4FilesHash);
  assert.equal((await checkFreeze(flow, project)).hash, stage5Baseline.electricalHash);
  const badVerifyProject = badProjects.find(item => item.operation === 'verify' && item.project.includes(`${path.sep}steps${path.sep}5${path.sep}`))?.project;
  assert(badVerifyProject, 'stage-5 verify must materialize the rejected current copy');
  const badVerifyAudit = await readJSON(path.join(badVerifyProject, 'audit.json'));
  const badVerifyRouting = await readJSON(path.join(badVerifyProject, 'routing-quality.json'));
  assert.equal(badVerifyAudit.status, 'passed');
  assert.equal(badVerifyRouting.status, 'failed');
  assert(badVerifyRouting.findings.some(f => f.code === 'LONG_WIRE_CLUSTER' || f.code === 'PARALLEL_TRACK_ENVELOPE'));

  // Retain the original stage-4 generation failure assertion too: generation
  // and verify share the same gate, while stage-5 remains the valid baseline.
  await flow.update({projectId: project.id, stage: 4, inputs: {stageNotes: {4: 'Retry generation with a deliberately poor routing fixture.'}}});
  project = await flow.execute(project.id, 4);
  assert.equal(project.stages[3].status, 'waiting-input');
  assert.equal(project.stages[3].result, null, 'routing failure must not publish a new result');
  assert.equal(project.stages[3].outputHash, undefined, 'waiting-input retry has no publication hash');
  assert.equal(project.lastValidLayout.project, stage5Baseline.project, 'the prior valid layout remains the publication baseline');
  assert.equal(project.lastValidLayout.electricalHash, stage5Baseline.electricalHash);
  const badGenerateProject = badProjects.find(item => item.operation === 'generate' && item.project.includes(`${path.sep}steps${path.sep}4${path.sep}`))?.project;
  assert(badGenerateProject, 'stage-4 generation must materialize the rejected candidate');
  const nativeAudit = await readJSON(path.join(badGenerateProject, 'audit.json'));
  const routing = await readJSON(path.join(badGenerateProject, 'routing-quality.json'));
  assert.equal(nativeAudit.status, 'passed');
  assert.equal(nativeAudit.erc.errors, 0);
  assert.equal(routing.status, 'failed');
  assert(routing.findings.some(f => f.code === 'LONG_WIRE_CLUSTER' || f.code === 'PARALLEL_TRACK_ENVELOPE'));
});

