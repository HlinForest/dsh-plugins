import Schema from '@deepseek-ai/schemastery';
import { Workbench } from './service.js';
import { Actions, LABELS } from './actions.js';
import { randomUUID } from 'node:crypto';

export const name = 'engineering-workbench';
export const inject = ['connection', 'tools'];
export const Config = Schema.object(Object.fromEntries([
  'catalogPath', 'catalogV1Path', 'projectFile', 'currentSchematic', 'pcbPath', 'workspaceRoot', 'workDirectory', 'kicadCli', 'syncWorkDirectory',
].map(key => [key, Schema.string().default('')])));
const watched = /^(megmeet_|pcb_|schematic_|kicad_workflow_|mcp__kicad__)/;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });

export function apply(ctx, config) {
  const service = new Workbench(config);
  const controller = new AbortController();
  ctx.on('dispose', () => controller.abort());
  const actions = new Actions(service, async (name, args, signal) => {
    const result = await ctx.tools.execute({ name, arguments: args, callId: `engineering-workbench:${randomUUID()}`, signal });
    if (result.isError) {
      const detail = result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
      throw new Error(detail || result.value?.message || '插件执行失败。');
    }
    return result.value;
  });
  ctx.on('tools/execute', async (exec, next) => {
    if (!watched.test(exec.name) || exec.callId?.startsWith('engineering-workbench:')) return next();
    const task = service.record(LABELS[exec.name] || exec.name, 'chat');
    try { const result = await next(); service.finish(task, result.isError ? new Error('工具返回错误，请查看原对话中的详情。') : undefined); return result; }
    catch (error) { service.finish(task, error); throw error; }
  });
  const route = (suffix, methods, fn) => ctx.connection.fetch.register({
    path: `/api/engineering-workbench/${suffix}`, methods, requestBody: 'buffered',
    fetch: async request => {
      try { return await fn(request); }
      catch (error) { return json({ ok: false, error: String(error.message ?? error).slice(0, 500) }, error.status ?? 400); }
    },
  });
  const input = async request => {
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('需要 JSON 参数。');
    const origin = request.headers.get('origin');
    // DSH normalizes Request.url to dsh.internal; the authenticated carrier retains Host.
    const authority = request.headers.get('host') || new URL(request.url).host;
    if (request.headers.get('sec-fetch-site') === 'cross-site' || (origin && new URL(origin).host !== authority)) throw new Error('不接受跨站操作。');
    const text = await request.text(); if (Buffer.byteLength(text) > 4 * 1024 * 1024) throw new Error('请求过大。'); return JSON.parse(text);
  };
  route('bootstrap', ['GET'], async () => json({ ok: true, value: { currentSchematic: config.currentSchematic, workspaceRoot: config.workspaceRoot, projectFile: config.projectFile } }));
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
