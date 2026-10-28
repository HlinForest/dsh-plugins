import test from 'node:test';
import assert from 'node:assert/strict';
import { fieldsOf, inputChangesForFields } from './api.js';
test('visible process fields round-trip without changing schematic constraints',()=>{
 const c=inputChangesForFields({pcbSmdSide:'底面',pcbCopper:'电源与回流铜区',pcbDecouplingMm:'5'},{constraints:{rulePolicy:'原理图规则'}});
 assert.equal(c.ui,undefined);assert.equal(c.constraints.rulePolicy,'原理图规则');
 const f=fieldsOf({mode:'text-mcp',inputs:c});assert.equal(f.pcbSmdSide,'底面');assert.equal(f.pcbDecouplingMm,'5');
});

test('PCB text fields save into constraints and round-trip with legacy UI fallback', () => {
  const changes = inputChangesForFields({
    outline: '40 × 30 mm',
    cadLayers: 'F.Cu / B.Cu',
    routing: '背面 B.Cu',
    manufacture: '双面铜',
    plating: '金属化孔',
    rules: '线宽 0.2 mm',
  }, { constraints: { packagePolicy: '贴片' }, ui: { cadLayers: '旧 UI 值' } });

  assert.deepEqual(changes, {
    constraints: {
      packagePolicy: '贴片',
      outlinePolicy: '40 × 30 mm',
      cadLayers: 'F.Cu / B.Cu',
      routing: '背面 B.Cu',
      manufacture: '双面铜',
      plating: '金属化孔',
      rulePolicy: '线宽 0.2 mm',
    },
  });
  const fields = fieldsOf({ mode: 'text-mcp', inputs: { ...changes, ui: { cadLayers: '旧 UI 值' } } });
  assert.equal(fields.outline, '40 × 30 mm');
  assert.equal(fields.cadLayers, 'F.Cu / B.Cu');
  assert.equal(fields.routing, '背面 B.Cu');
  assert.equal(fields.manufacture, '双面铜');
  assert.equal(fields.plating, '金属化孔');
  assert.equal(fields.rules, '线宽 0.2 mm');
});

test('PCB rule edits use pcbRulePolicy without changing schematic rulePolicy', () => {
  const current = { constraints: { rulePolicy: '原理图规则' } };
  const changes = inputChangesForFields({ pcbRulePolicy: 'PCB 线宽与间距规则' }, current);
  assert.equal(changes.constraints.rulePolicy, '原理图规则');
  assert.equal(changes.constraints.pcbRulePolicy, 'PCB 线宽与间距规则');
  assert.equal(current.constraints.pcbRulePolicy, undefined);

  const fields = fieldsOf({ mode: 'text-mcp', designMode: 'new-design', inputs: { constraints: { ...current.constraints, pcbRulePolicy: changes.constraints.pcbRulePolicy } } });
  assert.equal(fields.rules, '原理图规则');
  assert.equal(fields.pcbRulePolicy, 'PCB 线宽与间距规则');
});
