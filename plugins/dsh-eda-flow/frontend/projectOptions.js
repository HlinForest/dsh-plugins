export const primaryProjects = [
  ['new', '空白项目'],
  ['mentor-display', '显示板'],
];
export const advancedProjects = [
  ['fixed-generic', '导入固定器件清单'],
];

const supportedTemplates = new Set([...primaryProjects, ...advancedProjects].map(([id]) => id));

// Historical projects may still be listed and opened, but new projects only
// expose the same two text workflows (plus the optional generic parts list).
export function projectRequest(name, template, fixedParts) {
  if (!supportedTemplates.has(template)) throw new Error('该项目类型仅可查看历史项目，不能新建。');
  return { action: 'create', label: name,
    demoPreset: template === 'mentor-display' ? 'display-board' : undefined,
    caseId: null,
    fixedParts: template === 'fixed-generic' ? fixedParts : undefined,
    designMode: template === 'fixed-generic' ? 'fixed-redesign' : 'new-design',
    mode: 'text-mcp', scope: 'schematic' };
}
