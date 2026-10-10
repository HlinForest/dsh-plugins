import Schema from '@deepseek-ai/schemastery';
import { Workbench } from './service.js';

export const name = 'engineering-workbench';
export const inject = ['connection', 'tools'];
export const Config = Schema.object(Object.fromEntries([
  'catalogPath', 'catalogV1Path', 'projectFile', 'currentSchematic', 'pcbPath', 'workspaceRoot', 'workDirectory', 'kicadCli',
].map(key => [key, Schema.string().default('')])));
const watched = /^(megmeet_|pcb_|schematic_|kicad_workflow_|mcp__kicad__)/;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, no-store' } });

export function apply(ctx, config) {
  const service = new Workbench(config);
  const controller = new AbortController();
  ctx.on('dispose', () => controller.abort());
  ctx.on('tools/execute', async (exec, next) => {
    if (!watched.test(exec.name)) return next();
    const task = service.record(exec.name, 'chat');
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
    const text = await request.text(); if (text.length > 4096) throw new Error('请求过大。'); return JSON.parse(text);
  };
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
    return new Response(asset.buffer, { headers: { 'content-type': asset.type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: 'self'", 'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(asset.name)}` } });
  });
}
