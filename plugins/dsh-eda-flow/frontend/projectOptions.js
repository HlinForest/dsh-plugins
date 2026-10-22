export const primaryProjects = [
  ['new', '空白项目'],
  ['mentor-display', '显示板示例'],
];
export const advancedProjects = [
  ['fixed-generic', '导入固定器件清单'],
  ['datasheet-demo', '旧版显示板 · 模拟提取资料'],
  ['new-display', '旧版显示板 · 简短需求'],
  ['fixed-redesign', '固定原器件 · 重新设计'],
  ['reconstruction', '历史原图复原'],
];

// Keep persisted modes and legacy creation identifiers unchanged.
export function projectRequest(name, template, fixedParts) {
  return { action: 'create', label: name,
    demoPreset: template === 'mentor-display' ? 'display-board' : undefined,
    caseId: template === true || ['datasheet-demo', 'fixed-redesign', 'new-display', 'reconstruction'].includes(template) ? 'display-board' : null,
    fixedParts: template === 'fixed-generic' ? fixedParts : undefined,
    designMode: template === 'datasheet-demo' || template === true ? 'datasheet-demo' : ['fixed-redesign', 'fixed-generic'].includes(template) ? 'fixed-redesign' : typeof template === 'string' && template !== 'reconstruction' ? 'new-design' : 'reconstruction',
    mode: 'text-mcp', scope: 'schematic' };
}
