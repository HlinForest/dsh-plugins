import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { FlowError, finishError, classify } from './errors.js';
const skill = await fs.readFile(new URL('../skills/eda-inputs/SKILL.md', import.meta.url), 'utf8');

export function harnessAI(ctx) {
  return {
    selection() { return ctx.get('agentDefaultModel')?.currentSelection() || null; },
    async generate({ project, stage, request, evidence = [], read, record, conversation }, signal) {
      const llm = ctx.get('llm'); const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (!llm || !selection?.provider || !selection?.model) throw new FlowError('unselected', '请先在 Harness 中选择模型。输入已保存。');
      const bounded = AbortSignal.any([signal, AbortSignal.timeout(600000)].filter(Boolean));
      let system = skill + '\n只返回 JSON。需要资料时返回 {action:"read",files:[{scope:"inputs"|"prepared"|"stage:数字",path:string,offset?:number,length?:number}]}，每轮最多 6 份，每份最多 24000 字符。结果含 sha256、totalChars、nextOffset；可继续读取，不能把节选当完整文件。最终返回 {action:"plan",version:1,executor:"structured"|"local"|"python",summary:string,assumptions:string[],gaps:string[],script?:string}。\n'
        + 'structured：将完整 inputsBundle 交给本步资料到 KiCad 工具；仅 structuredEligible 为 true 可选。模型核对依据、缺项和处理决定，工具遍历完整对象。local：仅步骤 1-3，将读取结果与模型结论形成输入记录。python：编写完整 Python 程序，接受 --request JSON，读取 inputs、inputsBundle、dependencies，写 output/project 和 output/result.json {summary,gaps:[]}。KiCad CLI 路径在 cli。新设计生成电路时选择 python。程序仅写本次 output。规格书提取参数附文件和页码。结论描述计划，实际成功由执行和检查决定。';
      system += '\n用户编辑的 request.plan 是本步要求之一，请结合当前输入核对。步骤 2/3 可在 plan 附 components:[{ref,value,footprint,pins,source}]、parameters:[{ref,name,value,source,page}]、connections 和 citations，供工程师复核。参数必须有实际资料依据，未取得的规格书不得伪造页码。';
      if (conversation) system = skill + '\n你是当前工程当前步骤的设计助手。只分析与建议，不执行工具、不更改工程。可先返回 {action:"read",files:[{scope:"inputs"|"prepared"|"stage:数字",path:string,offset?:number,length?:number}]} 读取资料（每轮最多6份），最后只返回 JSON {action:"advice",text:string}。未取得的参数保持待确认。\n';
      const messages = [{ id: randomUUID(), role: 'user', source: { kind: 'eda-flow' }, content: [{ type: 'text', text: JSON.stringify({ stage, mode: project.mode, request, evidence, conversation, instruction: '先 read 当前输入或 prepared 资料，再给处理方案。' }) }] }];
      let readCount = 0;
      for (let round = 0; round < 16; round++) {
        const blocks = new Map(); let finish, size = 0;
        await record({ event: 'request', round, provider: selection.provider, model: selection.model, system, messages: structuredClone(messages) });
        try {
          const call = await llm.prepareCall({ ...selection, maxTokens: 24000 }, bounded);
          for await (const chunk of call.stream({ ...call.config, system, purpose: 'eda-flow-stage', signal: bounded, messages })) {
            if (chunk.type === 'text-delta') { size += chunk.text.length; if (size > 2 * 1024 * 1024) throw new Error('模型输出过大。'); blocks.set(chunk.index, (blocks.get(chunk.index) || '') + chunk.text); }
            if (chunk.type === 'block-end' && chunk.block.type === 'text') blocks.set(chunk.index, chunk.block.text);
            if (chunk.type === 'finish') finish = chunk.reason;
          }
          const raw = [...blocks.values()].join('\n').trim();
          await record({ event: 'response', round, raw, finish });
          if (finish?.kind !== 'stop') throw finishError(finish, bounded);
          let plan; try { plan = JSON.parse(raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); } catch { throw new FlowError('format', '模型返回内容不是完整 JSON，原始回复已保留。'); }
          if (conversation && plan.action === 'advice' && typeof plan.text === 'string' && plan.text.trim()) return { text: plan.text, provider: selection.provider, model: selection.model };
          if (conversation && plan.action !== 'read') throw new FlowError('format', '助手尚未返回可查看的建议。');
          if (plan.action === 'read') {
            if (!Array.isArray(plan.files) || !plan.files.length || plan.files.length > 6) throw new Error('资料读取请求数量无效。');
            const results = []; for (const file of plan.files) results.push(await read(file));
            readCount += results.length;
            await record({ event: 'reads', round, results });
            messages.push({ id: randomUUID(), role: 'assistant', content: [{ type: 'text', text: raw }] }, { id: randomUUID(), role: 'user', content: [{ type: 'text', text: JSON.stringify({ fileResults: results }) }] });
            continue;
          }
          if (!['structured', 'local', 'python'].includes(plan.executor) || typeof plan.summary !== 'string' || !Array.isArray(plan.assumptions) || !Array.isArray(plan.gaps)) throw new FlowError('format', '模型方案缺少处理方式、说明或待确认项。');
          if (!readCount) throw new Error('模型尚未读取本步资料，请重新执行并先读取输入。');
          if (plan.executor === 'python' && !plan.script?.trim()) throw new Error('模型没有生成执行程序。');
          return { ...plan, provider: selection.provider, model: selection.model };
        } catch (e) { const info = classify(e, 'model', bounded); await record({ event: 'error', round, error: info, partial: [...blocks.values()].join('\n') }); throw new FlowError(info.code, info.message, info.details); }
      }
      throw new Error('资料读取达到 16 轮，请缩小本步输入范围后重试。');
    },
  };
}
