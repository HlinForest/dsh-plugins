import {pcbInstructions} from './pcb-flow.js';
import {issueKey} from './review-items.js';
import {clarificationInstructions} from './clarifications.js';
const sourceSpecInstructions = `提供的PDF及已确认提取结果包含器件引脚和装配事实。对资料中symbolId为Evidence:前缀的器件使用design_library查询，宿主优先匹配开源库，缺失时按通用功能分组与网格生成符号；几何不由用户提供。精确保留其身份、引脚及物料字段objectRole/originalFootprint/materialCode/materialDescription/assemblyType。未给出可核验封装几何时footprint可留空并记录待核对项，不代换成近似型号。资料中的模拟标记随引用保留；页码是本次PDF页码。连接仍由你根据需求推导，布局根据功能与拓扑安排；不读取历史工程。`;
import { controlledInstructions, genericInstructions } from './controlled-layout.js';
import { randomUUID } from 'node:crypto';
import { createAssembler, createUserMessage } from './harness-messages.js';
import { FlowError, classify, finishError } from './errors.js';
import { streamProgress } from './progress.js';
import { designInstructions } from './design-intent.js';
import { fixedInstructions } from './fixed-library.js';
import { hasSourceSpecs, isMockDemo, mockInstructions, mockControlledInstructions } from './mock-datasheets.js';

function parseAction(raw) {
  try { return JSON.parse(raw); } catch {}
  // DeepSeek may emit its native textual tool envelope despite JSON instructions.
  // Accept exactly one invocation; never extract arbitrary JSON from this envelope.
  if (raw.includes('｜｜DSML｜｜')) {
    const envelope = raw.match(/<｜｜DSML｜｜ calls>\s*<｜｜DSML｜｜ invoke name="([A-Za-z0-9_-]+)">([\s\S]*?)<\/｜｜DSML｜｜ invoke>\s*<\/｜｜DSML｜｜ calls>/);
    const outside = envelope ? raw.slice(0,envelope.index)+raw.slice(envelope.index+envelope[0].length) : raw;
    if (envelope && outside.length <= 1000 && !/[{}\[\]<>`]/.test(outside)) {
      const fields = new Map(); let rest = envelope[2], valid = true;
      const pattern = /<｜｜DSML｜｜ parameter name="([A-Za-z0-9_]+)" string="(true|false)">([\s\S]*?)<\/｜｜DSML｜｜ parameter>/g;
      for (const m of envelope[2].matchAll(pattern)) {
        if (fields.has(m[1]) || m[3].includes('｜｜DSML｜｜')) valid = false;
        fields.set(m[1], { type: m[2], value: m[3] }); rest = rest.replace(m[0], '');
      }
      if (valid && !rest.trim() && fields.size <= 2 && fields.get('arguments')?.type === 'false'
          && [...fields.keys()].every(k=>k==='arguments'||k==='name')
          && (!fields.has('name') || (fields.get('name').type === 'true' && fields.get('name').value === envelope[1]))) {
        try { return { action: 'tool', name: envelope[1], arguments: JSON.parse(fields.get('arguments').value) }; } catch {}
      }
      if (valid && !rest.trim() && !fields.has('arguments')) {
        try { return { action: 'tool', name: envelope[1], arguments: Object.fromEntries([...fields].map(([key,f])=>[key,f.type==='true'?f.value:JSON.parse(f.value)])) }; } catch {}
      }
    }
    throw new FlowError('format', 'DSML必须包含一个完整工具调用、唯一arguments对象和一致的工具名。');
  }
  // Accept one explicitly delimited JSON payload, never choose among multiple actions.
  const blocks = [...raw.matchAll(/```(?:json)?[ \t]*\r?\n([\s\S]*?)```/gi)];
  if (blocks.length === 1) {
    const block = blocks[0], outside = raw.slice(0, block.index) + raw.slice(block.index + block[0].length);
    if (!/[{}\[\]`]/.test(outside)) {
      try { return JSON.parse(block[1]); } catch {}
    }
  }
  // Some models prepend a short status sentence without fencing the JSON.
  // Find one complete object without modifying its contents. Braces inside
  // quoted strings are data; any extra object/array/fence outside is ambiguous.
  const start = raw.indexOf('{');
  if (start >= 0 && !/[{}\[\]`]/.test(raw.slice(0, start))) {
    const stack = []; let quoted = false, escaped = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        if (stack.pop() !== (c === '}' ? '{' : '[')) break;
        if (!stack.length) {
          if (!/[{}\[\]`]/.test(raw.slice(i + 1))) {
            try { return JSON.parse(raw.slice(start, i + 1)); } catch {}
          }
          break;
        }
      }
    }
  }
  throw new FlowError('format', '模型回复不是完整的单个 JSON 动作。');
}

export async function generateText(ctx, { project, stage, request, tools = [], invoke, record, validateFinish, conversation }, signal) {
  const llm = ctx.get('llm'), selection = ctx.get('agentDefaultModel')?.currentSelection();
  if (!llm || !selection?.provider || !selection?.model) throw new FlowError('unselected', '请先在 Harness 中选择模型。文字输入已保存。');
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(1800000)].filter(Boolean));
  const system = request.clarification ? clarificationInstructions : request.pcbDesign ? pcbInstructions : '仅对影响设计的实际缺项或资料冲突提问；已解决的回答见 request.resolvedAnswers 或 inputs.clarifications，必须继承，不再换句话重复询问。不把已明确的PCB不执行或泛泛的工程师复核声明列为待补项。最终图纸确认由界面单独保留。\n' + (project.controlledLayout ? (project.layoutEngine==='native-kicad'?genericInstructions:controlledInstructions) + (isMockDemo(project) ? '\n' + mockControlledInstructions : hasSourceSpecs({inputs:request.inputs}) ? '\n' + sourceSpecInstructions : '') + '\n允许工具及完整参数结构：' + JSON.stringify(tools) : (project.designMode === 'fixed-redesign' ? fixedInstructions + '\n' : project.designMode === 'new-design' ? designInstructions + '\n' : '') + '你是文字驱动的电路设计助手。输入正文已经完整给出，不要求读取文件，不导入历史 CAD，不运行脚本，不使用 structured/python 生成器。固定元件库是授权的局部器件资料，不是历史整页CAD。规格书附件只有元数据时代表未读取；请用户粘贴带来源页码的正文，禁止编造资料内容。遵循明确连接、属性、装配、几何要求。\n'
    + '只返回一个合法 JSON 对象，键名和字符串必须使用双引号，不加解释或 Markdown。三种动作示例：{"action":"question","questions":["影响正确性的待补问题"]}；{"action":"tool","name":"工具名","arguments":{}}；{"action":"finish","summary":"本步实际结果","gaps":[],"assumptions":[]}。完成动作可另外提供 components、parameters、citations 数组。不输出批量调用脚本或固定调用序列。每次工具结果或错误返回后继续理解和修正。finish 只表示模型完成，实际通过取决于工具校验。\n'
    + '步骤2/3只分析已提供正文，关键参数记录来源（正文段落或真实规格书页码）；步骤4从空白项目调用通用 MCP 创建符号、连接和属性，修改后必须 precise_read 和 precise_check_export 检查再 finish；步骤5/7只读取当前生成工程副本并导出核对，不修改已确认 CAD。PCB 本轮跳过。\n'
    + '控制单轮输出：一次只做一个小动作，不在一条回复中输出整张原理图。precise_apply 按 symbol.name/item.id 逐对象新增或替换，未列出的对象保持不变；完整替换指单个对象，不是整个工程。先创建空白工程，再分批定义符号（每批1个复杂符号）、放置器件与导线（通常每批不超过20个对象），每个被更新对象的全部必需属性必须齐全；不同批次使用不同 request_key。成功后接着做下一批，不重复已完成对象，不重新 create。finish 只写简洁总结，不复述任务书、全部页面坐标或工具已返回的完整对象。\n'
    + '精确工具：所有坐标 mm，页面Y向下，符号局部Y向上。request_key每次意图唯一；同key重试参数必须相同。precise_apply是完整对象替换，不是局部补丁。KiCad坐标单位0.0001mm，符号原点和pin分别舍入，读取 native_at 后以真实网表修正导线。KiCad10忽略pin name/number局部effects.hide；统一隐藏必须设符号级pin_names_visible/pin_numbers_visible，不能只设逐pin；混合可见性无法保证时提出能力缺项。不得用全无源、排除ERC或改DNP等方法伪造通过。\n'
    + '可读布局：根据器件数量选择A4或A3，留足位号、数值和引脚文字空间；禁止把带上下字段的电阻阵列挤在2.54mm行距内。位号和数值分别摆放，通常至少7.62mm行距，长值另留横向空间。主要信号路径用连续导线表达，跨功能块可用同名网络标签，不能只有孤立符号。数码管、连接器等应画可辨认的功能符号；仅在没有给定原图形且用户允许时，数码管才可在单个器件符号内部画七段示意；给定原图形时必须完整沿用，禁止改画，不得由外观猜测额外引脚、物理位序、采购料号或拆成多个BOM器件。优先使用1.27mm网格放引脚和导线端点；检查PDF/SVG可读性，不能以ERC通过代替文字重叠检查。\n'
    + 'KiCad文字方向：元件旋转90/270度时，若要其属性水平显示，属性at角度填90度（非旋转元件填0度）；坐标仍是页面绝对坐标。水平网络标签用font.justify=["left","bottom"]使文字在线上方，不能居中压在线上。导线可显式设width=0.254mm避免PDF中呈发丝线。\n'
    + (conversation ? '当前仅提供建议，禁止工具修改。以finish.summary答复，必要时question。\n' : '')
    + (isMockDemo(project) ? designInstructions + '\n' + mockInstructions + '\n' : '')
    + '允许工具及完整参数结构：' + JSON.stringify(tools));
  const messages = [{ id: randomUUID(), role: 'user', source: { kind: 'eda-flow-text' }, content: [{ type: 'text', text: JSON.stringify({ project, stage, request, conversation }) }] }];
  let formatRetries = 0, truncationRetries = 0;
  for (let round = 0; round < 256; round++) {
    const blocks = new Map(); let finish, size = 0, raw = '';
    const assembler = createAssembler();
    const reportProgress = streamProgress(record, round);
    const respond = value => messages.push(
      assembler.message({ provider: selection.provider, model: selection.model, ...(assembler.replayState === undefined ? {} : { replayState: assembler.replayState }) }),
      createUserMessage({ source: { kind: 'eda-flow-text' }, content: [{ type: 'text', text: JSON.stringify(value) }] }),
    );
    await record({ event: 'request', round, provider: selection.provider, model: selection.model, system, messages: structuredClone(messages) });
    try {
      const call = await llm.prepareCall({ ...selection, maxTokens: 24000 }, bounded);
      for await (const chunk of call.stream({ ...call.config, system, purpose: 'eda-flow-text-mcp', signal: bounded, messages })) {
        assembler.push(chunk);
        await reportProgress(chunk);
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
        if(!request.clarification){
          const answered=[...(request.resolvedAnswers||[]),...(request.inputs?.clarifications||[])];
          const repeated=action.questions.filter(q=>answered.some(a=>issueKey(a.question)===issueKey(q)));
          action.questions=action.questions.filter(q=>!repeated.includes(q));
          if(!action.questions.length){respond({alreadyAnswered:answered.filter(a=>repeated.some(q=>issueKey(q)===issueKey(a.question))),instruction:'这些问题已有有效回答，请使用已有答案继续当前步骤，不再重复提问。'});continue;}
        }
        return { ...action, provider: selection.provider, model: selection.model };
      }
      if (action.action === 'tool') {
        if (typeof action.name !== 'string' || !action.name.trim() || (action.arguments !== undefined && (!action.arguments || typeof action.arguments !== 'object' || Array.isArray(action.arguments)))) throw new FlowError('format', '工具动作需要 name 字符串和 arguments 对象。');
        formatRetries = 0; truncationRetries = 0;
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
      if (error.code === 'truncated' && !bounded.aborted) {
        if (truncationRetries < 2 && round < 255) {
          truncationRetries++;
          await record({ event: 'truncation-retry', round, attempt: truncationRetries, limit: 2, maxTokens: 24000 });
          respond({ truncated: true, actionExecuted: false,
            instruction: '上一条回复因输出长度上限被截断，当前动作未执行。放弃该不完整回复，重新给出一个更小且完整的 JSON 动作，不要续接 JSON 碎片。保留已成功的工具结果，不重新 create，不重做之前已完成的批次；仅输出下一小批，优先一个符号或不超过10个页面对象。precise_apply 只替换本批提供的单个完整对象，未提供的对象保留。减少重复分析与大段解释；不要省略必需属性或凭空宣称完成。' });
          continue;
        }
        error = new FlowError('truncated', '模型输出仍达到长度上限，已停止本次处理。已完成的工具记录与原始回复已保留，可查看后重试。', {
          truncationRetries, maxTokens: 24000, finishReason: finish?.kind,
          rawResponse: raw.length > 24000 ? raw.slice(0, 12000) + '\n…（完整内容见执行记录）…\n' + raw.slice(-12000) : raw,
          rawResponseTruncated: raw.length > 24000,
        });
      }
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

