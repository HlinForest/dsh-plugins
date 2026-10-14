import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const prefix = '/api/engineering-workbench/';
const json = (value, status = 200) => Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
const publicNames = new Set(['page', 'app.js', 'styles.css']);
export async function webResource(name) {
  const file = { page: 'page.html', 'app.js': 'app.js', 'styles.css': 'styles.css' }[name];
  if (!file) return json({ ok: false }, 404);
  return new Response(await fs.readFile(new URL('../web/' + file, import.meta.url)), { headers: {
    'content-type': { page: 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8' }[name],
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
    ...(name === 'page' ? { 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" } : {}),
  } });
}

// Only the workbench routes share this service. No Harness model/login API is proxied.
export class WorkbenchWindow {
  constructor(config, routes, launch = launchDesktop) {
    this.config = config; this.routes = routes; this.launch = launch;
    this.key = randomBytes(32).toString('hex'); this.cookieName = 'engineering_workbench_' + randomBytes(8).toString('hex');
  }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.startServer();
    try { return await this.ready; } catch (error) { this.ready = null; throw error; }
  }
  async startServer() {
    if (!this.config.workDirectory) throw new Error('请先配置工程工作台的工作目录。');
    this.server = http.createServer(async (req, res) => {
      const send = async response => { res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); };
      try {
        if (req.headers.host !== `127.0.0.1:${this.port}`) return send(json({ ok: false, error: 'Invalid host' }, 403));
        if (req.headers.origin && req.headers.origin !== this.origin || req.headers['sec-fetch-site'] === 'cross-site') return send(json({ ok: false, error: '不接受跨站操作。' }, 403));
        const url = new URL(req.url, this.origin);
        const name = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : '';
        const cookie = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(this.cookieName + '='))?.slice(this.cookieName.length + 1) || '';
        const valid = /^[a-f0-9]{64}$/.test(cookie) && timingSafeEqual(Buffer.from(cookie), Buffer.from(this.key));
        if (!publicNames.has(name) && !valid) return send(json({ ok: false, error: '请从 Harness 重新打开工程工作台。' }, 401));
        // Window launch stays on the authenticated Harness carrier, not the local renderer.
        if (name === 'open-window') return send(json({ ok: false }, 404));
        if (name === 'window-heartbeat' && req.method === 'GET') return send(json({ ok: true }));
        const route = this.routes.find(r => r.path === url.pathname && r.methods.includes(req.method));
        if (!route) return send(json({ ok: false, error: 'Not found' }, 404));
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > 4 * 1024 * 1024) return send(json({ ok: false, error: '请求过大。' }, 413)); chunks.push(chunk); }
        const controller = new AbortController();
        const abort = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', abort);
        try { await send(await route.fetch(new Request(url, { method: req.method, headers: req.headers, signal: controller.signal,
          ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) }))); }
        finally { res.off('close', abort); }
      } catch (error) { if (!res.headersSent) await send(json({ ok: false, error: String(error.message).slice(0, 500) }, 400)); }
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    this.port = this.server.address().port; this.origin = `http://127.0.0.1:${this.port}`;
    this.connectionFile = path.join(this.config.workDirectory, 'workbench-window-session.json');
    try {
      await fs.mkdir(this.config.workDirectory, { recursive: true });
      await fs.writeFile(this.connectionFile, JSON.stringify({ port: this.port, key: this.key, cookieName: this.cookieName }), { mode: 0o600 });
    } catch (error) { await this.close(); throw error; }
    return this.origin;
  }
  async open() {
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const root = this.config.workDirectory;
      const candidates = root ? ['desktop-runtime/electron.exe', 'desktop-runtime/node_modules/electron/dist/electron.exe'].map(p => path.join(root, p)) : [];
      let runtime;
      if (process.platform === 'win32') for (const candidate of candidates) if (await fs.stat(candidate).then(s => s.isFile(), () => false)) { runtime = candidate; break; }
      if (!runtime) return { mode: 'web', url: prefix + 'page' };
      await this.start();
      await this.launch({ runtime, connectionFile: this.connectionFile, directory: path.join(root, 'workbench-window-desktop') });
      return { mode: 'desktop' };
    })();
    try { return await this.opening; } finally { this.opening = null; }
  }
  async close() {
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    this.ready = null;
  }
}
async function launchDesktop({ runtime, connectionFile, directory }) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const request = randomBytes(12).toString('hex');
  const child = spawn(runtime, [fileURLToPath(new URL('../desktop/main.cjs', import.meta.url)),
    '--workbench-connection=' + connectionFile, '--workbench-profile=' + directory, '--workbench-request=' + request],
  { env, detached: true, windowsHide: true, stdio: 'ignore' });
  let failure;
  child.on('error', e => { failure = e; }); child.unref();
  for (let attempt = 0; attempt < 100; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 200));
    if (failure) throw failure;
    const state = await fs.readFile(path.join(directory, 'window-state.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (state?.request === request && state.ready) return;
    if (state?.request === request && state.failed) throw new Error('工程工作台窗口启动失败，请检查窗口运行记录。');
  }
  throw new Error('工程工作台窗口未在 20 秒内就绪，请重试。');
}
