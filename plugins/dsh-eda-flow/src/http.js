import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { within } from './io.js';
import { stages } from './contracts.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export function routes(service) {
  return [
    ...[['page', 'index.html'], ['app.js', 'app.js'], ['styles.css', 'styles.css']].map(([name, file]) => ({ name, methods: ['GET'], run: async () => new Response(await fs.readFile(path.join(root, 'client', file)), { headers: { 'content-type': types[path.extname(file)], 'cache-control': 'no-store' } }) })),
    { name: 'bootstrap', methods: ['GET'], run: async () => json({ ok: true, value: { version: '0.1.0', stages, workspaceRoot: service.config.workspaceRoot,
      caseReady: Boolean(service.config.caseInputDirectory), aiEnabled: service.config.allowModelCalls === true, projects: await service.list() } }) },
    { name: 'action', methods: ['POST'], run: async request => {
      const origin = request.headers.get('origin'); const host = request.headers.get('host') || new URL(request.url).host;
      if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && new URL(origin).host !== host) throw new Error('不接受跨站操作。');
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('需要 JSON 请求。');
      const raw = await request.text(); if (Buffer.byteLength(raw) > 3 * 1024 * 1024) throw new Error('请求过大。');
      return json({ ok: true, value: await service.dispatch(JSON.parse(raw), request.signal, 'human') });
    } },
    { name: 'asset', methods: ['GET'], run: async request => {
      const url = new URL(request.url); const project = await service.load(url.searchParams.get('projectId'));
      const step = service.stage(project, url.searchParams.get('stage'));
      if (!step.output) throw new Error('本步还未产生文件。');
      const file = await within(step.output, url.searchParams.get('path')); const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('文件不可读取或超过 100 MB。');
      const ext = path.extname(file).toLowerCase(); const download = url.searchParams.has('download') || !types[ext];
      return new Response(await fs.readFile(file), { headers: { 'content-type': types[ext] || 'application/octet-stream',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        // User/model generated HTML and SVG must never execute scripts in the host origin.
        'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        ...(download ? { 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file)) } : {}) } });
    } },
  ];
}
