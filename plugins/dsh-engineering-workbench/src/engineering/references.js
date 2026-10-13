import path from 'node:path';
import { json, readLimited } from './io.js';
import { checkManifest } from './adapters.js';

// Owns background recognition only. The task port commits one fully validated page atomically.
export class References {
  constructor(ports) { this.ports = ports; this.jobs = new Map(); this.starting = new Set(); this.closed = false; }
  file(task, side) { return path.join(this.ports.directory(task.id), `recognition-${side}.json`); }
  async status(task, side) {
    let run;
    try { run = JSON.parse(await readLimited(this.file(task, side))); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    const job = this.jobs.get(task.id);
    if (run?.state === 'running' && (!job || job.side !== side)) { run.state = 'paused'; run.message = '识别已中断，可从已保存页面继续。'; }
    return { run: run || null, active: !!job, activeSide: job?.side || null, stopping: !!job?.controller.signal.aborted };
  }
  async dispatch(input, signal) {
    if (!input || !['status', 'start', 'stop'].includes(input.action) || !['left', 'right'].includes(input.side)) throw new Error('请选择要识别的资料。');
    const task = await this.ports.load(input.taskId), side = input.side, snap = task[side];
    if (!['compare', 'align'].includes(task.kind) || snap?.design.format !== 'reference') throw new Error('此功能用于比较任务中的图片或 PDF。');
    if (input.action === 'status') return this.status(task, side);
    if (input.action === 'stop') { this.jobs.get(task.id)?.controller.abort(); return this.status(task, side); }
    if (this.closed || this.jobs.has(task.id) || this.starting.has(task.id)) throw new Error('此任务正在处理，请稍候。');
    this.starting.add(task.id);
    try {
      await checkManifest(snap);
      const capability = await this.ports.reader?.status(signal);
      if (!capability?.available) throw new Error(capability?.reason || '请在 DSH 选择支持图片的模型后重试。');
      let { run } = await this.status(task, side);
      if (!run || run.sourceHash !== snap.version) run = { sourceHash: snap.version, totalPages: snap.design.pages, completedPages: [], startedAt: new Date().toISOString() };
      if (run.state === 'complete') return this.status(task, side);
      signal?.throwIfAborted();
      run.state = 'running'; run.message = '正在准备逐页识别';
      await json(this.file(task, side), run);
      if (this.closed) throw new Error('识别服务正在关闭。');
      const job = { side, controller: new AbortController() }; this.jobs.set(task.id, job);
      job.promise = this.run(task, side, run, job.controller.signal).finally(() => this.jobs.delete(task.id));
      job.promise.catch(() => {});
      return this.status(task, side);
    } finally { this.starting.delete(task.id); }
  }
  async run(task, side, run, signal) {
    const save = () => { run.updatedAt = new Date().toISOString(); return json(this.file(task, side), run); };
    try {
      for (let page = 1; page <= run.totalPages; page++) {
        if (run.completedPages.includes(page)) continue;
        signal.throwIfAborted(); run.page = page; run.message = `正在识别第 ${page} / ${run.totalPages} 页（两次提取并核对）`; await save();
        await this.ports.processPage({ taskId: task.id, side, page }, signal);
        run.completedPages.push(page); await save();
      }
      run.state = 'complete'; run.message = '所有页面已识别，已生成待核对的元件与连接。';
    } catch (e) { run.state = signal.aborted ? 'paused' : 'failed'; run.message = signal.aborted ? '已暂停，已识别页面保留。' : String(e.message).slice(0, 500); }
    await save();
  }
  async dispose() { this.closed = true; for (const job of this.jobs.values()) job.controller.abort(); await Promise.allSettled([...this.jobs.values()].map(job => job.promise)); }
}
