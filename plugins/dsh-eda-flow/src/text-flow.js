import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FlowError, classify } from './errors.js';
import { hash, readJSON, sameFiles, tree, writeJSON } from './io.js';

const root = fileURLToPath(new URL('../', import.meta.url));
export async function textDefaults(caseId) {
  return { requirements: caseId ? await fs.readFile(path.join(root, 'cases/display-board/default-text.txt'), 'utf8') : '',
    datasheetText: '', constraints: {}, datasheets: [], resources: [], stageNotes: {} };
}

export async function executeText(flow, p, s, signal) {
  flow.prerequisites(p, s.id);
  if (s.id === 6) return flow.open(p.id);
  if (s.id === 1) throw new FlowError('input', '请先在页面确认文字任务与约束。');
  if (!flow.config.allowModelCalls || !flow.ai?.generateText) throw new FlowError('unselected', '本步需要 Harness 当前模型与文字 MCP 接口。输入已保存。');
  if (!String(p.inputs.requirements || '').trim()) throw new FlowError('input', '请填写完整文字需求。');
  flow.invalidate(p, s.id);
  const output = path.join(flow.dir(p.id), 'steps', String(s.id), randomUUID()), projectRoot = path.join(output, 'project');
  await fs.mkdir(output, { recursive: true });
  Object.assign(s, { status: 'running', output, files: [], gaps: [], assumptions: [], questions: [], startedAt: new Date().toISOString(), attempts: (s.attempts || 0) + 1 });
  delete s.outputHash; delete s.error; delete s.errorInfo;
  flow.recordEvent(p, s.id, '执行', `${s.title} · 文字 MCP 第 ${s.attempts} 次执行`, { output });
  await flow.save(p);
  let session, phase = 'input', lastMutation = 0, lastRead = -1, lastCheck = -1, operation = 0, authored = false;
  const records = [], toolRecords = [];
  const record = async value => {
    if (value.event === 'format-retry') {
      flow.phase(p.id, 'model', `模型回复格式修正 · ${value.attempt}/${value.limit}`);
      flow.recordEvent(p, s.id, '回复修正', `模型回复格式修正 · ${value.attempt}/${value.limit}`, { reason: value.reason });
      await flow.save(p);
    }
    if (value.event === 'request') {
      p.modelRequests++;
      flow.phase(p.id, 'model', `模型处理 · 第 ${p.modelRequests} 次请求`);
      flow.recordEvent(p, s.id, 'AI 请求', `文字模型处理 · 第 ${p.modelRequests} 次请求`, { provider: value.provider, model: value.model });
      await flow.save(p);
    }
    records.push({ at: new Date().toISOString(), ...value }); await writeJSON(path.join(output, 'model-log.json'), records);
  };
  try {
    const attachments = (p.uploads || []).map(f => ({ name: f.name, binding: f.binding, status: '未送入模型；请粘贴带来源及页码的正文', readable: false }));
    const request = { inputs: { requirements: p.inputs.requirements, datasheetText: p.inputs.datasheetText || '', constraints: p.inputs.constraints || {}, stageNotes: p.inputs.stageNotes || {} },
      attachments, plan: s.plan, upstream: p.stages.filter(x => x.id < s.id && x.status === 'done').map(x => ({ stage: x.id, summary: x.result?.summary, gaps: x.gaps, assumptions: x.assumptions, parameters: x.result?.parameters, components: x.id < 4 ? x.result?.components : undefined })),
      scope: 'schematic', originalComparison: 'not-available', instruction: '输入正文完整内联；只使用本轮文字、规格书正文和本次生成工程。' };
    for (const key of ['basis','acceptance','power','interfaces','review']) if (p.inputs[key]) request.inputs[key] = p.inputs[key];
    await writeJSON(path.join(output, 'text-input.json'), request);
    const dependencies = Object.fromEntries(p.stages.filter(x => x.id < s.id && x.output && x.status === 'done').map(x => [x.id, x.output]));
    await writeJSON(path.join(output, 'request.json'), { stage: s.id, output, dependencies, mode: 'text-mcp' });
    if (s.id >= 4) {
      if (s.id > 4) {
        const previous = p.stages.filter(x => x.id < s.id && x.id >= 4 && x.status === 'done').at(-1);
        if (!previous?.output) throw new Error('尚无本次流程生成的原理图。');
        const before = await tree(path.join(previous.output, 'project')); // Reject symlinks before copying.
        await fs.cp(path.join(previous.output, 'project'), projectRoot, { recursive: true, errorOnExist: true, force: false });
        if (!sameFiles(before, await tree(projectRoot))) throw new Error('上游工程副本校验失败。');
      }
      session = flow.mcp.open(projectRoot, signal, s.id === 4);
    }
    const invoke = async (name, args) => {
      phase = 'tool'; flow.phase(p.id, phase, `KiCad MCP · ${name}`);
      operation++;
      try {
        const value = await session.invoke(name, args);
        if (name === 'precise_create' || name === 'precise_apply') { lastMutation = operation; if (name === 'precise_apply') authored = true; }
        if (name === 'precise_read') lastRead = operation;
        if (name === 'precise_check_export') lastCheck = operation;
        const event = { at: new Date().toISOString(), name, arguments: args, result: value, ok: true };
        toolRecords.push(event); flow.recordEvent(p, s.id, 'MCP', name, event); await writeJSON(path.join(output, 'tool-log.json'), toolRecords); await flow.save(p);
        return value;
      } catch (error) {
        const event = { at: new Date().toISOString(), name, arguments: args, error: error.message, ok: false };
        toolRecords.push(event); flow.recordEvent(p, s.id, 'MCP', name + ' 返回错误', event); await writeJSON(path.join(output, 'tool-log.json'), toolRecords); await flow.save(p); throw error;
      } finally { phase = 'model'; flow.phase(p.id, phase, '模型核对工具返回'); }
    };
    s.plan = await flow.ai.generateText({ project: { mode: p.mode, scope: p.scope, label: p.label }, stage: { id: s.id, title: s.title }, request,
      tools: session?.tools || [], invoke, record,
      validateFinish: async () => s.id >= 4 && ((!authored && s.id === 4) || lastRead <= lastMutation || lastCheck <= lastMutation)
        ? '尚未完成有效 CAD 建立和修改后的 read/check_export。请调用 MCP 读取实际对象并检查导出；不能仅声称完成。' : null }, signal);
    s.planOrigin = s.plan.provider === 'test-double' || /test[-_ ]?double/i.test(s.plan.model || '') ? 'test-double' : 'live-ai';
    await writeJSON(path.join(output, 'ai-output.json'), s.plan);
    if (s.plan.action === 'question') {
      s.status = 'waiting-input'; s.questions = s.plan.questions; s.gaps = [...s.questions]; s.result = { summary: '等待补充影响正确性的文字要求', questions: s.questions, gaps: s.gaps, assumptions: [], origin: 'text-mcp' };
      await writeJSON(path.join(output, 'result.json'), s.result); s.files = await tree(output); s.outputHash = hash(s.files);
      flow.recordEvent(p, s.id, '待补需求', s.questions.join('\n')); await flow.save(p); return flow.open(p.id);
    }
    phase = 'check'; flow.phase(p.id, phase, '核验实际工程与导出文件');
    let checked, reviewed, view;
    if (s.id >= 4) {
      // Host verification is independent of the model's finish claims, but still uses the same actual MCP service.
      checked = await invoke('precise_check_export', { request_key: 'host-final-' + randomUUID(), formats: ['netlist', 'erc', 'pdf', 'svg', 'bom'] });
      reviewed = await invoke('precise_read', { include_objects: true });
      if (!reviewed.file_matches_model || !reviewed.items?.some(i => i.kind === 'component') || !reviewed.pins?.length) throw new Error('实际工程缺少器件或引脚，不能记为原理图完成。');
      await writeJSON(path.join(output, 'cad-readback.json'), reviewed);
      await flow.runProcess([path.join(root, 'mcp/inspect_netlist.py'), checked.outputs.netlist.path, path.join(output, 'netlist-review.json')], output, signal);
      const netlist = await readJSON(path.join(output, 'netlist-review.json'));
      const components = reviewed.items.filter(i => i.kind === 'component').map((item, id) => {
        const parameters = Object.fromEntries((item.properties || []).map(f => [f.name, f.value]));
        return { id, ref: item.reference, value: parameters.Value ?? item.value ?? item.symbol, footprint: parameters.OriginalFootprint || parameters.Footprint || item.footprint || '',
          code: parameters['物料编码'] || '', description: parameters['物料描述'] || '', mount: parameters['装配类型'] || '', parameters, in_bom: item.in_bom ?? true, on_board: item.on_board ?? true, dnp: item.dnp ?? false,
          pins: reviewed.pins.filter(pin => pin.reference === item.reference).length, source: '本次 MCP 生成及实际 KiCad 网表' };
      });
      const nets = netlist.nets.map((n, id) => ({ id, name: n.name, nodes: n.nodes.map(x => `${x.ref}.${x.pin}`), nc: n.name.startsWith('unconnected-') }));
      const pins = reviewed.pins.map((pin, id) => ({ id, ref: pin.reference, pin: pin.number, name: pin.name, type: pin.type, point: pin.native_at, net: nets.find(n => n.nodes.includes(`${pin.reference}.${pin.number}`))?.name || '' }));
      view = { components, pins, nets, counts: { components: components.length, pins: pins.length, nets: nets.length }, source: 'generated-cad' };
      await writeJSON(path.join(output, 'generated-review.json'), view);
    }
    for (const prior of p.stages.filter(x => x.id < s.id && x.output && x.status === 'done')) if (!sameFiles(prior.files, await tree(prior.output))) throw new Error('执行期间已确认上游文件发生变化，本步不能通过。');
    const ercGaps = checked?.erc?.violation_count ? [`ERC：${checked.erc.by_severity.error} 个错误、${checked.erc.by_severity.warning} 个警告，详见真实工具报告。`] : [];
    s.gaps = [...new Set([...p.stages.filter(x => x.id < s.id).flatMap(x => x.gaps || []).filter(g => !g.startsWith('ERC：')), ...s.plan.gaps, ...ercGaps])];
    s.assumptions = [...new Set([...p.stages.filter(x => x.id < s.id).flatMap(x => x.assumptions || []), ...s.plan.assumptions])];
    const relative = file => path.relative(output, file).replaceAll('\\', '/');
    const files = checked ? Object.entries(checked.outputs).map(([format, f]) => ({ format, path: relative(f.path), sha256: f.sha256, bytes: f.bytes })) : [];
    s.result = { summary: s.plan.summary, gaps: s.gaps, assumptions: s.assumptions, origin: 'text-mcp', files,
      parameters: s.plan.parameters || [], citations: s.plan.citations || [], components: view?.components || s.plan.components || [],
      ...(checked ? { erc: checked.erc, schematicPdf: relative(checked.outputs.pdf.path), previews: [relative(checked.outputs.svg.path)], bom: relative(checked.outputs.bom.path) } : {}),
      checks: [
        ...(checked ? [{ name: 'KiCad 语法/网表', status: 'passed', detail: '实际 KiCad CLI 解析、网表、PDF/SVG 导出已完成。', source: 'tool' },
          { name: 'ERC', status: checked.erc.violation_count ? 'findings' : 'passed', detail: `${checked.erc.by_severity.error} error / ${checked.erc.by_severity.warning} warning`, source: 'tool' }] : []),
        { name: '原工程逐项差异', status: 'not-run', detail: '本流程只有文字输入；未提供独立原工程基准，不宣称原 AD 差异通过。', source: 'scope' },
        { name: 'PCB', status: 'skipped', detail: '本轮未执行布局布线。', source: 'scope' },
        { name: 'Harness 真实模型验收', status: 'pending', detail: '真实宿主模型全流程需在内网另行验收；Codex 演示与模拟模型测试不替代。', source: 'scope' },
      ], liveHarnessValidation: 'pending' };
    await writeJSON(path.join(output, 'result.json'), s.result);
    if (s.id === 7) {
      await writeJSON(path.join(output, 'frozen-evidence.json'), { schemaVersion: 3, inputs: p.inputs, origin: 'text-mcp', scope: 'schematic', modelRequests: p.modelRequests, planOrigin: s.planOrigin,
        sourcePolicy: 'Only inline text and current run; application-level root confinement, not an OS sandbox.', stages: p.stages.map(x => ({ id: x.id, status: x.id === 7 ? 'completed-pending-confirmation' : x.status, confirmation: x.confirmation, outputHash: x.outputHash, planOrigin: x.planOrigin })), checks: s.result.checks });
      await flow.runProcess([path.join(root, 'python/archive.py'), path.join(output, 'request.json')], output, signal);
      s.result.archive = 'frozen-evidence.zip'; await writeJSON(path.join(output, 'result.json'), s.result);
    }
    s.files = await tree(output); s.outputHash = hash(s.files); s.status = 'done'; s.executedPlan = structuredClone(s.plan); s.finishedAt = new Date().toISOString(); delete s.invalidation;
    flow.recordEvent(p, s.id, '完成', s.title + '实际处理完成', { source: s.planOrigin, output, checks: s.result.checks });
    await flow.save(p); return flow.open(p.id);
  } catch (error) {
    s.status = signal?.aborted ? 'cancelled' : 'failed'; s.errorInfo = classify(error, phase, signal); s.error = s.errorInfo.message; s.finishedAt = new Date().toISOString();
    flow.recordEvent(p, s.id, '失败', s.error, s.errorInfo); await flow.save(p); throw error;
  } finally { session?.close(); }
}
