// Throwaway proxy: serves OpenAI-style /chat/completions, tool calls included, and forwards to AWS Bedrock Converse.
import { realpathSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { fromConverse, toConverse } from "./convert.ts";

const HOST = process.env.PROXY_HOST || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const MAX_TOKENS = Number(process.env.MAX_TOKENS ?? 8192);

export function effortFields(model, effort) {
  if (model.includes("anthropic.")) return { output_config: { effort } };
  if (["openai.gpt-oss", "moonshotai.", "zai."].some((id) => model.includes(id))) return { reasoning_effort: effort };
  if (model.includes("openai.") || model.includes("xai.")) return { reasoning: { effort } };
  throw Object.assign(new Error(`reasoning_effort is not supported for ${model}`), { name: "UnsupportedEffort" });
}

export function converseInput(body) {
  const { system, messages, toolConfig } = toConverse(body);
  return {
    modelId: body.model,
    system: system.length ? system : undefined,
    messages,
    toolConfig,
    inferenceConfig: { maxTokens: body.max_tokens ?? MAX_TOKENS },
    additionalModelRequestFields: body.reasoning_effort ? effortFields(body.model, body.reasoning_effort) : undefined,
  };
}

async function complete(send, body) {
  const out = await send(converseInput(body));
  const usage = out.usage ?? {};
  console.error(`${new Date().toISOString()} ${body.model} effort=${body.reasoning_effort ?? "default"} in=${usage.inputTokens} out=${usage.outputTokens} stop=${out.stopReason}`);
  return fromConverse(out, body.model);
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
