import test from 'node:test';
import assert from 'node:assert/strict';
import {primaryProjects, advancedProjects, projectRequest} from './projectOptions.js';

test('two primary choices, all five legacy choices remain reachable', () => {
  assert.deepEqual(primaryProjects, [['new','空白项目'],['mentor-display','显示板示例']]);
  assert.deepEqual(advancedProjects.map(([id])=>id), ['fixed-generic','datasheet-demo','new-display','fixed-redesign','reconstruction']);
});
test('all creation modes retain their previous backend contract', () => {
  const parts=[{ref:'R1',librarySymbol:'Device:R',value:'1k'}];
  const cases=[['new','new-design',null],['mentor-display','new-design',null],['fixed-generic','fixed-redesign',null],['datasheet-demo','datasheet-demo','display-board'],['new-display','new-design','display-board'],['fixed-redesign','fixed-redesign','display-board'],['reconstruction','reconstruction','display-board'],[true,'datasheet-demo','display-board'],[false,'reconstruction',null]];
  for (const [id,mode,caseId] of cases) {
    assert.deepEqual(projectRequest('测试',id,parts), {action:'create',label:'测试',demoPreset:id==='mentor-display'?'display-board':undefined,caseId,fixedParts:id==='fixed-generic'?parts:undefined,designMode:mode,mode:'text-mcp',scope:'schematic'});
  }
});
