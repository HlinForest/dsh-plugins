import test from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { appendQuestionAnswer, checkStatus, generatedPreviewFiles, textInputRecord } from './textFlow.js';

const frontend = path.dirname(fileURLToPath(import.meta.url));
const compiled = await build({
  stdin: { contents: `import React from 'react'; import {renderToStaticMarkup} from 'react-dom/server';
    import {TextFlowContent, TextInputGuide, TextInputModal, Questions} from './TextFlow.jsx';
    export {fieldsOf} from './api.js';
    const components = {TextFlowContent, TextInputGuide, TextInputModal, Questions};
    export const render = (name, props) => renderToStaticMarkup(React.createElement(components[name], props));`,
    loader: 'jsx', resolveDir: frontend, sourcefile: 'text-flow-test-entry.jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
});
const compiledModule = new Module(path.join(frontend, 'text-flow-test-bundle.cjs'));
compiledModule.filename = path.join(frontend, 'text-flow-test-bundle.cjs');
compiledModule.paths = Module._nodeModulePaths(frontend);
compiledModule._compile(compiled.outputFiles[0].text, compiledModule.filename);
const { render, fieldsOf } = compiledModule.exports;
const project = {
  id: 'sample', name: '显示板', mode: 'text-mcp', scope: 'schematic', template: true,
  fields: { requirements: '完整任务书：U1 引脚 1 接 DIN；坐标 12.7000 mm。', datasheetText: 'TM1616 V2.1，第 3 页：引脚 1 为 DIN 输入。' },
  uploads: [], stages: Array.from({ length: 7 }, (_, i) => ({ id: i + 1, title: `步骤 ${i + 1}`, status: i === 5 ? 'skipped' : 'pending', gaps: [], assumptions: [] })),
};
const props = {
  p: project, data: { components: [], pins: [], nets: [] }, state: project.stages[0], tab: 0,
  field() {}, notes: () => null, ct: () => null, nets: () => null, preview: () => null,
  imageFile: () => null, detail() {}, resultFiles: () => null, download() {}, go() {}, openUpload() {},
};

test('new mode preserves saved text without legacy PCB default fields', () => {
  const fields = fieldsOf({ mode: 'text-mcp', caseId: 'display-board', inputs: project.fields });
  assert.equal(fields.requirements, project.fields.requirements);
  assert.equal(fields.datasheetText, project.fields.datasheetText);
  assert.equal(fields.routing, '');
  assert.equal(fields.cadLayers, '');
  assert.equal(fields.acceptance, '');
  const legacy = fieldsOf({ mode: 'design', caseId: 'display-board', inputs: {} });
  assert.equal(legacy.routing, '背面 B.Cu');
});

test('full text remains editable and the modal exposes the complete input', () => {
  const task = render('TextFlowContent', { ...props, stage: 1 });
  assert.match(task, /完整纯文字任务书/);
  assert.match(task, /U1 引脚 1 接 DIN；坐标 12.7000 mm/);
  assert.match(task, /<textarea/);
  const input = render('TextInputModal', { project, download() {}, notify() {}, onEdit() {} });
  assert.match(input, /复制完整正文/);
  assert.match(input, /下载文字/);
  assert.match(input, /TM1616 V2.1，第 3 页/);
  assert.equal(textInputRecord(project), `${project.fields.requirements}\n\n【规格书正文与来源】\n${project.fields.datasheetText}`);
});

test('complete text preview and export include every visible engineering field and public answers', () => {
  const complete = {
    ...project,
    fields: { ...project.fields, power: '5 V 供电', interfaces: 'DISP 引脚 6 接 DIN', mount: 'C2 为 0603', rules: '坐标误差不超过 0.001 mm', acceptance: '逐引脚核对 NC', basis: '以已公开任务书为依据', review: '工程师确认保留原装配状态' },
    inputs: { stageNotes: { 2: '已保存的来源补充', 4: '旧的第四步补充' } },
    notes: { 3: '【文字问答】\n问题：D1 型号？\n工程师回答：IRM-3638M3-X', 4: '第四步最新未保存修改' },
  };
  const text = textInputRecord(complete);
  for (const value of Object.values(complete.fields)) assert.ok(text.includes(value), `missing field: ${value}`);
  assert.match(text, /已保存的来源补充/);
  assert.match(text, /工程师回答：IRM-3638M3-X/);
  assert.match(text, /第四步最新未保存修改/);
  assert.doesNotMatch(text, /旧的第四步补充/);
  assert.ok(text.indexOf('第 2 步') < text.indexOf('第 3 步'));
  const modal = render('TextInputModal', { project: complete, download() {}, notify() {}, onEdit() {} });
  assert.match(modal, /工程师确认保留原装配状态/);
  assert.match(modal, /第四步最新未保存修改/);
});

test('raw saved project maps constraints and stageNotes while cleared draft fields stay cleared', () => {
  const saved = { inputs: { requirements: '任务正文', power: '旧供电要求', constraints: { packagePolicy: '原装配约束', rulePolicy: '原理图规则' }, stageNotes: { 1: '保存的问答' } } };
  const record = textInputRecord(saved);
  assert.match(record, /【封装与装配要求】\n原装配约束/);
  assert.match(record, /【原理图设计约束】\n原理图规则/);
  assert.match(record, /保存的问答/);
  const draft = textInputRecord({ ...saved, fields: { power: '' }, notes: { 1: '' } });
  assert.doesNotMatch(draft, /旧供电要求|保存的问答/);
  assert.match(draft, /任务正文/);
});

test('unreadable attachments do not replace the datasheet text input', () => {
  const html = render('TextFlowContent', { ...props, stage: 3, tab: 1 });
  assert.match(html, /粘贴规格书正文/);
  assert.match(html, /TM1616 V2.1，第 3 页/);
  assert.match(html, /附件不可读时可直接使用/);
});

test('waiting questions need an explicit answer and stay separate from execution', () => {
  const questions = ['请确认 D1 的准确型号。'];
  const html = render('Questions', { state: { status: 'waiting-input', questions }, busy: false, onAnswer() {} });
  assert.match(html, /请确认 D1 的准确型号/);
  assert.match(html, /保存回答到本步输入/);
  assert.match(html, /点击执行按钮后模型才继续处理/);
  assert.throws(() => appendQuestionAnswer('', questions, '   '), /先填写/);
  const answer = appendQuestionAnswer('已有要求', questions, 'IRM-3638M3-X', '2026-10-15T10:00:00Z');
  assert.match(answer, /^已有要求/);
  assert.match(answer, /问题 1：请确认 D1 的准确型号/);
  assert.match(answer, /工程师回答：IRM-3638M3-X/);
});

test('PCB page shows skipped scope with navigation and no generation action', () => {
  const html = render('TextFlowContent', { ...props, stage: 6, state: project.stages[5] });
  assert.match(html, /PCB 本轮未执行/);
  assert.match(html, /进入核验与交付/);
  assert.doesNotMatch(html, /生成 PCB|已完成|已确认/);
});

test('delivery displays actual pending verification and never offers legacy replay', () => {
  const overview = render('TextFlowContent', { ...props, stage: 7, state: { status: 'done', result: { liveHarnessValidation: 'pending', checks: [{ name: 'ERC', status: 'findings', detail: '0 error / 1 warning' }, { name: '原工程逐项差异', status: 'not-run', detail: '未提供独立原工程基准' }] } } });
  assert.match(overview, /Harness 真实模型验收：待验证/);
  assert.match(overview, /0 error \/ 1 warning/);
  assert.match(overview, /发现待处理项/);
  assert.doesNotMatch(overview, /内容一致/);
  const delivery = render('TextFlowContent', { ...props, stage: 7, tab: 2 });
  assert.doesNotMatch(delivery, /空目录重放/);
  assert.match(delivery, /另建空白项目/);
  assert.equal(checkStatus({ status: 'not-run' }), '未执行');
});

test('stale schematic previews cannot be shown as current generated output', () => {
  const files = generatedPreviewFiles({ stages: [
    { id: 4, status: 'stale', files: [{ path: 'project/exports/old.svg' }], result: { previews: ['project/exports/old.svg'] } },
    { id: 5, status: 'done', files: [{ path: 'project/exports/current.svg' }], result: { previews: ['project/exports/current.svg'] } },
  ] });
  assert.deepEqual(files.map(f => [f.path, f.stage]), [['project/exports/current.svg', 5]]);
});

test('text input guide does not imply old PCB objects were loaded', () => {
  const html = render('TextInputGuide', { project, stage: 2, onFiles() {} });
  assert.match(html, /显示板纯文字任务书/);
  assert.doesNotMatch(html, /已载入提取数据|已载入 PCB|完整连接.*已载入/);
});
