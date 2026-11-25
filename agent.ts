// A small agent loop: no SDK, no dependencies, just fetch, a few tools and two ways to talk to the model.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { TOOLS, runTool, type ToolDef } from "./tools.ts";

type Part =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "tool_result"; callId: string; output: string; isError?: boolean }
  | { type: "reasoning"; text?: string; opaque?: unknown };

type Message = {
  role: "system" | "user" | "assistant" | "tool";
  parts: Part[];
  provider?: string;
  raw?: unknown;
  finish?: string;
};

export interface Adapter {
  native: boolean;
  toWire(messages: Message[], tools: ToolDef[]): object;
  fromWire(response: unknown): Message;
}

type ToolCallPart = Extract<Part, { type: "tool_call" }>;
type TextPart = Extract<Part, { type: "text" }>;

const textOf = (parts: Part[]) =>
  parts
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("");

const toolCallsOf = (parts: Part[]) => parts.filter((p): p is ToolCallPart => p.type === "tool_call");

type ChatMessage = { role: "system" | "user" | "assistant"; content: string | null };

const COMMAND_BLOCK = /```bash\s*\n([\s\S]*?)\n```/g;

export function textAdapter(model: string): Adapter {
  const PROVIDER = "text-fenced";
  let nextCallId = 0;
  return {
    native: false,
    toWire(messages) {
      const wire: ChatMessage[] = messages.map((m) => {
        if (m.role === "tool") {
          const outputs = m.parts.flatMap((p) => (p.type === "tool_result" ? [p.output] : []));
          return { role: "user", content: outputs.join("\n") };
        }
        const blocks = toolCallsOf(m.parts).map(
          (c) => "```bash\n" + (c.args as { command: string }).command + "\n```",
        );
        return { role: m.role, content: [textOf(m.parts), ...blocks].filter(Boolean).join("\n\n") };
      });
      return { model, messages: wire };
    },

    fromWire(response) {
      const choice = (response as { choices: { message: ChatMessage; finish_reason?: string }[] }).choices[0];
      const msg = choice.message;
      const content = msg.content ?? "";
      const commands = [...content.matchAll(COMMAND_BLOCK)].map((match) => match[1]);
      const text = content.replace(COMMAND_BLOCK, "").trim();
      const parts: Part[] = [];
      if (text) parts.push({ type: "text", text });
      if (commands.length === 1) {
        parts.push({ type: "tool_call", id: `text_call_${nextCallId++}`, name: "bash", args: { command: commands[0] } });
      }
      return { role: "assistant", parts, provider: PROVIDER, raw: msg, finish: choice.finish_reason };
    },
  };
}

type WireToolCall = { id?: string; type?: string; function: { name: string; arguments: unknown } };
type NativeWireMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: WireToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export class BadArguments {
  raw: string;
  reason: string;
  constructor(raw: string, reason: string) {
    this.raw = raw;
    this.reason = reason;
  }
}

function parseArguments(raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === "") return {};
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return new BadArguments(raw, (e as Error).message);
  }
}

export function nativeAdapter(model: string): Adapter {
  const PROVIDER = "openai-tools";
  let nextCallId = 0;
  return {
    native: true,
    toWire(messages, tools) {
      const wire: NativeWireMessage[] = messages.flatMap((m): NativeWireMessage[] => {
        if (m.role === "tool") {
          return m.parts.flatMap((p): NativeWireMessage[] =>
            p.type === "tool_result" ? [{ role: "tool", tool_call_id: p.callId, content: p.output }] : [],
          );
        }
        if (m.role === "assistant") {
          const calls = toolCallsOf(m.parts).map((c) => ({
            id: c.id,
            type: "function",
            function: {
              name: c.name,
              arguments: c.args instanceof BadArguments ? c.args.raw : JSON.stringify(c.args ?? {}),
            },
          }));
          const text = textOf(m.parts);
          return [calls.length ? { role: "assistant", content: text || null, tool_calls: calls } : { role: "assistant", content: text }];
        }
        return [{ role: m.role, content: textOf(m.parts) }];
      });
      return {
        model,
        messages: wire,
        tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } })),
      };
    },

    fromWire(response) {
      const choice = (
        response as { choices: { message: { content?: string | null; tool_calls?: WireToolCall[] }; finish_reason?: string }[] }
      ).choices[0];
      const msg = choice.message;
      const parts: Part[] = [];
      const text = (msg.content ?? "").trim();
      if (text) parts.push({ type: "text", text });
      for (const call of msg.tool_calls ?? []) {
        parts.push({
          type: "tool_call",
          id: call.id || `call_${nextCallId++}`,
          name: (call.function?.name ?? "").split(/[<"'\s]/)[0],
          args: parseArguments(call.function?.arguments),
        });
      }
      return { role: "assistant", parts, provider: PROVIDER, raw: msg, finish: choice.finish_reason };
    },
  };
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8000/v1";
const MODEL = process.env.MODEL;
const API_KEY = process.env.API_KEY ?? "none";
const DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";
const FINISH_RULE =
  "When the task is done, write a short summary of what you did, and reply with a bash block containing " +
  `exactly this command: \`echo ${DONE}\`. Do not combine it with any other command. ` +
  "After this command, you cannot continue working on this task.";
const SYSTEM = `You are a coding agent working in the current directory. You can execute bash commands and edit files.

Each response must include:
1. Reasoning text explaining your analysis and plan
2. EXACTLY ONE bash command, in a fenced code block tagged bash

CRITICAL REQUIREMENTS:
- Your response MUST include exactly one \`\`\`bash block. The system runs it and shows you the output.
- Every command runs in a new subshell, so directory and environment variable changes do not persist. Prefix commands instead, e.g. \`cd /path/to/dir && ...\`.
- ${FINISH_RULE}

Example of a CORRECT response:
<example_response>
I need to understand the structure of the repository first. Let me list the files in the current directory.

\`\`\`bash
ls -la
\`\`\`
</example_response>`;
const NATIVE_SYSTEM = `You are a coding agent working in the current directory. You complete the task on your own: nobody will answer questions, so make reasonable choices and keep going.

Use the tools to explore, change files, run programs and check your work:
- read to look at a file, and bash for everything else you need to run.
- edit to change part of a file, patch to change several places or files at once, and write to create a file or replace one completely.
- You can call several tools in one reply when they don't depend on each other.

Work like a careful developer: look around first, make the change, then run it or its tests to confirm it works.

When the task is done, reply without calling a tool, with a short summary of what you did.`;
const CONFIRM_DONE =
  "You replied without calling a tool. If the task is finished, reply once more with a short summary and no tool call. " +
  "If there is more to do, continue by calling a tool.";
const NO_COMMAND = `No bash command found in your response. Every response MUST include EXACTLY ONE fenced \`\`\`bash block containing your command.

${FINISH_RULE}`;
const MAX_CONSECUTIVE_NO_COMMAND = 3;
const CUT_OFF =
  "Your reply hit the output token limit and was cut off, so none of it was run. " +
  "Reply again more briefly: think less before acting and write large files in smaller pieces.";

class Submitted {
  summary: string;
  constructor(summary: string) {
    this.summary = summary;
  }
}

export class ModelError extends Error {}

const RETRIES = 3;
const RETRY_DELAY_MS = Number(process.env.RETRY_DELAY_MS ?? 2000);

async function chat(adapter: Adapter, messages: Message[]): Promise<Message> {
  const effort = process.env.EFFORT;
  let last = "";
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
    let res: Response;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}`, Connection: "close" },
        body: JSON.stringify({ ...adapter.toWire(messages, TOOLS), ...(effort ? { reasoning_effort: effort } : {}) }),
        signal: AbortSignal.timeout(600_000),
      });
    } catch (e) {
      const err = e as Error;
      last = `${err.name}: ${err.message}${err.cause instanceof Error ? ` (${err.cause.name}: ${err.cause.message})` : ""}`;
      console.error(`model request failed (${last}), attempt ${attempt + 1} of ${RETRIES + 1}`);
      continue;
    }
    if (res.ok) return adapter.fromWire(await res.json());
    last = `${res.status} ${(await res.text()).slice(0, 2000)}`;
    console.error(`model request failed (${last.slice(0, 200)}), attempt ${attempt + 1} of ${RETRIES + 1}`);
    if (res.status < 500 && res.status !== 429) break;
  }
  throw new ModelError(last);
}

const MAX_OUTPUT_CHARS = 10_000;

export function runBash(command: string): string {
  console.error(`$ ${command}`);
  const r = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const [firstLine, ...rest] = (r.stdout ?? "").split("\n");
  if (!r.error && r.status === 0 && firstLine.trim() === DONE) throw new Submitted(rest.join("\n").trim());
  const out = r.error ? `error: ${r.error.message}` : `exit=${r.status}\n${r.stdout}${r.stderr}`;
  return out.slice(-MAX_OUTPUT_CHARS);
}

function runTextTool(call: ToolCallPart): Part {
  const result = (output: string, isError = false): Part => ({
    type: "tool_result",
    callId: call.id,
    output,
    isError,
  });
  if (call.name !== "bash") return result(`error: unknown tool ${call.name}`, true);
  const command = (call.args as { command?: unknown } | null)?.command;
  if (typeof command !== "string") {
    return result('error: expected arguments {"command": "<string>"}', true);
  }
  return result(runBash(command));
}

function describeCall(call: ToolCallPart): string {
  const a = (call.args ?? {}) as Record<string, unknown>;
  if (call.name === "bash" && typeof a.command === "string") return `$ ${a.command}`;
  if (typeof a.path === "string") return `> ${call.name} ${a.path}`;
  if (call.name === "patch" && typeof a.patch === "string") {
    const files = [...a.patch.matchAll(/^\*\*\*\s*(?:Update|Add|Delete|Move)\s+File:\s*(.+)$/gm)].map((m) => m[1]);
    return `> patch ${files.join(", ")}`;
  }
  return `> ${call.name}`;
}

export function runNativeTool(call: ToolCallPart): Part {
  console.error(describeCall(call));
  if (call.args instanceof BadArguments) {
    return {
      type: "tool_result",
      callId: call.id,
      output: `error: the arguments for ${call.name} are not valid JSON (${call.args.reason}). Send them again as a JSON object.`,
      isError: true,
    };
  }
  const { output, isError } = runTool(call.name, call.args);
  return { type: "tool_result", callId: call.id, output, isError };
}

export async function agent(adapter: Adapter, task: string, maxSteps = 200): Promise<string> {
  try {
    return await (adapter.native ? nativeLoop(adapter, task, maxSteps) : textLoop(adapter, task, maxSteps));
  } catch (e) {
    if (e instanceof ModelError) return `stopped: the model request failed: ${e.message}`;
    throw e;
  }
}

async function nativeLoop(adapter: Adapter, task: string, maxSteps: number): Promise<string> {
  const messages: Message[] = [
    { role: "system", parts: [{ type: "text", text: NATIVE_SYSTEM }] },
    { role: "user", parts: [{ type: "text", text: task }] },
  ];
  let pending: string | undefined;
  for (let step = 0; step < maxSteps; step++) {
    const msg = await chat(adapter, messages);
    if (msg.finish === "length") {
      pending = undefined;
      messages.push({ role: "user", parts: [{ type: "text", text: CUT_OFF }] });
      continue;
    }
    messages.push(msg);
    const calls = toolCallsOf(msg.parts);
    if (calls.length) {
      pending = undefined;
      messages.push({ role: "tool", parts: calls.map(runNativeTool) });
      continue;
    }
    if (pending !== undefined) return textOf(msg.parts) || pending || "finished without a summary";
    pending = textOf(msg.parts);
    messages.push({ role: "user", parts: [{ type: "text", text: CONFIRM_DONE }] });
  }
  return "stopped: step limit reached";
}

async function textLoop(adapter: Adapter, task: string, maxSteps: number): Promise<string> {
  const messages: Message[] = [
    { role: "system", parts: [{ type: "text", text: SYSTEM }] },
    { role: "user", parts: [{ type: "text", text: task }] },
  ];
  let noCommandStreak = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      const msg = await chat(adapter, messages);
      if (msg.finish === "length") {
        messages.push({ role: "user", parts: [{ type: "text", text: CUT_OFF }] });
        continue;
      }
      const calls = toolCallsOf(msg.parts);
      if (calls.length) {
        noCommandStreak = 0;
        messages.push(msg);
        messages.push({ role: "tool", parts: calls.map(runTextTool) });
        continue;
      }
      if (++noCommandStreak >= MAX_CONSECUTIVE_NO_COMMAND) {
        return `stopped: no command in ${noCommandStreak} consecutive replies`;
      }
      messages.push({ role: "user", parts: [{ type: "text", text: NO_COMMAND }] });
    }
  } catch (e) {
    if (e instanceof Submitted) return e.summary || textOf(messages[messages.length - 1].parts);
    throw e;
  }
  return "stopped: step limit reached";
}

export function adapterFor(kind: string | undefined, model: string): Adapter {
  if (kind === undefined || kind === "" || kind === "native") return nativeAdapter(model);
  if (kind === "text") return textAdapter(model);
  throw new Error(`ADAPTER must be "native" or "text", not "${kind}"`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!MODEL) {
    console.error("set MODEL to the model name your server serves");
    process.exit(1);
  }
  const maxSteps = Number(process.env.MAX_STEPS ?? 200);
  agent(adapterFor(process.env.ADAPTER, MODEL), process.argv.slice(2).join(" "), maxSteps).then(console.log);
}
