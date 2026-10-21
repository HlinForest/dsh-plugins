// Generated from Harness 0.2.0-rc.2 public message helpers. See harness-messages.LICENSE.txt.

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-util-crypto/lib/index.js
function randomUUID() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const hex = Array.from(bytes, (byte, index) => {
    return (index === 6 ? byte & 15 | 64 : index === 8 ? byte & 63 | 128 : byte).toString(16).padStart(2, "0");
  }).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-brand/lib/index.js
function brandString(value) {
  return value;
}

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-util-values/lib/index.js
function assertNever(value, context) {
  const rendered = JSON.stringify(value) ?? String(value);
  throw new Error(`unreachable variant${context ? ` in ${context}` : ""}: ${rendered}`);
}
function deepFreeze(value) {
  const seen = /* @__PURE__ */ new WeakSet();
  const pending = [{
    kind: "visit",
    node: value
  }];
  while (pending.length > 0) {
    const task = pending.pop();
    if (task === void 0) continue;
    if (task.kind === "property") {
      pending.push({
        kind: "visit",
        node: task.source[task.key]
      });
      continue;
    }
    const node = task.node;
    if (node === null || typeof node !== "object") continue;
    if (node instanceof AbortSignal) continue;
    if (seen.has(node)) continue;
    seen.add(node);
    Object.freeze(node);
    const keys = Object.keys(node);
    for (let index = keys.length - 1; index >= 0; index--) {
      const key = keys[index];
      if (key === void 0) continue;
      pending.push({
        kind: "property",
        source: node,
        key
      });
    }
  }
  return value;
}

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-llm/lib/types/message.js
function createMessage(input) {
  return deepFreeze(structuredClone({
    ...input,
    id: brandString(randomUUID())
  }));
}
function createUserMessage(input) {
  return createMessage({
    ...input,
    role: "user"
  });
}
function createAssistantMessage(input) {
  return createMessage({
    role: "assistant",
    content: input.content,
    source: {
      kind: "model",
      ...input.source
    }
  });
}

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-llm/lib/types/assembler.js
var BlockAssembler = class {
  partials = /* @__PURE__ */ new Map();
  order = [];
  _usage;
  _finish;
  _replayState;
  /**
   * Feed one chunk into the assembly state.
   * @param chunk - the next raw chunk, in stream order.
   */
  push(chunk) {
    switch (chunk.type) {
      case "block-start": {
        if (!this.partials.has(chunk.index)) {
          this.order.push(chunk.index);
          this.partials.set(chunk.index, {
            blockType: chunk.blockType,
            text: "",
            toolCallArguments: ""
          });
        }
        return;
      }
      case "text-delta":
      case "reasoning-delta": {
        const partial = this.ensure(chunk.index, chunk.type === "text-delta" ? "text" : "reasoning");
        if (partial.block)
          return;
        partial.text += chunk.text;
        return;
      }
      case "tool-call-delta": {
        const partial = this.ensure(chunk.index, "tool-call");
        if (partial.block)
          return;
        partial.toolCallId = chunk.id;
        if (chunk.name)
          partial.toolCallName = chunk.name;
        partial.toolCallArguments += chunk.argumentsDelta;
        return;
      }
      case "block-end": {
        const partial = this.ensure(chunk.index, chunk.block.type);
        if (partial.block)
          return;
        partial.block = chunk.block;
        return;
      }
      case "usage": {
        this._usage = chunk.usage;
        return;
      }
      case "finish": {
        this._finish = chunk.reason;
        this._replayState = chunk.replayState;
        return;
      }
      default:
        return assertNever(chunk, "BlockAssembler.push");
    }
  }
  ensure(index, blockType) {
    let partial = this.partials.get(index);
    if (!partial) {
      partial = { blockType, text: "", toolCallArguments: "" };
      this.partials.set(index, partial);
      this.order.push(index);
    }
    return partial;
  }
  assemble(partial, index) {
    if (partial.block)
      return partial.block;
    switch (partial.blockType) {
      case "text":
        return { type: "text", text: partial.text };
      case "reasoning":
        return { type: "reasoning", text: partial.text };
      case "tool-call":
        return {
          type: "tool-call",
          id: partial.toolCallId ?? brandString(`call-${index}`),
          name: partial.toolCallName ?? "",
          arguments: partial.toolCallArguments
        };
      default:
        throw new Error(`cannot assemble incomplete block of type "${partial.blockType}"`);
    }
  }
  /** Invariant accessor: every index in `order` has a partial. */
  mustGet(index) {
    const partial = this.partials.get(index);
    if (!partial)
      throw new Error(`BlockAssembler invariant violated: no partial for index ${index}`);
    return partial;
  }
  /**
   * The one shared keep/drop decision over all seen blocks: max-token
   * truncation drops tool calls that cannot be executed safely. Emitted blocks
   * and replay metadata both derive from this result, so they cannot disagree.
   */
  assembled() {
    const all = this.order.map((index) => this.assemble(this.mustGet(index), index));
    const kept = this.finish.kind === "max-tokens" ? all.map((block) => block.type !== "tool-call") : void 0;
    const blocks = kept === void 0 ? all : all.filter((_, position) => kept[position]);
    const envelope = this._replayState;
    if (envelope?.blocks === void 0)
      return { blocks, replay: envelope };
    if (envelope.blocks.length !== all.length)
      return { blocks, replay: void 0 };
    return {
      blocks,
      replay: kept === void 0 || blocks.length === all.length ? envelope : { response: envelope.response, blocks: envelope.blocks.filter((_, position) => kept[position]) }
    };
  }
  /**
   * Assemble all blocks seen so far, in stream order.
   * @returns one block per seen index, except that max-token truncation drops
   *   tool calls that cannot be executed safely; an open block assembles from
   *   its accumulated deltas (an unknown block type never closed by `block-end` throws).
   */
  blocks() {
    return this.assembled().blocks;
  }
  /**
   * Assemble the prefix an interrupted stream can safely finalize: closed and
   * open text/reasoning blocks with non-whitespace content, in stream order.
   * Tool calls are omitted because interruption precedes dispatch; retaining
   * one would require a fabricated result. Open unknown blocks are also omitted.
   * @returns the kept blocks; empty when nothing streamed before the interruption.
   */
  interruptedBlocks() {
    return this.order.map((index) => {
      const partial = this.mustGet(index);
      const type = partial.block?.type ?? partial.blockType;
      if (type !== "text" && type !== "reasoning")
        return void 0;
      return this.assemble(partial, index);
    }).filter((block) => (block?.type === "text" || block?.type === "reasoning") && block.text.trim() !== "");
  }
  /** Usage from the `usage` chunk; undefined until one arrives. */
  get usage() {
    return this._usage;
  }
  /** Finish reason from the `finish` chunk; `{kind: 'stop'}` when the stream ended without one. */
  get finish() {
    return this._finish ?? { kind: "stop" };
  }
  /**
   * Replay metadata from the terminal finish chunk, if any, with per-block
   * entries pruned in step with {@link blocks}. Undefined when the envelope's
   * entries do not align with the emitted blocks.
   */
  get replayState() {
    return this.assembled().replay;
  }
  /**
   * The assembled assistant message.
   * @param source - provider/model attribution (without the `kind` tag) for the assembled message.
   * @returns a frozen assistant-role message over `blocks()` (same open-block assembly rules).
   */
  message(source) {
    return createAssistantMessage({ content: this.blocks(), source });
  }
};

// ../../EDA_Motif_Plugin_092_20261019/plugin/node_modules/@deepseek-ai/dsh-llm/lib/types/assistant-stream.js
function assembleAssistantStream(stream, assembler = new BlockAssembler()) {
  for (const record of stream) {
    switch (record.type) {
      case "chunk":
        assembler.push(record.chunk);
        break;
      case "text-chunks":
        assembler.push({ type: "text-delta", index: record.index, text: record.texts.join("") });
        break;
      case "reasoning-chunks":
        assembler.push({ type: "reasoning-delta", index: record.index, text: record.texts.join("") });
        break;
      case "tool-call-chunks":
        assembler.push({
          type: "tool-call-delta",
          index: record.index,
          id: record.id,
          ...record.name === void 0 ? {} : { name: record.name },
          argumentsDelta: record.args.join("")
        });
        break;
      default:
        assertNever(record, "assembleAssistantStream");
    }
  }
  return assembler;
}

// <stdin>
function createAssembler() {
  return assembleAssistantStream([]);
}
export {
  createAssembler,
  createUserMessage
};
