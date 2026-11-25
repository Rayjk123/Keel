// Translates OpenAI-style chat requests, including tool calls, to Bedrock Converse and back.
type OpenAIToolCall = { id: string; type?: string; function: { name: string; arguments: string | Record<string, unknown> } };
type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | { text?: string }[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
};
type OpenAITool = { type: "function"; function: { name: string; description?: string; parameters?: Record<string, unknown> } };
export type OpenAIRequest = { model: string; messages: OpenAIMessage[]; tools?: OpenAITool[]; max_tokens?: number };

type Block =
  | { text: string }
  | { toolUse: { toolUseId: string; name: string; input: unknown } }
  | { toolResult: { toolUseId: string; content: { text: string }[]; status?: "success" | "error" } };
type Turn = { role: "user" | "assistant"; content: Block[] };

export type ConverseOutput = {
  output?: { message?: { content?: ({ text?: string; toolUse?: { toolUseId: string; name: string; input: unknown } } | Record<string, unknown>)[] } };
  stopReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
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
        blocks.push({ toolUse: { toolUseId: c.id, name: c.function.name, input: parseInput(c.function.arguments) } });
      }
      push("assistant", blocks);
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

export function fromConverse(out: ConverseOutput, model: string) {
  const blocks = out.output?.message?.content ?? [];
  const text = blocks.map((b) => (typeof b.text === "string" ? b.text : "")).join("");
  const toolCalls = blocks.flatMap((b) => {
    const use = b.toolUse as { toolUseId: string; name: string; input: unknown } | undefined;
    return use ? [{ id: use.toolUseId, type: "function", function: { name: use.name, arguments: JSON.stringify(use.input ?? {}) } }] : [];
  });
  const usage = out.usage ?? {};
  const finish = out.stopReason === "max_tokens" ? "length" : toolCalls.length ? "tool_calls" : "stop";
  return {
    id: `bedrock-${Date.now()}`,
    object: "chat.completion",
    model,
    choices: [
      {
        index: 0,
        message: toolCalls.length ? { role: "assistant", content: text || null, tool_calls: toolCalls } : { role: "assistant", content: text },
        finish_reason: finish,
      },
    ],
    usage: {
      prompt_tokens: usage.inputTokens ?? 0,
      completion_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
    },
  };
}
