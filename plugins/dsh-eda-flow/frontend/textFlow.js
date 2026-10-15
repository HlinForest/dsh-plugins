export const isTextFlow = project => project?.mode === 'text-mcp';

export function textInputRecord(project) {
  const inputs = project.inputs || {}, constraints = inputs.constraints || {};
  const fields = { ...inputs, mount: constraints.packagePolicy, rules: constraints.rulePolicy, ...inputs.ui, ...project.fields };
  const sections = [fields.requirements || ''];
  const append = (label, value) => {
    if (typeof value === 'string' && value.trim()) sections.push(`【${label}】\n${value}`);
  };
  for (const [key, label] of [
    ['power', '供电要求'], ['interfaces', '信号与接口'], ['mount', '封装与装配要求'],
    ['rules', '原理图设计约束'], ['acceptance', '验收要求'], ['basis', '设计依据与来源补充'],
    ['datasheetText', '规格书正文与来源'], ['review', '工程师评审意见'],
  ]) append(label, fields[key]);
  const notes = { ...inputs.stageNotes, ...project.stageNotes, ...project.notes };
  for (const [number, value] of Object.entries(notes).sort(([a], [b]) => Number(a) - Number(b))) {
    const title = project.stages?.find(stage => String(stage.id) === number)?.title;
    append(`第 ${number} 步${title ? ` · ${title}` : ''}：补充与公开问答`, value);
  }
  return sections.filter(Boolean).join('\n\n');
}

export function appendQuestionAnswer(previous, questions, answer, at = new Date().toISOString()) {
  const response = answer.trim();
  if (!response) throw new Error('请先填写对待补问题的回答。');
  return [previous?.trim(), `【文字问答 ${at}】\n${questions.map((q, i) => `问题 ${i + 1}：${q}`).join('\n')}\n工程师回答：${response}`].filter(Boolean).join('\n\n');
}

export function generatedPreviewFiles(project) {
  return (project.stages || []).filter(s => s.status === 'done').flatMap(s => {
    const files = (s.files || []).filter(f => /\.(svg|png)$/i.test(f.path) && !/raw|true-width/.test(f.path));
    const declared = (s.result?.previews || []).map(f => typeof f === 'string' ? { path: f } : f);
    return [...new Map([...files, ...declared].filter(f => f?.path).map(f => [f.path, { ...f, stage: s.id }])).values()];
  });
}

export function checkRows(checks) {
  if (Array.isArray(checks)) return checks.map((value, i) => typeof value === 'object' && value !== null ? { id: i, ...value } : { id: i, name: String(value) });
  return Object.entries(checks || {}).map(([name, value], id) => ({ id, name, ...(typeof value === 'object' && value !== null ? value : { result: value }) }));
}

export function checkStatus(check) {
  if (check.status) return ({ passed: '通过', pass: '通过', failed: '未通过', fail: '未通过', pending: '待验证', skipped: '本轮未执行', 'not-run': '未执行', findings: '发现待处理项', warning: '需复核' })[check.status] || check.status;
  if (check.passed === true || check.ok === true) return '通过';
  if (check.passed === false || check.ok === false) return '未通过';
  return '查看记录';
}
