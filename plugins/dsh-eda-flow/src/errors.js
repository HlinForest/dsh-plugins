export class FlowError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.details = details; }
}
const titles = { unselected: '未选择模型', auth: '模型鉴权失败', quota: '模型额度不足', rate: '请求受到限流', timeout: '模型响应超时', cancelled: '本次处理已取消', truncated: '模型输出被截断', format: '模型返回格式不完整', tool: '工具执行失败', model: '模型请求未完成', input: '输入需要补充', conflict: '输入已被其他窗口修改' };
export function classify(error, phase = 'model', signal) {
  if (error instanceof FlowError) return { code: error.code, title: titles[error.code] || '处理未完成', message: error.message, phase, details: error.details };
  const failure = error?.failure || error || {}, message = String(failure.message || error || '请求未完成').slice(-4500);
  const evidence = `${failure.code || ''} ${message}`, status = Number(failure.status || error?.statusCode);
  let code = phase === 'tool' ? 'tool' : 'model';
  if (signal?.aborted) code = signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled';
  else if (status === 401 || status === 403 || /authentication|unauthori[sz]ed|invalid.api.key/i.test(evidence)) code = 'auth';
  else if (status === 402 || /insufficient[_ ](?:quota|balance)|quota[_ ]exhausted|余额不足|额度不足/i.test(evidence)) code = 'quota';
  else if (status === 429 || /rate[_ -]limit/i.test(evidence)) code = 'rate';
  else if (/timeout|timed.out|超时/i.test(evidence)) code = 'timeout';
  return { code, title: titles[code], message, phase, details: { status: status || undefined, providerCode: failure.code, requestId: failure.requestId } };
}
export function finishError(finish, signal) {
  if (finish?.kind === 'max-tokens') return new FlowError('truncated', '模型输出达到长度上限，尚未形成完整处理方案。');
  if (finish?.kind === 'aborted' || signal?.aborted) return new FlowError(signal?.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled', signal?.reason?.name === 'TimeoutError' ? '模型响应超时，输入与执行记录已保留。' : '本次处理已取消，输入已保留。');
  const info = classify(finish?.failure || { message: `模型未正常结束（${finish?.kind || '无结束记录'}），输入与执行记录已保留。` }, 'model', signal);
  return new FlowError(info.code, info.message, info.details);
}
