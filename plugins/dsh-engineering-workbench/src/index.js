import Schema from '@deepseek-ai/schemastery';
import fs from 'node:fs/promises';
import { Workbench } from './service.js';
import { Actions, LABELS } from './actions.js';
import { randomUUID } from 'node:crypto';
import { EngineeringTasks } from './engineering/tasks.js';
import { createDshVision } from './engineering/vision.js';
import { Materials } from './materials.js';
import { RestorationRuns } from './restoration/service.js';
import { registerRestoration } from './restoration/index.js';
import { WorkbenchWindow, webResource } from './window.js';

const buildInfo = JSON.parse(await fs.readFile(new URL('./build.json', import.meta.url), 'utf8'));

export const name = 'engineering-workbench';
export const inject = ['connection', 'tools'];
export const Config = Schema.object(Object.fromEntries([
  'catalogPath', 'catalogV1Path', 'projectFile', 'currentSchematic', 'pcbPath', 'workspaceRoot', 'workDirectory', 'kicadCli', 'kicadPython', 'syncWorkDirectory', 'engineeringPython', 'happyRoot', 'materialSourcesPath',
].map(key => [key, Schema.string().default('')])));
const watched = /^(megmeet_|pcb_|schematic_|kicad_workflow_|mcp__kicad__)/;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });

export function apply(ctx, config) {
  const service = new Workbench(config);
  const engineering = new EngineeringTasks(service, createDshVision(ctx));
  const restoration = new RestorationRuns(config, engineering);
  registerRestoration(ctx, restoration);
  const controller = new AbortController();
  ctx.on('dispose', () => controller.abort());
  ctx.on('dispose', () => Promise.allSettled([engineering.manuals.dispose(), engineering.references.dispose()]));
  const executeTool = async (name, args, signal) => {
    const result = await ctx.tools.execute({ name, arguments: args, callId: `engineering-workbench:${randomUUID()}`, signal });
    if (result.isError) {
      const detail = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
      throw new Error(detail || result.value?.message || '插件执行失败。');
    }
    return result.value ?? result.structuredContent ?? result;
  };
  const actions = new Actions(service, executeTool);
  const materials = new Materials(service, { schemas: () => ctx.tools.schemas(), execute: executeTool });
  ctx.on('tools/execute', async (exec, next) => {
    if (!watched.test(exec.name) || exec.callId?.startsWith('engineering-workbench:')) return next();
    const task = service.record(LABELS[exec.name] || exec.name, 'chat');
    try { const result = await next(); service.finish(task, result.isError ? new Error('工具返回错误，请查看原对话中的详情。') : undefined); return result; }
    catch (error) { service.finish(task, error); throw error; }
  });
  const routes = [];
  const workbenchWindow = new WorkbenchWindow(config, routes);
  ctx.on('dispose', () => workbenchWindow.close());
  const route = (suffix, methods, fn) => {
    const definition = {
    path: `/api/engineering-workbench/${suffix}`, methods, requestBody: 'buffered',
    fetch: async request => {
      try { return await fn(request); }
      catch (error) { return json({ ok: false, error: String(error.message ?? error).slice(0, 500) }, error.status ?? 400); }
    },
    };
    routes.push(definition);
    return ctx.connection.fetch.register(definition);
  };
  const input = async request => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('需要 JSON 参数。');
    const origin = request.headers.get('origin');
    // DSH normalizes Request.url to dsh.internal; the authenticated carrier retains Host.
    const authority = request.headers.get('host') || new URL(request.url).host;
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== authority)) throw new Error('不接受跨站操作。');
    const text = await request.text(); if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('请求过大。'); return JSON.parse(text);
  };
  for (const name of ['page', 'app.js', 'styles.css']) route(name, ['GET'], () => webResource(name));
  route('open-window', ['POST'], async r => {
    await input(r);
    return json({ ok: true, value: await workbenchWindow.open() });
  });
  route('bootstrap', ['GET'], async () => json({ ok: true, value: { apiVersion: 2, ...buildInfo, currentSchematic: config.currentSchematic, pcbPath: config.pcbPath, workspaceRoot: config.workspaceRoot, projectFile: config.projectFile } }));
  const executeTask = async (a, signal) => ['list', 'open'].includes(a.action) ? engineering.dispatch(a, signal) : service.job(`engineering-${a.taskId || randomUUID()}`, `工程任务 · ${{create:'读取工程',page:'读取页面',extract:'提取资料',evidence:'保存证据',mapping:'确认对应',calibrate:'校准图面',compare:'比较',review:'评审',prepare:'生成候选',edit:'调整候选',undo:'撤销',redo:'重做',verify:'验证候选',export:'导出报告',apply:'保存',rollback:'回退'}[a.action] || a.action}`, [], () => engineering.dispatch(a, signal));
  route('engineering', ['POST'], async r => json({ ok: true, value: await executeTask(await input(r), AbortSignal.any([r.signal, controller.signal])) }));
  route('restoration', ['POST'], async r => {
    const value = await restoration.dispatch(await input(r), AbortSignal.any([r.signal, controller.signal]), 'human');
    if (value?.validation) {
      value.artifacts = [{ key: 'report', name: '独立核验报告.json', url: await service.asset(value.validation.report, 'application/json') }];
      const pdf = value.validation.report.replace(/independent-verification\.json$/, 'schematic.pdf');
      if (await fs.stat(pdf).then(s => s.isFile(), () => false)) value.artifacts.push({ key: 'pdf', name: '原理图检查预览.pdf', url: await service.asset(pdf, 'application/pdf') });
    }
    return json({ ok: true, value });
  });
  route('references', ['POST'], async r => json({ ok: true, value: await engineering.references.dispatch(await input(r), AbortSignal.any([r.signal, controller.signal])) }));
  route('manuals', ['POST'], async r => json({ ok: true, value: await engineering.manuals.dispatch(await input(r), AbortSignal.any([r.signal, controller.signal])) }));
  route('materials', ['GET', 'POST'], async r => {
    if (r.method === 'GET') return json({ ok: true, value: await materials.list() });
    const a = await input(r), signal = AbortSignal.any([r.signal, controller.signal]);
    if (!['search', 'read', 'create-task'].includes(a.action)) throw new Error('不支持的资料操作。');
    if (a.action === 'search') return json({ ok: true, value: await materials.search(a, signal) });
    const record = await materials.read(a, signal);
    if (a.action === 'read') return json({ ok: true, value: record });
    // Only this host-owned route can attach verified provenance to a database import.
    const task = await executeTask({ action: 'create', kind: 'datasheet', left: record.filePath, label: record.title }, signal);
    const stored = await engineering.load(task.id); stored.materialSource = record; await engineering.persist(stored);
    return json({ ok: true, value: await engineering.present(stored) });
  });
  route('material-sources', ['GET', 'POST'], async r => {
    if (r.method === 'GET') return json({ ok: true, value: await materials.settings() });
    return json({ ok: true, value: await materials.configure(await input(r)) });
  });
  ctx.tools.register({
    name: 'engineering_task', description: '独立读手册、原理图评审、PCB 评审、两图对比及向目标对齐。使用各自 taskId。请求 JSON action 为 create/list/open/page/extract/evidence/mapping/compare/review/prepare/edit/undo/redo/verify/export。覆盖原工程仅在工作台查看变化并确认后执行。图片条目保留不确定性；不能宣称完整功能等价。',
    parameters: { type: 'object', additionalProperties: false, required: ['request'], properties: { request: { type: 'string', description: 'JSON 请求。create: {action,kind,left,right?,outputDirectory?}；其他操作: {action,taskId,...}。kind: datasheet/schematic-review/pcb-review/compare/align。edit 需 revision 和 operations。' } } },
    output: { schema: {}, render: (_a, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    execute: async (args, exec) => { if (typeof args?.request !== 'string' || args.request.length > 4 * 1024 * 1024 || Object.keys(args).length !== 1) throw new Error('需要 JSON 请求文本。'); const a = JSON.parse(args.request); if (['confirmation', 'apply', 'rollback'].includes(a.action)) throw new Error('请在工作台查看实际变化并确认保存或回退。'); if (a.action === 'evidence') a.reviewed = false; return executeTask(a, exec.signal); },
  });
  route('action', ['POST'], async r => json({ ok: true, value: await actions.call(await input(r), AbortSignal.any([r.signal, controller.signal])) }));
  route('confirmation', ['POST'], async r => json({ ok: true, value: await actions.confirmation(await input(r)) }));
  route('files', ['GET'], async r => json({ ok: true, value: await actions.files(new URL(r.url).searchParams.get('directory') || '') }));
  route('tasks', ['GET'], async () => json({ ok: true, value: await actions.tasks() }));
  route('task', ['GET'], async r => json({ ok: true, value: await actions.task(new URL(r.url).searchParams.get('id')) }));
  route('refresh-project', ['POST'], async r => {
    const value = await input(r); if (!value || Array.isArray(value) || Object.keys(value).length) throw new Error('工程更新不接收文件路径。');
    return json({ ok: true, value: await service.refreshProject(AbortSignal.any([r.signal, controller.signal])) });
  });
  route('status', ['GET'], async () => json({ ok: true, value: { ...service.status(), tools: Object.fromEntries(['megmeet_', 'pcb_', 'schematic_', 'kicad_workflow_', 'mcp__kicad__'].map(prefix => [prefix, ctx.tools.schemas().filter(t => t.name.startsWith(prefix)).length])) } }));
  route('select', ['POST'], async r => json({ ok: true, value: await service.select(await input(r)) }));
  route('selection-report', ['POST'], async r => json({ ok: true, value: await service.selectionReport(await input(r)) }));
  route('board', ['POST'], async r => {
    const value = await input(r); if (!value || Object.keys(value).length) throw new Error('电路检查不接收文件路径。');
    return json({ ok: true, value: await service.review(AbortSignal.any([r.signal, controller.signal])) });
  });
  route('compare', ['POST'], async r => json({ ok: true, value: await service.compare(await input(r), AbortSignal.any([r.signal, controller.signal])) }));
  route('file', ['GET'], async r => {
    const asset = await service.readAsset(new URL(r.url).searchParams.get('id'));
    return new Response(asset.buffer, { headers: { 'content-type': asset.type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': asset.policy || "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'", 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}` } });
  });
}
