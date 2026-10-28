import test from 'node:test';
import assert from 'node:assert/strict';
import { primaryProjects, advancedProjects, projectRequest } from './projectOptions.js';

test('new-project choices share the text workflow', () => {
  assert.deepEqual(primaryProjects, [['new', '空白项目'], ['mentor-display', '显示板']]);
  assert.deepEqual(advancedProjects, [['fixed-generic', '导入固定器件清单']]);
  assert.deepEqual(projectRequest('空白', 'new'), {
    action: 'create', label: '空白', demoPreset: undefined, caseId: null,
    fixedParts: undefined, designMode: 'new-design', mode: 'text-mcp', scope: 'schematic',
  });
  assert.deepEqual(projectRequest('显示板', 'mentor-display'), {
    action: 'create', label: '显示板', demoPreset: 'display-board', caseId: null,
    fixedParts: undefined, designMode: 'new-design', mode: 'text-mcp', scope: 'schematic',
  });
});

test('fixed generic remains explicit and legacy hidden modes cannot be silently created', () => {
  const parts = [{ ref: 'R1', librarySymbol: 'Device:R', value: '1k' }];
  assert.equal(projectRequest('固定器件', 'fixed-generic', parts).designMode, 'fixed-redesign');
  for (const template of ['datasheet-demo', 'new-display', 'fixed-redesign', 'reconstruction', true, false]) {
    assert.throws(() => projectRequest('历史项目', template), /仅可查看历史项目/);
  }
});
