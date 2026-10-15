// Report observable stream activity, never reasoning text or guessed completion percentages.
export function streamProgress(record, round, clock = Date.now) {
  const text = new Map(); let activity, sentActivity, lastSent = -Infinity, chunks = 0;
  return async chunk => {
    if (chunk.type === 'text-delta') { text.set(chunk.index, (text.get(chunk.index) || 0) + chunk.text.length); activity = 'responding'; }
    else if (chunk.type === 'reasoning-delta') activity = 'reasoning';
    else if (chunk.type === 'block-end' && chunk.block?.type === 'text') { text.set(chunk.index, chunk.block.text.length); activity = 'responding'; }
    else if (chunk.type !== 'finish') return;
    if (chunk.type !== 'finish') chunks++;
    if (!activity) return;
    const now = clock();
    if (activity !== sentActivity || now - lastSent >= 800 || chunk.type === 'finish') {
      await record({ event: 'stream-progress', round, activity, chunks, replyChars: [...text.values()].reduce((a, b) => a + b, 0) });
      sentActivity = activity; lastSent = now;
    }
  };
}

export function updateProgress(job, phase, label, details = {}) {
  if (!job || job.cancelling) return;
  const now = new Date().toISOString();
  const previous = job.activity || {};
  const changed = previous.label !== label || previous.phase !== phase;
  job.phase = phase; job.progress = label;
  job.activity = { ...previous, ...details, phase, label, lastActivityAt: now,
    phaseStartedAt: changed ? now : previous.phaseStartedAt || now };
  if (changed) job.recentActivity = [...(job.recentActivity || []), { at: now, label }].slice(-12);
}

export function modelProgress(job, value) {
  if (!job) return;
  const common = { round: (value.round ?? 0) + 1 };
  if (value.event === 'request') updateProgress(job, 'model', '等待模型响应', { ...common, model: value.model, replyChars: 0, chunks: 0, requestStartedAt: new Date().toISOString() });
  if (value.event === 'stream-progress') updateProgress(job, 'model', value.activity === 'reasoning' ? '模型正在思考（已收到活动）' : '正在接收模型回复', { ...common, replyChars: value.replyChars, chunks: value.chunks });
  if (value.event === 'response') updateProgress(job, 'model', '已收到回复，正在检查格式', { ...common, recovery: '' });
  if (value.event === 'format-retry') { const recovery = `回复格式修正 · ${value.attempt}/${value.limit}`; updateProgress(job, 'model', '正在请求' + recovery, { ...common, recovery }); }
  if (value.event === 'truncation-retry') { const recovery = `输出被截断，正在缩小批次重试 · ${value.attempt}/${value.limit}`; updateProgress(job, 'model', recovery, { ...common, recovery }); }
  if (value.event === 'finish-rejected') updateProgress(job, 'model', '检查未通过，正在交回模型修正', common);
  if (value.event === 'reads') updateProgress(job, 'input', '已读取资料，准备继续分析', common);
}

export const toolLabels = {
  precise_create: '正在创建空白原理图', precise_apply: '正在放置器件、导线与页面对象',
  precise_read: '正在读取原理图核对结果', precise_check_export: '正在运行电气检查并导出图纸',
};
