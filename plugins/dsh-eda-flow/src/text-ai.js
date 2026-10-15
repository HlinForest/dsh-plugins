import { randomUUID } from 'node:crypto';
import { createAssembler, createUserMessage } from './harness-messages.js';
import { FlowError, classify, finishError } from './errors.js';

function parseAction(raw) {
  try { return JSON.parse(raw); } catch {}
  // Accept one explicitly delimited JSON payload, never choose among multiple actions.
  const blocks = [...raw.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (blocks.length === 1) {
    const block = blocks[0], outside = raw.slice(0, block.index) + raw.slice(block.index + block[0].length);
    if (!/[{}\[\]`]/.test(outside)) {
      try { return JSON.parse(block[1]); } catch {}
    }
  }
  throw new FlowError('format', '模型回复不是完整的单个 JSON 动作。');
}

export async function generateText(ctx, { project, stage, request, tools = [], invoke, record, validateFinish, conversation }, signal) {
  const llm = ctx.get('llm'), selection = ctx.get('agentDefaultModel')?.currentSelection();
  if (!llm || !selection?.provider || !selection?.model) throw new FlowError('unselected', '请先在 Harness 中选择模型。文字输入已保存。');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(1800000)].filter(Boolean));
  const system = '你是文字驱动的电路设计助手。输入正文已经完整给出，不要求读取文件，不导入历史 CAD，不运行脚本，不使用 structured/python 生成器。规格书附件只有元数据时代表未读取；请用户粘贴带来源页码的正文，禁止编造资料内容。遵循明确连接、属性、装配、几何要求。\n'
    + '只返回一个合法 JSON 对象，键名和字符串必须使用双引号，不加解释或 Markdown。三种动作示例：{"action":"question","questions":["影响正确性的待补问题"]}；{"action":"tool","name":"工具名","arguments":{}}；{"action":"finish","summary":"本步实际结果","gaps":[],"assumptions":[]}。完成动作可另外提供 components、parameters、citations 数组。不输出批量调用脚本或固定调用序列。每次工具结果或错误返回后继续理解和修正。finish 只表示模型完成，实际通过取决于工具校验。\n'
    + '步骤2/3只分析已提供正文，关键参数记录来源（正文段落或真实规格书页码）；步骤4从空白项目调用通用 MCP 创建符号、连接和属性，修改后必须 precise_read 和 precise_check_export 检查再 finish；步骤5/7只读取当前生成工程副本并导出核对，不修改已确认 CAD。PCB 本轮跳过。\n'
    + '精确工具：所有坐标 mm，页面Y向下，符号局部Y向上。request_key每次意图唯一；同key重试参数必须相同。precise_apply是完整对象替换，不是局部补丁。KiCad坐标单位0.0001mm，符号原点和pin分别舍入，读取 native_at 后以真实网表修正导线。KiCad10忽略pin name/number局部effects.hide；统一隐藏必须设符号级pin_names_visible/pin_numbers_visible，不能只设逐pin；混合可见性无法保证时提出能力缺项。不得用全无源、排除ERC或改DNP等方法伪造通过。\n'
    + (conversation ? '当前仅提供建议，禁止工具修改。以finish.summary答复，必要时question。\n' : '')
    + '允许工具及完整参数结构：' + JSON.stringify(tools);
  const messages = [{ id: randomUUID(), role: 'user', source: { kind: 'eda-flow-text' }, content: [{ type: 'text', text: JSON.stringify({ project, stage, request, conversation }) }] }];
  let formatRetries = 0;
  for (let round = 0; round < 256; round++) {
    const blocks = new Map(); let finish, size = 0, raw = '';
    const assembler = createAssembler();
    const respond = value => messages.push(
      assembler.message({ provider: selection.provider, model: selection.model, ...(assembler.replayState === undefined ? {} : { replayState: assembler.replayState }) }),
      createUserMessage({ source: { kind: 'eda-flow-text' }, content: [{ type: 'text', text: JSON.stringify(value) }] }),
    );
    await record({ event: 'request', round, provider: selection.provider, model: selection.model, system, messages: structuredClone(messages) });
    try {
      const call = await llm.prepareCall({ ...selection, maxTokens: 24000 }, bounded);
      for await (const chunk of call.stream({ ...call.config, system, purpose: 'eda-flow-text-mcp', signal: bounded, messages })) {
        assembler.push(chunk);
        if (chunk.type === 'text-delta') { size += chunk.text.length; if (size > 2 * 1024 * 1024) throw new Error('模型输出过大。'); blocks.set(chunk.index, (blocks.get(chunk.index) || '') + chunk.text); }
        if (chunk.type === 'block-end' && chunk.block.type === 'text') blocks.set(chunk.index, chunk.block.text);
        if (chunk.type === 'finish') finish = chunk.reason;
      }
      raw = [...blocks.values()].join('\n').trim(); await record({ event: 'response', round, raw, finish });
      if (finish?.kind !== 'stop') throw finishError(finish, bounded);
      const action = parseAction(raw);
      if (!action || typeof action !== 'object' || Array.isArray(action)) throw new FlowError('format', '模型回复必须是单个 JSON 动作对象。');
      if (action.action === 'question') {
        if (!Array.isArray(action.questions) || !action.questions.length || action.questions.some(q => typeof q !== 'string' || !q.trim())) throw new FlowError('format', '待补问题格式无效。');
        return { ...action, provider: selection.provider, model: selection.model };
      }
      if (action.action === 'tool') {
        if (typeof action.name !== 'string' || !action.name.trim() || (action.arguments !== undefined && (!action.arguments || typeof action.arguments !== 'object' || Array.isArray(action.arguments)))) throw new FlowError('format', '工具动作需要 name 字符串和 arguments 对象。');
        let result;
        try {
          if (!tools.some(t => t.name === action.name) || !invoke || conversation) throw new Error('本步未授权该工具。');
          result = { ok: true, value: await invoke(action.name, action.arguments || {}) };
        } catch (error) { if (bounded.aborted) throw error; result = { ok: false, error: String(error.message) }; }
        await record({ event: 'tool-result', round, name: action.name, arguments: action.arguments, result });
        respond({ tool: action.name, ...result }); continue;
      }
      if (action.action !== 'finish' || typeof action.summary !== 'string' || !action.summary.trim() || !Array.isArray(action.gaps) || !Array.isArray(action.assumptions)) throw new FlowError('format', '只接受问题、已授权 MCP 工具或包含 summary/gaps/assumptions 的完成回复。');
      if ([...action.gaps, ...action.assumptions].some(value => typeof value !== 'string') || ['components','parameters','citations'].some(key => action[key] !== undefined && !Array.isArray(action[key]))) throw new FlowError('format', '待确认项、假设必须是文字列表；器件、参数和来源必须是数组。');
      if (action.executor || action.script) throw new FlowError('format', '文字 MCP 流程不接受执行器或模型脚本。');
      const issue = validateFinish && await validateFinish(action);
      if (issue) { await record({ event: 'finish-rejected', round, issue }); respond({ finishAccepted: false, issue }); continue; }
      return { ...action, provider: selection.provider, model: selection.model };
    } catch (error) {
      if (error.code === 'format' && !bounded.aborted) {
        if (formatRetries < 2 && round < 255) {
          formatRetries++;
          await record({ event: 'format-retry', round, attempt: formatRetries, limit: 2, reason: error.message });
          respond({ formatAccepted: false, issue: error.message,
            instruction: '只修正上一条回复的格式，保留事实和缺项，不重新开始工程，不重复已经成功的工具。返回一个合法 JSON 对象，双引号键名与字符串；不要 Markdown 或解释。缺资料请返回 question/questions；未完成工具检查不得声称 finish。' });
          continue;
        }
        error = new FlowError('format', '模型回复格式修正后仍不符合要求。输入与原始回复已保留，可查看原文后重试。', {
          formatRetries, rawResponse: raw.length > 24000 ? raw.slice(0, 12000) + '\n…（完整内容见执行记录）…\n' + raw.slice(-12000) : raw,
          rawResponseTruncated: raw.length > 24000, reason: error.message,
        });
      }
      const info = classify(error, 'model', bounded); await record({ event: 'error', round, error: info, partial: [...blocks.values()].join('\n') });
      throw new FlowError(info.code, info.message, info.details);
    }
  }
  throw new Error('达到 256 轮工具处理限制，记录已保留；请拆分需求或补充后重试。');
}
