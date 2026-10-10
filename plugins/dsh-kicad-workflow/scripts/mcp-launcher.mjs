// Preserve MCP handshake/discovery latency while waiting for the KiCad Python
// backend before forwarding calls. KiCAD-MCP-Server 2.7 exposes tools early.
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';

const entry = process.argv[2];
if (!entry || !path.isAbsolute(entry)) throw new Error('Absolute MCP server entry required.');
const child = spawn(process.execPath, [entry], { cwd: path.dirname(path.dirname(entry)), env: process.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let ready = false, closing = false, stderrTail = '', pending = [], queuedBytes = 0;
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const startupTimer = setTimeout(() => { process.stderr.write('KiCad backend readiness deadline exceeded (180s).\n'); stop(1); }, 180000);
function forward(line) { if (!closing && !child.stdin.destroyed) child.stdin.write(line + '\n'); }
input.on('line', line => {
  let message;
  try { message = JSON.parse(line); } catch { process.stderr.write('Invalid MCP JSON frame.\n'); stop(1); return; }
  if (!ready && message.method === 'tools/call') {
    queuedBytes += Buffer.byteLength(line);
    if (queuedBytes > 8 * 1024 * 1024 || pending.length >= 100) { stop(1); return; }
    pending.push({ id: message.id, line }); return;
  }
  if (message.method === 'notifications/cancelled') {
    const id = message.params?.requestId;
    const removed = pending.filter(item => item.id === id);
    queuedBytes -= removed.reduce((n, item) => n + Buffer.byteLength(item.line), 0);
    pending = pending.filter(item => item.id !== id);
  }
  forward(line);
});
child.stdout.pipe(process.stdout);
child.stderr.on('data', chunk => {
  process.stderr.write(chunk);
  stderrTail = (stderrTail + chunk.toString()).slice(-4096);
  if (!ready && stderrTail.includes('KiCAD MCP SERVER READY')) {
    ready = true; clearTimeout(startupTimer);
    for (const item of pending) forward(item.line);
    pending = []; queuedBytes = 0;
  }
});
function stop(code = 0) {
  if (closing) return;
  closing = true; clearTimeout(startupTimer); input.close(); process.stdin.pause();
  pending = []; process.exitCode = code;
  child.stdin.end();
  // Only terminate our own server tree, including its KiCad Python child.
  if (child.pid && child.exitCode === null) {
    if (process.platform === 'win32') {
      try {
        const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => child.kill());
      } catch { child.kill(); }
    } else child.kill('SIGTERM');
  }
}
input.on('close', () => stop());
child.on('error', error => { process.stderr.write(error.message + '\n'); stop(1); });
child.stdin.on('error', () => stop(1));
process.stdout.on('error', () => stop());
child.on('close', code => { clearTimeout(startupTimer); if (!closing) stop(code ?? 1); });
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop());
