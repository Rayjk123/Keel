// Throwaway proxy: serves OpenAI-style /chat/completions and forwards to AWS Bedrock Converse.
import { realpathSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";

const HOST = process.env.PROXY_HOST || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 8192);

function toConverse(messages) {
  const system = [];
  const turns = [];
  for (const m of messages) {
    const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((p) => p.text ?? "").join("");
    if (m.role === "system") {
      system.push({ text });
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.parts.push(text || "(empty)");
    else turns.push({ role, parts: [text || "(empty)"] });
  }
  if (turns.length && turns[0].role !== "user") turns.unshift({ role: "user", parts: ["(start)"] });
  return {
    system,
    messages: turns.map((t) => ({ role: t.role, content: [{ text: t.parts.join("\n\n") }] })),
  };
}

export function effortFields(model, effort) {
  if (model.includes("anthropic.")) return { output_config: { effort } };
  if (model.includes("openai.")) return { reasoning: { effort } };
  throw Object.assign(new Error(`reasoning_effort is not supported for ${model}`), { name: "UnsupportedEffort" });
}

export function converseInput(body) {
  const { system, messages } = toConverse(body.messages);
  return {
    modelId: body.model,
    system: system.length ? system : undefined,
    messages,
    inferenceConfig: { maxTokens: body.max_tokens ?? MAX_TOKENS },
    additionalModelRequestFields: body.reasoning_effort ? effortFields(body.model, body.reasoning_effort) : undefined,
  };
}

async function complete(send, body) {
  const out = await send(converseInput(body));
  const content = (out.output?.message?.content ?? []).map((b) => b.text ?? "").join("");
  const usage = out.usage ?? {};
  console.error(`${new Date().toISOString()} ${body.model} effort=${body.reasoning_effort ?? "default"} in=${usage.inputTokens} out=${usage.outputTokens} stop=${out.stopReason}`);
  return {
    id: `bedrock-${Date.now()}`,
    object: "chat.completion",
    model: body.model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content },
        finish_reason: out.stopReason === "max_tokens" ? "length" : "stop",
      },
    ],
    usage: {
      prompt_tokens: usage.inputTokens ?? 0,
      completion_tokens: usage.outputTokens ?? 0,
      total_tokens: usage.totalTokens ?? 0,
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient({ maxAttempts: 8 });
  const send = (input) => client.send(new ConverseCommand(input));
  http
    .createServer(async (req, res) => {
      if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
        res.writeHead(404).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) raw += chunk;
      res.setHeader("Connection", "close");
      try {
        const result = await complete(send, JSON.parse(raw));
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(result));
      } catch (e) {
        console.error(`error: ${e.name}: ${e.message}`);
        res.writeHead(500, { "Content-Type": "application/json" }).end(JSON.stringify({ error: { message: `${e.name}: ${e.message}` } }));
      }
    })
    .listen(PORT, HOST, () => console.error(`bedrock proxy on http://${HOST}:${PORT}/v1`));
}
