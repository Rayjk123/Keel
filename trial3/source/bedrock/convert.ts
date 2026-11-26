// Translates OpenAI-style chat requests, including tool calls, to Bedrock Converse and back.
type ReasoningDetail = { type: "reasoning.text"; text: string; signature?: string } | { type: "reasoning.encrypted"; data: string };
type OpenAIToolCall = { id: string; type?: string; function: { name: string; arguments: string | Record<string, unknown> } };
type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | { text?: string }[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  reasoning_details?: ReasoningDetail[];
};
type OpenAITool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type OpenAIRequest = { model: string; messages: OpenAIMessage[]; tools?: OpenAITool[]; max_tokens?: number };

type ReasoningContent = { reasoningText?: { text?: string; signature?: string }; redactedContent?: Uint8Array };
type Block =
  | { text: string }
  | { reasoningContent: ReasoningContent }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status?: "success" | "error" } };
type Turn = { role: "user" | "assistant"; content: Block[] };

type Usage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadInputTokens?: number;
  cacheWriteInputTokens?: number;
};
export type ConverseOutput = {
  output?: { message?: { content?: ({ text?: string; toolUse?: { toolUseId: string; name: string; input: unknown } } | Record<string, unknown>)[] } };
  stopReason?: string;
  usage?: Usage;
};
export type StreamEvent = {
  contentBlockStart?: { contentBlockIndex?: number; start?: { toolUse?: { toolUseId?: string; name?: string } } };
  contentBlockDelta?: {
    contentBlockIndex?: number;
    delta?: { text?: string; toolUse?: { input?: string }; reasoningContent?: ReasoningContent & { text?: string; signature?: string } };
  };
  contentBlockStop?: { contentBlockIndex?: number };
  messageStop?: { stopReason?: string };
  metadata?: { usage?: Usage };
};

const textOf = (content: OpenAIMessage["content"]) =>
  typeof content === "string" ? content : (content ?? []).map((p) => p.text ?? "").join("");

function parseInput(args: OpenAIToolCall["function"]["arguments"]): unknown {
  if (typeof args !== "string") return args ?? {};
  try {
    const value = JSON.parse(args || "{}");
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value : { value };
  } catch {
    return { raw: args };
  }
}

export function toConverse(body: OpenAIRequest) {
  const system: { text: string }[] = [];
  const turns: Turn[] = [];
  const push = (role: Turn["role"], blocks: Block[]) => {
    if (!blocks.length) blocks = [{ text: "(empty)" }];
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.content.push(...blocks);
    else turns.push({ role, content: blocks });
  };
  for (const m of body.messages) {
    const text = textOf(m.content);
    if (m.role === "system") {
      if (text) system.push({ text });
    } else if (m.role === "tool") {
      push("user", [{ toolResult: { toolUseId: m.tool_call_id ?? "", content: [{ text: text || "(no output)" }] } }]);
    } else if (m.role === "assistant") {
      const blocks: Block[] = text ? [{ text }] : [];
      for (const c of m.tool_calls ?? []) {
        const name = c.function.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64) || "_";
        blocks.push({ toolUse: { toolUseId: c.id, name, input: parseInput(c.function.arguments) } });
      }
      const reasoning = (m.reasoning_details ?? []).flatMap((d): Block[] => {
        if (d.type === "reasoning.encrypted") return [{ reasoningContent: { redactedContent: Buffer.from(d.data, "base64") } }];
        if (d.type !== "reasoning.text" || (!d.text && !d.signature)) return [];
        return [{ reasoningContent: { reasoningText: d.signature ? { text: d.text, signature: d.signature } : { text: d.text } } }];
      });
      push("assistant", reasoning.length ? [...reasoning, ...(blocks.length ? blocks : [{ text: "(empty)" }])] : blocks);
    } else {
      push("user", [{ text: text || "(empty)" }]);
    }
  }
  if (turns.length && turns[0].role !== "user") turns.unshift({ role: "user", content: [{ text: "(start)" }] });
  for (const t of turns) {
    const results = t.content.filter((b) => "toolResult" in b);
    if (results.length && results.length < t.content.length) t.content = [...results, ...t.content.filter((b) => !("toolResult" in b))];
  }
  const toolConfig = body.tools?.length
    ? {
        tools: body.tools.map((t) => ({
          toolSpec: {
            name: t.function.name,
            description: t.function.description || t.function.name,
            inputSchema: { json: t.function.parameters ?? { type: "object", properties: {} } },
          },
        })),
      }
    : undefined;
  return { system, messages: turns, toolConfig };
}

function checkStop(stopReason: string | undefined, model: string) {
  if (stopReason === "model_context_window_exceeded") {
    throw Object.assign(new Error(`the conversation exceeds the maximum context length of ${model}`), {
      name: "ContextWindowExceeded",
      status: 400,
    });
  }
}

export function usageOf(usage: Usage = {}) {
  const read = usage.cacheReadInputTokens ?? 0;
  const write = usage.cacheWriteInputTokens ?? 0;
  return {
    prompt_tokens: (usage.inputTokens ?? 0) + read + write,
    completion_tokens: usage.outputTokens ?? 0,
    total_tokens: usage.totalTokens ?? 0,
    prompt_tokens_details: { cached_tokens: read, cache_write_tokens: write },
  };
}

export function fromConverse(out: ConverseOutput, model: string) {
  checkStop(out.stopReason, model);
  const blocks = out.output?.message?.content ?? [];
  const text = blocks.map((b) => (typeof b.text === "string" ? b.text : "")).join("");
  const toolCalls = blocks.flatMap((b) => {
    const use = b.toolUse as { toolUseId: string; name: string; input: unknown } | undefined;
    return use ? [{ id: use.toolUseId, type: "function", function: { name: use.name, arguments: JSON.stringify(use.input ?? {}) } }] : [];
  });
  const details = blocks.flatMap((b): ReasoningDetail[] => {
    const r = (b as { reasoningContent?: ReasoningContent }).reasoningContent;
    if (r?.reasoningText) {
      const { text = "", signature } = r.reasoningText;
      return [signature ? { type: "reasoning.text", text, signature } : { type: "reasoning.text", text }];
    }
    return r?.redactedContent ? [{ type: "reasoning.encrypted", data: Buffer.from(r.redactedContent).toString("base64") }] : [];
  });
  const reasoning = details.map((d) => (d.type === "reasoning.text" ? d.text : "")).join("");
  const extra = { ...(reasoning ? { reasoning } : {}), ...(details.length ? { reasoning_details: details } : {}) };
  const finish = out.stopReason === "max_tokens" ? "length" : toolCalls.length ? "tool_calls" : "stop";
  return {
    id: `bedrock-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: toolCalls.length
          ? { role: "assistant", content: text || null, tool_calls: toolCalls, ...extra }
          : { role: "assistant", content: text, ...extra },
        finish_reason: finish,
      },
    ],
    usage: usageOf(out.usage),
  };
}

export function streamConverter(model: string) {
  const id = `bedrock-${Date.now()}`;
  const tools = new Map<number, number>();
  const reasoning = new Map<number, number>();
  const redacted = new Map<number, Uint8Array[]>();
  const seen: { stopReason?: string; usage?: Usage; reasoning: number } = { reasoning: 0 };
  const chunk = (delta: object, finish_reason: string | null = null) => ({
    id,
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason }],
  });
  const detail = (block: number) => {
    if (!reasoning.has(block)) reasoning.set(block, reasoning.size);
    seen.reasoning = reasoning.size;
    return reasoning.get(block)!;
  };
  return {
    seen,
    push(event: StreamEvent): object[] {
      const use = event.contentBlockStart?.start?.toolUse;
      if (use) {
        const index = tools.set(event.contentBlockStart!.contentBlockIndex ?? 0, tools.size).size - 1;
        const call = { index, id: use.toolUseId, type: "function", function: { name: use.name ?? "", arguments: "" } };
        return [chunk({ tool_calls: [call] })];
      }
      if (event.contentBlockDelta) {
        const { contentBlockIndex: block = 0, delta = {} } = event.contentBlockDelta;
        if (delta.text) return [chunk({ content: delta.text })];
        const input = delta.toolUse?.input;
        if (input) return [chunk({ tool_calls: [{ index: tools.get(block) ?? 0, function: { arguments: input } }] })];
        const r = delta.reasoningContent;
        if (r?.redactedContent) {
          detail(block);
          redacted.set(block, [...(redacted.get(block) ?? []), r.redactedContent]);
        } else if (r) {
          const signature = r.signature ? { signature: r.signature } : {};
          const part = { type: "reasoning.text", index: detail(block), text: r.text ?? "", ...signature };
          return [chunk({ ...(r.text ? { reasoning: r.text } : {}), reasoning_details: [part] })];
        }
        return [];
      }
      const stopped = event.contentBlockStop?.contentBlockIndex ?? 0;
      if (event.contentBlockStop && redacted.has(stopped)) {
        const data = Buffer.concat(redacted.get(stopped)!).toString("base64");
        redacted.delete(stopped);
        return [chunk({ reasoning_details: [{ type: "reasoning.encrypted", index: reasoning.get(stopped), data }] })];
      }
      if (event.messageStop) seen.stopReason = event.messageStop.stopReason;
      if (event.metadata) seen.usage = event.metadata.usage;
      return [];
    },
    end(): object[] {
      checkStop(seen.stopReason, model);
      if (!seen.stopReason) throw Object.assign(new Error("the Bedrock stream ended without a stop reason"), { name: "StreamEnded" });
      const finish = seen.stopReason === "max_tokens" ? "length" : tools.size ? "tool_calls" : "stop";
      return [chunk({}, finish), { id, object: "chat.completion.chunk", model, choices: [], usage: usageOf(seen.usage) }];
    },
  };
}
