import { spawn } from 'node:child_process';

// Requests and results cross the process boundary over pipes, never JSON files.
export function documentProcess(python, script, request) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, [script, '--stdio'], { windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' } });
    let output = '', errors = '', failed;
    const timer = setTimeout(() => { failed = new Error('资料提取超时。'); child.kill(); }, 120000);
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (Buffer.byteLength(output) > 20 * 1024 * 1024) { failed = new Error('资料提取结果过大。'); child.kill(); }
    });
    child.stderr.on('data', chunk => { errors = (errors + chunk).slice(-4000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.stdin.on('error', error => { failed ||= error; });
    child.on('close', code => {
      clearTimeout(timer);
      if (failed || code !== 0) return reject(failed || new Error(errors || `提取失败 ${code}`));
      try { resolve(JSON.parse(output)); } catch { reject(new Error('资料提取进程返回了无效结果。')); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
