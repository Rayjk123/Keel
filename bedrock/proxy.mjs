// Throwaway proxy: serves OpenAI-style /chat/completions, tool calls included, and forwards to AWS Bedrock Converse.
import { realpathSync } from "node:fs";
import http from "node:http";
import { fileURLToPath } from "node:url";
import { fromConverse, streamConverter, toConverse } from "./convert.ts";

const HOST = process.env.PROXY_HOST || "127.0.0.1";
const PORT = Number(process.env.PORT ?? 8787);
const MAX_TOKENS = process.env.MAX_TOKENS ? Number(process.env.MAX_TOKENS) : undefined;
const STALL_MS = Number(process.env.STALL_MS ?? 1_800_000);
export const CLIENT_CONFIG = {
  maxAttempts: 8,
  requestHandler: { requestTimeout: STALL_MS, sessionTimeout: STALL_MS, disableConcurrentStreams: true },
};
const OUTPUT_LIMITS = [["anthropic.", 128000], ["openai.", 128000], ["xai.", 524288]];
const CONTEXT_WINDOWS = [
  ["qwen.qwen3-coder-30b", 262144],
  ["qwen.qwen3-coder-480b", 131072],
  ["moonshotai.kimi-k2.5", 262144],
  ["zai.glm", 202752],
];

export function outputLimit(model, request) {
  const fixed = OUTPUT_LIMITS.find(([id]) => model.includes(id));
  if (fixed) return fixed[1];
  const window = CONTEXT_WINDOWS.find(([id]) => model.includes(id));
  return window && Math.max(1, window[1] - Math.ceil(JSON.stringify(request).length / 2));
}

export function effortFields(model, effort) {
  if (model.includes("anthropic.")) return { output_config: { effort } };
  if (["openai.gpt-oss", "moonshotai.", "zai."].some((id) => model.includes(id))) return { reasoning_effort: effort };
  if (model.includes("openai.") || model.includes("xai.")) return { reasoning: { effort } };
  throw Object.assign(new Error(`reasoning_effort is not supported for ${model}`), { name: "UnsupportedEffort" });
}

export function converseInput(body) {
  const { system, messages, toolConfig } = toConverse(body);
  const maxTokens = body.max_tokens ?? MAX_TOKENS ?? outputLimit(body.model, { system, messages, toolConfig });
  return {
    modelId: body.model,
    system: system.length ? system : undefined,
    messages,
    toolConfig,
    inferenceConfig: maxTokens ? { maxTokens } : undefined,
    additionalModelRequestFields: body.reasoning_effort ? effortFields(body.model, body.reasoning_effort) : undefined,
  };
}

const reasoningBlocks = (turns) => turns.flatMap((t) => t.content ?? []).filter((b) => b.reasoningContent).length;

function log(body, input, usage = {}, stop, reasoning) {
  console.error(
    `${new Date().toISOString()} ${body.model} effort=${body.reasoning_effort ?? "default"} ` +
      `in=${usage.inputTokens} out=${usage.outputTokens} cache_read=${usage.cacheReadInputTokens ?? 0} ` +
      `cache_write=${usage.cacheWriteInputTokens ?? 0} stop=${stop} reasoning=${reasoning} replayed=${reasoningBlocks(input.messages)}`,
  );
}

async function complete(converse, body) {
  const input = converseInput(body);
  const out = await converse(input);
  log(body, input, out.usage, out.stopReason, reasoningBlocks([out.output?.message ?? {}]));
  return fromConverse(out, body.model);
}

async function stream(converseStream, body, res, keepaliveMs, stallMs) {
  const input = converseInput(body);
  const abort = new AbortController();
  res.on("close", () => abort.abort());
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }).flushHeaders();
  let heard = Date.now();
  const stalled = Object.assign(new Error(`no data from Bedrock for ${stallMs / 1000} seconds`), { name: "TimeoutError" });
  const keepalive = setInterval(() => {
    if (Date.now() - heard > stallMs) abort.abort(stalled);
    res.write(": keepalive\n\n");
  }, keepaliveMs);
  const convert = streamConverter(body.model);
  const send = (chunks) => chunks.forEach((c) => res.write(`data: ${JSON.stringify(c)}\n\n`));
  try {
    const out = await converseStream(input, abort.signal);
    for await (const event of out.stream) {
      heard = Date.now();
      send(convert.push(event));
    }
    send(convert.end());
    res.write("data: [DONE]\n\n");
  } catch (e) {
    const err = abort.signal.reason === stalled ? stalled : e;
    console.error(`error: ${err.name}: ${err.message}`);
    send([{ error: { message: `${err.name}: ${err.message}`, code: err.status ?? 500 } }]);
  } finally {
    clearInterval(keepalive);
    if (convert.seen.usage) log(body, input, convert.seen.usage, convert.seen.stopReason, convert.seen.reasoning);
    res.end();
  }
}

export function handler({ converse, converseStream, keepaliveMs = 15000, stallMs = STALL_MS }) {
  return async (req, res) => {
    if (req.method !== "POST" || !req.url.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("Connection", "close");
    try {
      const body = JSON.parse(raw);
      if (body.stream) return await stream(converseStream, body, res, keepaliveMs, stallMs);
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(await complete(converse, body)));
    } catch (e) {
      console.error(`error: ${e.name}: ${e.message}`);
      const error = { error: { message: `${e.name}: ${e.message}` } };
      res.writeHead(e.status ?? 500, { "Content-Type": "application/json" }).end(JSON.stringify(error));
    }
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");
  const client = new BedrockRuntimeClient(CLIENT_CONFIG);
  const converse = (input) => client.send(new ConverseCommand(input));
  const converseStream = (input, abortSignal) => client.send(new ConverseStreamCommand(input), { abortSignal });
  http
    .createServer(handler({ converse, converseStream }))
    .listen(PORT, HOST, () => console.error(`bedrock proxy on http://${HOST}:${PORT}/v1`));
}
