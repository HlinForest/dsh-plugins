import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Flow } from '../src/service.js';
import { projectGuidance } from '../src/application-basis.js';
import { checkFreeze } from '../src/controlled-layout.js';
import { readJSON } from '../src/io.js';

// This circuit deliberately uses an unusual source reference and pin numbering.
// The only source-backed device comes from the uploaded document; R7 is a normal
// library part selected by the model.  No display-board fixture is involved.
const sourceText = 'Reference RX9, part SENSOR-X. Pin 17 OUT output, pin 42 GND power_in, pin 101 VCC power_in. The device operates from a 5 V supply. The OUT pin provides the receiver signal.';
const requirements = [{ id: 'signal', description: 'RX9 output drives a pull-down node.' }];
const finish = { action: 'finish', provider: 'test-double', model: 'autonomous-synthesis-test-double', summary: 'source facts and circuit proposal', gaps: [], assumptions: [] };

function makePdf(file) {
  execFileSync('D:/anaconda/python.exe', ['-c', [
    'import pymupdf,sys',
    'doc=pymupdf.open()',
    'page=doc.new_page()',
    'page.insert_textbox((40,40,560,120),sys.argv[2])',
    'doc.save(sys.argv[1])',
  ].join(';'), file, sourceText], { windowsHide: true });
}

function proposal(sourceFactId) {
  return {
    components: [
      { sourceFactId, ref: 'RX9' },
      { id: 'pull-down', ref: 'R7', value: '10k', mpn: '', footprint: '', librarySymbol: 'Device:R', dnp: false, in_bom: true, on_board: true,
        pins: [{ number: '1', name: '', type: 'passive', pad: '1' }, { number: '2', name: '', type: 'passive', pad: '2' }] },
      { id: 'power-entry', ref: 'J1', value: '5V_IN', mpn: '', footprint: '', librarySymbol: 'Connector_Generic:Conn_01x01', dnp: false, in_bom: true, on_board: true,
        pins: [{ number: '1', name: 'Pin_1', type: 'passive', pad: '1' }] },
    ],
    nets: [
      { name: 'OUT', nodes: [{ ref: 'RX9', pinName: 'OUT' }, { ref: 'R7', pinNumber: '1' }] },
      { name: 'GND', nodes: [{ ref: 'RX9', pinName: 'GND' }, { ref: 'R7', pinNumber: '2' }] },
      { name: 'VCC', nodes: [{ ref: 'RX9', pinName: 'VCC' }, { ref: 'J1', pinNumber: '1' }] },
    ],
    nc: [], supplied_nets: ['GND','VCC'],
    functions: [{ requirementId: 'signal', description: 'Verify RX9 output reaches the pull-down node.',
      checks: [{ kind: 'connected', nodes: [{ ref: 'RX9', pinName: 'OUT' }, { ref: 'R7', pinNumber: '1' }] }],
      limitations: ['Supply margin and physical performance require engineering verification.'] }],
    unresolved: ['The final resistor tolerance remains an engineering choice.'],
    // The sparse source cannot justify omitting receiver filtering or bias.
    // Keep those choices pending under the current peripheral review contract.
    peripheralAssessments: [{ref:'RX9',pins:{supply:'101',return:'42',output:'17'},
      supply:{strategy:'unresolved',components:[],basis:'The source has no filter application circuit.',unresolved:['Supply filtering needs application conditions.']},
      output:{strategy:'unresolved',components:[],basis:'OUT alone does not identify the output stage.',unresolved:['Output bias needs the actual device output topology.']}}],
  };
}

test('autonomous synthesis derives guidance and a native frozen design from sparse source facts', { timeout: 180000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'autonomous-synthesis-'));
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 5 }));
  const pdf = path.join(root, 'sensor-spec.pdf');
  makePdf(pdf);

  let stage3Request;
  let stage3Runs = 0;
  let confirmedFactId;
  let latestGuidanceId;
  let reviewedDesignId;
  const ai = { async generateText(args) {
    if (args.stage.id === 2) {
      const page = args.request.inputs.evidence.find(row => row.content.includes('Reference RX9'));
      assert(page, 'uploaded PDF page should reach stage 2');
      const fact = {
        reference: 'RX9', value: 'SENSOR-X', componentKind: 'infrared-receiver', objectRole: 'electrical',
        pins: [
          { number: '17', name: 'OUT', type: 'output' },
          { number: '42', name: 'GND', type: 'power_in' },
          { number: '101', name: 'VCC', type: 'power_in' },
        ],
        citations: [{ sourceId: page.id, quote: sourceText }],
      };
      assert.deepEqual(await args.invoke('spec_record_facts', { componentFacts: [fact] }), { accepted: ['RX9'], total: 1 });
      const initialGuidance = { subject: 'RX9', category: 'supply', statement: 'The device operates from a 5 V supply.', citations: [{ sourceId: page.id, quote: 'The device operates from a 5 V supply.' }] };
      const guidanceResult = await args.invoke('spec_record_guidance', { guidance: [initialGuidance] });
      assert.equal(guidanceResult.total, 1);
      const acceptedGuidanceId = guidanceResult.accepted[0];
      assert.match(acceptedGuidanceId, /^guidance-/);
      const corrected = await args.invoke('spec_record_guidance', { guidance: [{ ...initialGuidance, id: acceptedGuidanceId, statement: 'Use a regulated 5 V rail.' }] });
      assert.deepEqual(corrected.accepted, [acceptedGuidanceId]);
      assert.equal(corrected.total, 1);
      // A batch that mixes a valid edit with an unknown removal ID is atomic:
      // the valid edit must not replace the already accepted source fact.
      const invalidGuidanceBatch = { guidance: [{ ...initialGuidance, id: acceptedGuidanceId, statement: 'Use the stated 5 V supply.' }], removeIds: ['guidance-0000000000000000'] };
      await assert.rejects(args.invoke('spec_record_guidance', invalidGuidanceBatch), /尚未接受/);
      const unchanged = { ...finish, requirements };
      assert.equal(await args.validateFinish(unchanged), null);
      assert.equal(unchanged.guidance[0].id, acceptedGuidanceId);
      assert.equal(unchanged.guidance[0].statement, 'Use a regulated 5 V rail.');
      const additional = await args.invoke('spec_record_guidance', { guidance: [{ subject: 'RX9', category: 'interface', statement: 'The OUT pin provides the receiver signal.', citations: [{ sourceId: page.id, quote: 'The OUT pin provides the receiver signal.' }] }] });
      assert.equal(additional.total, 2);
      const additionalId = additional.accepted[0];
      assert.notEqual(additionalId, acceptedGuidanceId);
      const removed = await args.invoke('spec_record_guidance', { removeIds: [additionalId] });
      assert.equal(removed.total, 1);
      const removedAll = await args.invoke('spec_record_guidance', { removeIds: [acceptedGuidanceId] });
      assert.equal(removedAll.total, 0);
      const finalGuidance = await args.invoke('spec_record_guidance', { guidance: [{ ...initialGuidance, statement: 'Use a regulated 5 V rail.' }] });
      assert.equal(finalGuidance.total, 1);
      latestGuidanceId = finalGuidance.accepted[0];
      assert.notEqual(latestGuidanceId, acceptedGuidanceId);

      // The whole fact batch is validated before collection is mutated.
      await assert.rejects(
        args.invoke('spec_record_facts', { componentFacts: [fact, { ...fact, reference: 'R7', value: '10k', componentKind: 'resistor', pins: [{ number: '1', name: '', type: 'passive' }, { number: '2', name: '', type: 'passive' }], citations: [{ sourceId: page.id, quote: 'not present in the source' }] }] }),
        /原文/,
      );
      const result = { ...finish, requirements };
      assert.equal(await args.validateFinish(result), null);
      assert.equal(result.componentFacts.length, 1, 'invalid fact batch must not add a partial fact');
      assert.equal(result.guidance.length, 1);
      assert.equal(result.guidance[0].id, latestGuidanceId);
      assert.equal(result.guidance[0].statement, 'Use a regulated 5 V rail.');
      return result;
    }
    if (args.stage.id === 3) {
      stage3Runs += 1;
      stage3Request = args.request;
      assert.equal(args.tools.some(tool => tool.name === 'design_review'), true);
      assert.equal(stage3Request.applicationGuidance.length, 1);
      assert.equal(stage3Request.applicationGuidance[0].simulated, false);
      assert.equal(stage3Request.applicationGuidance[0].statement, 'Use a regulated 5 V rail.');
      assert.equal(stage3Request.applicationGuidance[0].id, latestGuidanceId);
      assert.match(stage3Request.sourceLibrary[0].id, /^Evidence:/);
      const design = proposal(confirmedFactId);
      design.applicationDecisions=stage3Request.applicationGuidance.map(g=>({guidanceId:g.id,action:'adopt',components:['RX9'],reason:'Use the stated supply for this source-backed receiver.',operatingPoints:[],unresolved:['Supply margin still requires hardware verification.']}));
      if (stage3Runs === 2) {
        const rejected = await args.invoke('design_review', { design });
        assert.equal(rejected.valid, false);
        assert.match(rejected.errors.join('\n'), /footprint|封装/);
        const finishError = await args.validateFinish({ ...finish, design });
        assert.match(finishError, /footprint|封装/);
        assert.match(await args.validateFinish({ ...finish, reviewedDesignId }), /未知或已过期|本次执行/);
        return { ...finish, action: 'question', questions: ['PCB器件封装需要补充或确认。'] };
      }
      const bad = structuredClone(design);
      const falseLimiter = structuredClone(design);
      Object.assign(falseLimiter.components.find(component=>component.ref==='R7'),{value:'0R',electricalRole:'current-limit'});
      const rejectedRole = await args.invoke('design_review',{design:falseLimiter});
      assert.equal(rejectedRole.valid,false,'structurally complete zero-ohm current limit must be rejected');
      assert.match(rejectedRole.errors.join('\n'),/正阻值|限流/);
      assert.match(await args.validateFinish({...finish,design:falseLimiter}),/正阻值|限流/,'finish must not bypass engineering review');
      bad.functions[0].checks = [{ kind: 'connected', nodes: [{ ref: 'RX9', pinName: 'OUT' }, { ref: 'RX9', pinName: 'GND' }] }];
      const rejected = await args.invoke('design_review', { design: bad });
      assert.equal(rejected.valid, false);
      assert.match(rejected.errors[0], /候选电路不满足功能连接|功能连接/);
      assert.equal(typeof rejected.candidateId,'string');
      assert.match(await args.validateFinish({...finish,reviewedDesignId:rejected.candidateId}),/未知或已过期|本次执行/);
      const expired=await args.invoke('design_amend',{candidateId:'foreign',unresolved:{add:['still pending']}});
      assert.equal(expired.valid,false);assert.match(expired.errors[0],/candidateId/);
      const accepted = await args.invoke('design_amend', {candidateId:rejected.candidateId,
        replaceRecords:[{section:'functions',key:'signal',record:design.functions[0]}]});
      assert.equal(accepted.valid, true, accepted.errors?.join('\n'));
      assert.equal(accepted.components, 3);
      assert.equal(accepted.engineeringReview.readiness.hardwareVerified,false);
      assert.equal(accepted.engineeringReview.readiness.status,'needs-review');
      assert.equal(typeof accepted.reviewedDesignId, 'string');
      reviewedDesignId = accepted.reviewedDesignId;
      const missingId=await args.validateFinish({...finish});
      assert.match(missingId,/漏了reviewedDesignId/);
      assert(missingId.includes(reviewedDesignId),'missing finish reference should return the exact available ID');
      assert.match(await args.validateFinish({ ...finish, reviewedDesignId: 'reviewed-unknown' }), /未知或已过期|本次执行/);
      assert.match(await args.validateFinish({ ...finish, design, reviewedDesignId }), /歧义|同时提供/);
      const shortFinish = { ...finish, reviewedDesignId };
      assert.equal(await args.validateFinish(shortFinish), null);
      assert.equal(shortFinish.reviewedDesignId, undefined, 'execution-scoped review ID is consumed after restoring design');
      assert.equal(shortFinish.design.components.length, 3, 'short finish restores the reviewed normalized candidate');
      assert.deepEqual(shortFinish.design.nets.find(net => net.name === 'OUT').nodes, ['RX9.17', 'R7.1']);
      return shortFinish;
    }
    throw new Error(`unexpected stage ${args.stage.id}`);
  } };

  const config = { workspaceRoot: root, workDirectory: root, allowModelCalls: true,
    kicadPython: 'D:/anaconda/python.exe', kicadCli: 'D:/Kicad/bin/kicad-cli.exe' };
  const flow = new Flow(config, ai);
  t.after(() => flow.close());
  let project = await flow.create({ label: 'RX9 autonomous synthesis', designMode: 'new-design' });
  await flow.update({ projectId: project.id, stage: 1, inputs: { requirements: 'Use the RX9 source device and a common pull-down resistor. Derive the wiring from the source pins; the user does not provide a full netlist.' } });
  await flow.confirm({ projectId: project.id, stage: 1 }, 'human');
  project = await flow.attach({ projectId: project.id, stage: 2, path: pdf, binding: 'receiver' });
  project = await flow.execute(project.id, 2);
  assert.equal(project.stages[1].result.evidenceFacts.length, 1);
  assert.equal(project.stages[1].result.guidance.length, 1);
  confirmedFactId = project.stages[1].result.evidenceFacts[0].id;
  await flow.confirm({ projectId: project.id, stage: 2, allowDraft: true }, 'human');
  project = await flow.execute(project.id, 3);
  const generated = project.stages[2].plan.design;
  assert.deepEqual(generated.nets.find(net => net.name === 'OUT').nodes, ['RX9.17', 'R7.1']);
  assert.deepEqual(generated.nets.find(net => net.name === 'GND').nodes, ['RX9.42', 'R7.2']);
    assert.deepEqual(generated.nets.find(net => net.name === 'VCC').nodes, ['RX9.101', 'J1.1']);
  assert.equal(project.electricalFreeze, undefined, 'stage 3 execution must not freeze before human confirmation');
  assert.equal(project.stages[2].status, 'done');
  assert.equal(project.stages[2].result.engineeringReview.readiness.hardwareVerified,false);
  assert(project.stages[2].result.checks.some(check=>check.name.includes('器件用途')&&check.status==='findings'));
  project = await flow.confirm({ projectId: project.id, stage: 3, allowDraft: true }, 'human');
  const frozen = await checkFreeze(flow, project);
  assert.equal(frozen.engine, 'native-kicad');
  const snapshot = await readJSON(frozen.library);
  assert.equal(snapshot.kind, 'native-kicad');
   assert.equal(snapshot.components.length, 3);
  assert(snapshot.symbols[generated.components.find(component => component.ref === 'RX9').librarySymbol]);
  assert.equal(snapshot.symbols.Device, undefined, 'snapshot keys remain exact library identifiers');
  assert(Object.keys(snapshot.symbols).includes('Device:R'));
  assert.equal(snapshot.components.find(component => component.ref === 'RX9').pins[0].number, '17');

  // The same candidate is allowed while the project is schematic-only. Once
  // the engineer enables PCB, both the review tool and finish validator must
  // reject its unresolved on-board footprints before any freeze can occur.
  project = await flow.dispatch({ action: 'enable-pcb', projectId: project.id }, undefined, 'human');
  project = await flow.execute(project.id, 3);
  assert.equal(project.stages[2].status, 'waiting-input');
  assert.match(project.stages[2].questions[0], /封装/);

  const stale = await flow.update({ projectId: project.id, stage: 2, inputs: { stageNotes: { 2: 'Re-check the source record before continuing.' } } });
  assert.equal(stale.stages[1].status, 'stale');
  assert.deepEqual(projectGuidance(stale), [], 'unconfirmed or stale guidance must not leak into stage 3');
  assert.equal(stale.electricalFreeze, undefined);
  assert.equal(stage3Request.applicationGuidance.length, 1, 'the previously confirmed request retained its own snapshot');
});
