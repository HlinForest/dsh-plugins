import { randomUUID } from 'node:crypto';
import { readLimited } from './io.js';

// Resolve services on each call: changing the DSH model must also change this route.
export function createDshVision(ctx) {
  return {
    async status(signal) {
      const llm = ctx.get('llm'), attachments = ctx.get('attachments');
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (!llm || !attachments || !selection?.provider || !selection.model) return { available: false, source: 'none', reason: 'DSH 模型或图片服务尚未就绪，请完成登录和模型选择后重试。' };
      try {
        const info = await llm.resolveModelInfo(selection.provider, selection.model, signal);
        const available = info.inputModalities?.includes('image') === true;
        return { available, source: 'dsh', provider: selection.provider, model: selection.model,
          reason: available ? `使用 DSH 当前模型 ${selection.model} 识别图片。` : `DSH 当前模型 ${selection.model} 不支持图片，请在 DSH 设置中选择支持图片的模型。` };
      } catch {
        signal?.throwIfAborted();
        return { available: false, source: 'dsh', reason: '无法读取 DSH 模型能力，请检查登录和模型设置后重试。' };
      }
    },
    async interpret(preview, system, prompt, signal) {
      const llm = ctx.get('llm'), attachments = ctx.get('attachments');
      const selection = ctx.get('agentDefaultModel')?.currentSelection();
      if (!llm || !attachments || !selection) throw new Error('DSH 模型或图片服务未就绪。');
      const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(300000)]);
      // Bind capabilities and dispatch to the same adapter, rejecting text-only models before I/O.
      const call = await llm.prepareCall({ ...selection, maxTokens: 32000 }, boundedSignal);
      if (!call.inputModalities?.includes('image')) throw new Error(`DSH 当前模型 ${selection.model} 不支持图片，请切换模型后重试。`);
      boundedSignal.throwIfAborted();
      const [attachment] = await attachments.saveImages([{ data: await readLimited(preview.image, 20 * 1024 * 1024), mediaType: 'image/png', name: `schematic-page-${preview.page}.png` }]);
      boundedSignal.throwIfAborted();
      const blocks = new Map(); let finish; let received = 0;
      const options = { ...call.config, system, purpose: 'schematic-reference', signal: boundedSignal,
        messages: [{ id: randomUUID(), role: 'user', source: { kind: 'schematic-sync' }, content: [{ type: 'text', text: prompt }, { type: 'image', attachment }] }] };
      for await (const chunk of call.stream(options)) {
        boundedSignal.throwIfAborted();
        if (chunk.type === 'text-delta') {
          received += chunk.text.length;
          if (received > 4 * 1024 * 1024) throw new Error('视觉识别结果过大。');
          const block = blocks.get(chunk.index);
          if (!block?.closed) blocks.set(chunk.index, { text: (block?.text || '') + chunk.text });
        } else if (chunk.type === 'block-end' && chunk.block.type === 'text' && !blocks.get(chunk.index)?.closed) {
          if (chunk.block.text.length > 4 * 1024 * 1024) throw new Error('视觉识别结果过大。');
          blocks.set(chunk.index, { text: chunk.block.text, closed: true });
        } else if (chunk.type === 'finish') finish = chunk.reason;
      }
      boundedSignal.throwIfAborted();
      if (finish?.kind !== 'stop') {
        if (finish?.kind === 'max-tokens') throw new Error('图片识别结果被截断，请分区识别或减少本页内容后重试。');
        // Provider failure details can contain request bodies or credentials; show a safe code only.
        const code = /^[A-Z0-9_]{1,64}$/.test(finish?.failure?.code || '') ? `（${finish.failure.code}）` : '';
        throw new Error(`DSH 图片识别未完成${code}，请检查登录、余额或网络后重试。`);
      }
      const text = [...blocks.values()].map(b => b.text).join('\n');
      if (!text.trim()) throw new Error('DSH 图片识别没有返回条目，请重试。');
      return text;
    },
  };
}
