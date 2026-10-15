import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { inside } from './io.js';

const directory = fileURLToPath(new URL('../mcp/', import.meta.url));
export const preciseSchemas = JSON.parse(await fs.readFile(path.join(directory, 'schema.json'), 'utf8')).tools;

// This adapter speaks MCP stdio. It never imports the CAD writer or accepts a model-selected root.
export async function invokePrecise(config, root, name, args, signal) {
  if (signal?.aborted) throw new Error('MCP 执行已取消。');
  if (!preciseSchemas.some(t => t.name === name)) throw new Error('未知 KiCad MCP 工具。');
  if (!config.workspaceRoot || !inside(config.workspaceRoot, root)) throw new Error('MCP 输出必须在当前工作区。');
  await fs.mkdir(root, { recursive: true });
  const realRoot = await fs.realpath(root), realWorkspace = await fs.realpath(config.workspaceRoot);
  if (!inside(realWorkspace, realRoot)) throw new Error('MCP 输出路径越出工作区。');
  return new Promise((resolve, reject) => {
    const child = spawn(config.mcpPython || config.kicadPython, [path.join(directory, 'precise_mcp.py'), '--root', realRoot, '--kicad-cli', config.kicadCli], {
      cwd: realRoot, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    let pending = '', stderr = '', size = 0, settled = false, initialized = false;
    const stop = () => {
      if (process.platform === 'win32' && child.pid) {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } else child.kill();
    };
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      child.stdin.end(); if (error) stop();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error('MCP 执行已取消。'));
    const timer = setTimeout(() => finish(new Error('MCP 工具超过 240 秒，已停止。')), 240000);
    signal?.addEventListener('abort', abort, { once: true });
    child.stdin.on('error', () => {});
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
    child.on('error', error => finish(new Error(`MCP 无法启动：${error.message}`)));
    child.on('close', code => { if (!settled) finish(new Error(`MCP 未正常返回（${code}）：${stderr || '请核对 Python、jsonschema 与 KiCad CLI 配置。'}`)); });
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', data => {
      size += Buffer.byteLength(data); if (size > 48 * 1024 * 1024) return finish(new Error('MCP 返回超过大小限制。'));
      pending += data;
      for (;;) {
        const end = pending.indexOf('\n'); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1); if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.id === 1 && !initialized) {
            if (response.error || response.result?.protocolVersion !== '2025-03-26') throw new Error('MCP 初始化失败。');
            initialized = true;
            send({ jsonrpc: '2.0', method: 'notifications/initialized' });
            send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });
          } else if (response.id === 2) {
            if (response.error) throw new Error(response.error.message || 'MCP 协议错误。');
            const text = response.result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n');
            const value = JSON.parse(text);
            if (response.result?.isError) throw new Error(value.error || text);
            finish(null, value);
          }
        } catch (error) { finish(error); }
      }
    });
    if (signal?.aborted) abort();
    else send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'dsh-eda-flow', version: '1' } } });
  });
}

export class PreciseTools {
  constructor(config, ctx = null) { this.config = config; this.ctx = ctx; this.sessions = new Map(); }
  register() {
    if (!this.ctx) return;
    for (const tool of preciseSchemas) this.ctx.tools.register({
      name: 'eda_' + tool.name, description: tool.description + ' 仅当前 EDA 任务的有效执行令牌可使用。',
      parameters: { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, executionToken: { type: 'string' } }, required: [...tool.inputSchema.required, 'executionToken'] },
      output: { schema: {}, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: async (args, execution) => {
        const { executionToken, ...parameters } = args;
        const session = this.sessions.get(executionToken);
        if (!session || session.signal?.aborted || !session.allowed.has(tool.name)) throw new Error('MCP 执行令牌无效、已结束或本步不允许修改 CAD。');
        if (session.busy) throw new Error('当前工程已有 MCP 操作，请等待其返回。');
        session.busy = true;
        // Copied stage projects retain MCP idempotency history. Namespace keys per
        // active stage so a model's reused key cannot return paths from upstream.
        const scoped = typeof parameters.request_key === 'string' ? { ...parameters, request_key: `${executionToken}:${parameters.request_key}` } : parameters;
        try { return await invokePrecise(this.config, session.root, tool.name, scoped, AbortSignal.any([session.signal, execution?.signal].filter(Boolean))); }
        finally { session.busy = false; }
      },
    });
  }
  open(root, signal, allowModify) {
    const token = randomUUID(), allowed = new Set(preciseSchemas.filter(t => allowModify || ['precise_read', 'precise_check_export'].includes(t.name)).map(t => t.name));
    this.sessions.set(token, { root, signal, allowed });
    return {
      tools: preciseSchemas.filter(t => allowed.has(t.name)),
      invoke: async (name, args) => {
        if (!this.sessions.has(token) || signal?.aborted || !allowed.has(name)) throw new Error('当前步骤不允许此 MCP 操作。');
        if (!this.ctx) return invokePrecise(this.config, root, name, typeof args.request_key === 'string' ? { ...args, request_key: `${token}:${args.request_key}` } : args, signal);
        const result = await this.ctx.tools.execute({ name: 'eda_' + name, arguments: { ...args, executionToken: token }, callId: `eda-flow:${randomUUID()}`, signal });
        if (result.isError) throw new Error(result.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || result.value?.message || 'MCP 工具失败。');
        return result.value ?? result.structuredContent ?? result;
      },
      close: () => this.sessions.delete(token),
    };
  }
}
