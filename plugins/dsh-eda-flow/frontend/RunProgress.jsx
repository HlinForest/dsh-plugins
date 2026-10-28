import React, { useEffect, useState } from 'react';
import { Btn } from './ui.jsx';

const duration = ms => { const seconds = Math.max(0, Math.floor(ms / 1000)); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`; };
export function progressView(progress, now, lastSyncAt, connectionError) {
  const age = stamp => Math.max(0, now - (Date.parse(stamp) || now));
  const silence = age(progress.lastActivityAt || progress.startedAt);
  const disconnected = Boolean(connectionError || (lastSyncAt && now - lastSyncAt > 15000));
  return { elapsed: duration(age(progress.startedAt)), silence: duration(silence), disconnected,
    warning: disconnected ? '状态连接暂时中断，无法确认最新进展；页面会自动重连。'
      : silence >= 45000 && !progress.cancelling ? (progress.phase === 'tool' || progress.phase === 'check' ? '暂未收到新的工具结果，当前操作仍在等待返回。' : '暂未收到新的模型内容，可能仍在处理或等待服务响应。') : '' };
}
export function RunProgress({ project, lastSyncAt, connectionError, onCancel, onActivity }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { if (!project.busy) return; const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, [project.busy]);
  if (!project.busy) return null;
  const progress = project.liveProgress || { label: project.progress || '正在准备处理', phase: project.phase };
  const view = progressView(progress, now, lastSyncAt, connectionError);
  return <section className="run-progress" aria-label="实时处理进度">
    <div className="run-heading"><div className="run-title" role="status"><span className={`run-spinner ${progress.cancelling || view.disconnected ? 'paused' : ''}`} aria-hidden="true"/><strong>{progress.label}</strong></div><span className="run-elapsed">已用 {view.elapsed}</span></div>
    <div className="run-metrics"><span>{progress.type === 'chat' ? '助手对话' : `第 ${progress.stage || '—'} 步`}{progress.model ? ` · ${progress.model}` : ''}</span>{progress.round > 0 && <span>本次第 {progress.round} 轮请求</span>}{progress.replyChars > 0 && <span>本轮已收到 {progress.replyChars.toLocaleString()} 字符</span>}<span>KiCad 已完成 {progress.toolsCompleted || 0} 次</span>{progress.toolErrors > 0 && <span>工具返回错误 {progress.toolErrors} 次</span>}</div>
    {progress.recovery && <p className="run-freshness waiting">{progress.recovery}</p>}
    <p className={`run-freshness ${view.warning ? 'waiting' : ''}`}>{view.warning ? `${view.warning}（距最后已知活动 ${view.silence}）` : `距最近活动 ${view.silence} · 状态连接已更新`}</p>
    <div className="run-actions"><details><summary>查看最近活动</summary><ol>{(progress.recent || []).slice(-6).map((item, i) => <li key={`${item.at}:${i}`}><time>{new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{item.label}</span></li>)}</ol></details><div className="buttons"><button className="text-link" onClick={onActivity}>操作记录</button><Btn disabled={progress.cancelling} onClick={onCancel}>{progress.cancelling ? '正在取消…' : '取消本次处理'}</Btn></div></div>
  </section>;
}
