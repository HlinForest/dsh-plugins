import { version as clientVersion } from '../src/contracts.js';

export { clientVersion };
const statuses = { pending: '尚未执行', done: '已完成，尚未确认', running: '处理中', stale: '需要重新核对', failed: '执行失败', interrupted: '执行中断', cancelled: '已取消', 'waiting-input': '待补文字要求', skipped: '本轮未执行' };
export function confirmedStage(project, number) {
  return project?.stages?.find(stage => Number(stage.id) === Number(number));
}
export function confirmationError(project, number, backendVersion) {
  const stage = confirmedStage(project, number);
  const details = { stage: Number(number), status: stage?.status || '未返回', confirmed: stage?.confirmed === true,
    clientVersion, backendVersion: backendVersion || '未取得', projectId: project?.id,
    invalidation: stage?.invalidation, gaps: stage?.gaps || [], assumptions: stage?.assumptions || [] };
  const reason = stage?.invalidation?.message || stage?.errorInfo?.message || stage?.error;
  const message = reason || (stage
    ? `“${stage.title || '当前步骤'}”尚未确认，当前状态：${statuses[stage.status] || stage.status}。可重新读取状态，或查看下方待确认项；无需重复上传默认资料。`
    : '未取得本步确认状态。请重新读取状态；若仍失败，可下载问题记录。无需补交默认资料。');
  return Object.assign(new Error(message), { info: { code: 'confirmation', details } });
}
