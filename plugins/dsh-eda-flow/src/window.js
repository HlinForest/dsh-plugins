import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { routes, json } from './http.js';

// Only this plugin's routes are exposed. Model credentials never leave Harness.
export class DesignWindow {
  constructor(flow, launch = launchWindow) { this.flow = flow; this.launch = launch; this.key = randomBytes(32).toString('hex'); this.cookieName = 'eda_flow_' + randomBytes(8).toString('hex'); }
  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const stateFile = path.join(this.flow.config.workDirectory || this.flow.config.workspaceRoot, 'design-window-session.json');
      const previous = await fs.readFile(stateFile, 'utf8').then(JSON.parse).catch(() => null);
      if (/^[a-f0-9]{64}$/.test(previous?.key || '') && /^eda_flow_[a-f0-9]+$/.test(previous?.cookieName || '')) { this.key = previous.key; this.cookieName = previous.cookieName; }
      const handlers = routes(this.flow);
      this.server = http.createServer(async (req, res) => {
        const send = async response => { res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); };
        try {
          if (req.headers.host !== `127.0.0.1:${this.port}`) return send(json({ ok: false, error: 'Invalid host' }, 403));
          const url = new URL(req.url, this.origin), origin = req.headers.origin;
          if (origin && origin !== this.origin || req.headers['sec-fetch-site'] === 'cross-site') return send(json({ ok: false, error: '不接受跨站请求。' }, 403));
          const bytes = []; let size = 0;
          for await (const chunk of req) { size += chunk.length; if (size > 55 * 1024 * 1024) throw new Error('请求过大。'); bytes.push(chunk); }
          const body = Buffer.concat(bytes);
          if (url.pathname === '/api/eda-flow/session' && req.method === 'POST') {
            const value = JSON.parse(body.toString()).key;
            if (typeof value !== 'string' || value.length !== this.key.length || !timingSafeEqual(Buffer.from(value), Buffer.from(this.key))) return send(json({ ok: false }, 403));
            return send(new Response('{}', { headers: { 'content-type': 'application/json', 'set-cookie': `${this.cookieName}=${this.key}; HttpOnly; SameSite=Strict; Path=/`, 'cache-control': 'no-store' } }));
          }
          const publicFiles = ['/api/eda-flow/page', '/api/eda-flow/app.js', '/api/eda-flow/styles.css'];
          if (!publicFiles.includes(url.pathname) && !(req.headers.cookie || '').split(';').some(c => c.trim() === `${this.cookieName}=${this.key}`)) return send(json({ ok: false, error: '请从 Harness 的电路设计入口重新打开窗口。' }, 401));
          const route = handlers.find(r => '/api/eda-flow/' + r.name === url.pathname && r.methods.includes(req.method));
          if (!route) return send(json({ ok: false, error: 'Not found' }, 404));
          await send(await route.run(new Request(url, { method: req.method, headers: req.headers, ...(['GET','HEAD'].includes(req.method) ? {} : { body }) })));
        } catch (error) { await send(json({ ok: false, error: error.message, errorInfo: { code: error.code, details: error.details } }, 400)); }
      });
      await new Promise((resolve, reject) => { const failed = e => { if (e.code === 'EADDRINUSE') { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); } else reject(e); }; this.server.once('error', failed); this.server.listen(previous?.port || 0, '127.0.0.1', resolve); });
      this.port = this.server.address().port; this.origin = `http://127.0.0.1:${this.port}`;
      await fs.mkdir(path.dirname(stateFile), { recursive: true }); await fs.writeFile(stateFile, JSON.stringify({ port: this.port, key: this.key, cookieName: this.cookieName }), { mode: 0o600 });
      return this.origin;
    })();
    try { return await this.ready; } catch (e) { this.ready = null; throw e; }
  }
  async open() {
    await this.start();
    await this.launch({ url: `${this.origin}/api/eda-flow/page#session=${this.key}`, directory: path.join(this.flow.config.workDirectory || this.flow.config.workspaceRoot, 'design-window') });
    return { opened: true };
  }
  async close() { this.server?.closeAllConnections(); if (this.server) await new Promise(r => this.server.close(r)); }
}
async function launchWindow({ url, directory }) {
  if (process.platform !== 'win32') throw new Error('当前独立窗口启动器支持 Windows。');
  const candidates = [process.env['PROGRAMFILES(X86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean).map(p => path.join(p, 'Microsoft/Edge/Application/msedge.exe'));
  let browser; for (const candidate of candidates) if (await fs.stat(candidate).then(s => s.isFile()).catch(() => false)) { browser = candidate; break; }
  if (!browser) throw new Error('未找到 Microsoft Edge，无法打开独立设计窗口。');
  await fs.mkdir(directory, { recursive: true });
  const script = fileURLToPath(new URL('../scripts/open-window.ps1', import.meta.url));
  await new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Browser', browser, '-Url', url, '-ProfileDirectory', directory], { windowsHide: true, stdio: ['ignore','ignore','pipe'] });
    let error = ''; child.stderr.on('data', d => error += d); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(error || '独立窗口未能打开。')));
  });
}
