import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { within, hash } from './io.js';
import { storedText } from './record-store.js';
import {schematicTargets} from './schematic-targets.js';
import {reviewAsset} from './engineering-reviews.js';
import { stages, version } from './contracts.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf', '.json': 'application/json; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
export const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
export function routes(service) {
  const checkOrigin = request => {
    const origin = request.headers.get('origin'), host = request.headers.get('host') || new URL(request.url).host;
    if (request.headers.get('sec-fetch-site') === 'cross-site' || origin && new URL(origin).host !== host) throw new Error('不接受跨站操作。');
  };
  return [
    ...[['page', 'index.html'], ['app.js', 'app.js'], ['styles.css', 'styles.css']].map(([name, file]) => ({ name, methods: ['GET'], run: async () => new Response(await fs.readFile(path.join(root, 'client', file)), { headers: { 'content-type': types[path.extname(file)], 'cache-control': 'no-store' } }) })),
    { name: 'bootstrap', methods: ['GET'], run: async () => json({ ok: true, value: { version, stages, workspaceRoot: service.config.workspaceRoot,
      caseReady: true, aiEnabled: service.config.allowModelCalls === true && Boolean(service.ai), model: service.ai?.selection?.() || null, projects: await service.list() } }) },
    { name: 'upload', methods: ['POST'], run: async request => {
      checkOrigin(request); const form = await request.formData();
      const key = form.get('projectId'), next = (service.mutations.get(key) || Promise.resolve()).catch(() => {}).then(() => service.upload({ projectId: key, stage: Number(form.get('stage')), binding: form.get('binding') || '' }, form.getAll('files')));
      service.mutations.set(key, next);
      try { return json({ ok: true, value: await next }); } finally { if (service.mutations.get(key) === next) service.mutations.delete(key); }
    } },
    { name: 'action', methods: ['POST'], run: async request => {
      checkOrigin(request);
      if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('需要 JSON 请求。');
      const raw = await request.text(); if (Buffer.byteLength(raw) > 3 * 1024 * 1024) throw new Error('请求过大。');
      const args = JSON.parse(raw);
      if (args.action === 'open-window') return json({ ok: true, value: await service.openWindow() });
      const mutate = ['review-add','review-apply','review-decide','enable-pcb','answer-issue','update','confirm','rename','adopt','attach','create','chat','execute','replay'].includes(args.action);
      const run = () => service.dispatch(args, request.signal, 'human');
      if (!mutate) return json({ ok: true, value: await run() });
      const key = args.projectId || 'create', previous = service.mutations.get(key) || Promise.resolve(), next = previous.catch(() => {}).then(run);
      service.mutations.set(key, next);
      try { return json({ ok: true, value: await next }); } finally { if (service.mutations.get(key) === next) service.mutations.delete(key); }
    } },
    {name:'schematic-targets',methods:['GET'],run:async request=>{
      const url=new URL(request.url),project=await service.load(url.searchParams.get('projectId'));
      return json({ok:true,value:await schematicTargets(service,project,Number(url.searchParams.get('stage')),url.searchParams.get('path'),request.signal)});
    }},
    {name:'review-asset',methods:['GET'],run:async request=>{
      const {data,extension,name}=await reviewAsset(service,Object.fromEntries(new URL(request.url).searchParams));
      return new Response(data,{headers:{'content-type':types[extension]||'application/octet-stream','cache-control':'no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",...(extension.startsWith('.kicad_')?{'content-disposition':`attachment; filename="${name.replace(/[^\w.-]/g,'_')}"`}:{})}});
    }},
    { name: 'project-download', methods: ['GET'], run: async request => {
      checkOrigin(request);
      const url = new URL(request.url), project = await service.load(url.searchParams.get('projectId'));
      const step = service.stage(project, url.searchParams.get('stage'));
      if (step.status !== 'done' || !step.output) throw new Error('请先生成有效原理图。');
      const schematic = (step.files || step.result?.files || []).find(f => /\.kicad_sch$/i.test(f.path));
      if (!schematic) throw new Error('本步没有可下载的工程。');
      const directory = await within(step.output, path.dirname(schematic.path));
      const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'eda-project-download-'));
      try {
        const archive = path.join(temporary, 'project.zip');
        await service.runProcess([path.join(root, 'python/project_bundle.py'), directory, archive], temporary, request.signal);
        return new Response(await fs.readFile(archive), { headers: {
          'content-type': 'application/zip', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
          'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(`${project.label || 'Circuit'}-工程.zip`),
        } });
      } finally { await fs.rm(temporary, { recursive: true, force: true }); }
    } },
    { name: 'asset', methods: ['GET'], run: async request => {
      const url = new URL(request.url); const project = await service.load(url.searchParams.get('projectId'));
      const step = service.stage(project, url.searchParams.get('stage'));
      if (!step.output) throw new Error('本步还未产生文件。');
      const file = await within(step.output, url.searchParams.get('path')); const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('文件不可读取或超过 100 MB。');
      const ext = path.extname(file).toLowerCase(); const download = url.searchParams.has('download') || !types[ext];
      const record = ['.json', '.jsonl'].includes(ext) ? storedText(file) : undefined;
      return new Response(record === undefined ? await fs.readFile(file) : record, { headers: { 'content-type': types[ext] || 'application/octet-stream',
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
        // User/model generated HTML and SVG must never execute scripts in the host origin.
        'content-security-policy': "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'",
        ...(download ? { 'content-disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(file)) } : {}) } });
    } },
    { name: 'attachment', methods: ['GET'], run: async request => {
      const url=new URL(request.url), project=await service.load(url.searchParams.get('projectId'));
      const entry=project.uploads.find(x=>x.id===url.searchParams.get('id'));
      if(!entry?.extraction || !entry.sha256) throw new Error('没有可读取的资料快照。');
      const file=await within(service.dir(project.id),entry.path), bytes=await fs.readFile(file);
      if(hash(bytes)!==entry.sha256) throw new Error('资料快照变化，请重新添加。');
      return new Response(bytes,{headers:{'content-type':path.extname(entry.name).toLowerCase()==='.docx'?'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'application/pdf','cache-control':'no-store','x-content-type-options':'nosniff',
        'content-security-policy':"sandbox; default-src 'none'",
        'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(entry.name)}});
    } },
    { name: 'input-asset', methods: ['GET'], run: async request => {
      const url = new URL(request.url); const project = await service.load(url.searchParams.get('projectId'));
      if (!project.inputsBundle) throw new Error('当前项目没有默认资料。');
      const file = await within(project.inputsBundle, url.searchParams.get('path'));
      const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 100 * 1024 * 1024) throw new Error('文件不可读取。');
      return new Response(await fs.readFile(file), { headers: { 'content-type': 'application/octet-stream', 'x-content-type-options':'nosniff', 'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(path.basename(file)) } });
    } },
  ];
}
