import { spawn } from 'node:child_process';
import { loadProject } from './service.js';
import { digest } from './engine.js';

export function createNotifier({ popup = false, log = console.log } = {}) {
  let child;
  const notify = async event => {
    const text = event.error ? `评审读取失败：${event.error}` : `${event.project}\n新增/变化的问题 ${event.findings.length} 项\n` + event.findings.slice(0, 8).map(f => `${f.refs.join(', ')} ${f.net ?? ''}：${f.title}`).join('\n');
    log(text);
    if (!popup || process.platform !== 'win32') return;
    // Keep notifications in a non-blocking child; replace stale notifications with the latest batch.
    if (child) child.kill();
    const script = "$ErrorActionPreference = 'Stop'; $ProgressPreference = 'SilentlyContinue'; [Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $p = [Console]::In.ReadToEnd() | ConvertFrom-Json; Add-Type -AssemblyName PresentationFramework; [System.Windows.MessageBox]::Show($p.message, 'PCB 评审提醒', 'OK', 'Warning') | Out-Null";
    const current = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    child = current;
    current.on('error', error => log(`弹窗失败：${error.message}`));
    current.stdin.on('error', error => log(`弹窗输入失败：${error.message}`));
    current.stdin.end(JSON.stringify({ message: text }));
    let errorOutput = '';
    current.stderr.setEncoding('utf8');
    current.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(0, 4000); });
    current.on('close', code => {
      if (code && child === current) log(`弹窗进程失败 (${code})：${errorOutput}`);
      if (child === current) child = undefined;
    });
  };
  notify.dispose = () => { child?.kill(); child = undefined; };
  return notify;
}

export function startWatcher({ projectFile, pollSeconds = 3, notify, load = loadProject }) {
  if (!Number.isInteger(pollSeconds) || pollSeconds < 1 || pollSeconds > 3600) throw new Error('pollSeconds 必须是 1–3600 的整数');
  let stopped = false, running = false, previous = new Map(), lastError, latest, candidate, stableCount = 0;
  let status = { state: 'starting', projectFile, lastCheckedAt: null, lastError: null };
  const abort = new AbortController();
  async function tick() {
    if (stopped || running) return;
    running = true;
    try {
      const loaded = await load(projectFile, abort.signal), report = loaded.report;
      if (stopped) return;
      // Require two equal revisions before notifying, to avoid half-written export batches.
      if (candidate === report.revision) stableCount++; else { candidate = report.revision; stableCount = 1; }
      status = { ...status, state: stableCount < 2 ? 'settling' : 'watching', lastCheckedAt: new Date().toISOString(), lastError: null };
      lastError = undefined;
      if (stableCount < 2) return;
      latest = report;
      const current = new Map(report.findings.filter(f => f.status === 'warning' || f.status === 'unknown').map(f => [f.id, digest(f)]));
      const changed = report.findings.filter(f => current.has(f.id) && previous.get(f.id) !== current.get(f.id));
      if (changed.length) await notify({ project: report.project, revision: report.revision, findings: changed });
      if (!stopped) previous = current;
    } catch (error) {
      if (stopped) return;
      candidate = undefined; stableCount = 0;
      status = { ...status, state: 'error', lastCheckedAt: new Date().toISOString(), lastError: error.message };
      if (lastError !== error.message) {
        lastError = error.message;
        try { await notify({ error: error.message }); } catch { /* Status retains the source failure. */ }
      }
    } finally { running = false; }
  }
  const timer = setInterval(() => { void tick(); }, pollSeconds * 1000);
  timer.unref();
  void tick();
  return { tick, getStatus: () => ({ ...status, latestRevision: latest?.revision ?? null, findings: latest?.findings ?? [] }),
    dispose() { stopped = true; abort.abort(); clearInterval(timer); notify.dispose?.(); status.state = 'stopped'; } };
}
