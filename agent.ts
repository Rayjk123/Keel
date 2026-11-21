// The smallest agent loop: no SDK, no dependencies, just fetch and a bash tool.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

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
};

type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

interface Adapter {
  toWire(messages: Message[], tools: ToolDef[]): unknown;
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
      const msg = (response as { choices: { message: ChatMessage }[] }).choices[0].message;
      const content = msg.content ?? "";
      const commands = [...content.matchAll(COMMAND_BLOCK)].map((match) => match[1]);
      const text = content.replace(COMMAND_BLOCK, "").trim();
      const parts: Part[] = [];
      if (text) parts.push({ type: "text", text });
      if (commands.length === 1) {
        parts.push({ type: "tool_call", id: `text_call_${nextCallId++}`, name: "bash", args: { command: commands[0] } });
      }
      return { role: "assistant", parts, provider: PROVIDER, raw: msg };
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
const NO_COMMAND = `No bash command found in your response. Every response MUST include EXACTLY ONE fenced \`\`\`bash block containing your command.

${FINISH_RULE}`;
const MAX_CONSECUTIVE_NO_COMMAND = 3;

class Submitted {
  summary: string;
  constructor(summary: string) {
    this.summary = summary;
  }
}

const TOOLS: ToolDef[] = [
  {
    name: "bash",
    description: "Run a bash command in the working directory. Returns exit code, stdout and stderr.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
  },
];

async function chat(adapter: Adapter, messages: Message[]): Promise<Message> {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}`, Connection: "close" },
    body: JSON.stringify(adapter.toWire(messages, TOOLS)),
    signal: AbortSignal.timeout(600_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return adapter.fromWire(await res.json());
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

function runTool(call: ToolCallPart): Part {
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

export async function agent(adapter: Adapter, task: string, maxSteps = 50): Promise<string> {
  const messages: Message[] = [
    { role: "system", parts: [{ type: "text", text: SYSTEM }] },
    { role: "user", parts: [{ type: "text", text: task }] },
  ];
  let noCommandStreak = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      const msg = await chat(adapter, messages);
      const calls = toolCallsOf(msg.parts);
      if (calls.length) {
        noCommandStreak = 0;
        messages.push(msg);
        messages.push({ role: "tool", parts: calls.map(runTool) });
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!MODEL) {
    console.error("set MODEL to the model name your server serves");
    process.exit(1);
  }
  agent(textAdapter(MODEL), process.argv.slice(2).join(" ")).then(console.log);
}
