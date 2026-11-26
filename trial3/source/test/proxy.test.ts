import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { CLIENT_CONFIG, converseInput, effortFields, handler } from "../bedrock/proxy.mjs";

const request = (model: string, extra: object = {}) =>
  converseInput({ model, messages: [{ role: "user", content: "hi" }], ...extra });

describe("effortFields", () => {
  test("sends Claude models output_config.effort, with or without a profile prefix", () => {
    for (const model of ["us.anthropic.claude-opus-5-5", "global.anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-5-5"]) {
      assert.deepEqual(effortFields(model, "max"), { output_config: { effort: "max" } });
    }
  });

  test("sends OpenAI models reasoning.effort", () => {
    assert.deepEqual(effortFields("us.openai.gpt-6.2-sol", "high"), { reasoning: { effort: "high" } });
  });

  test("sends Grok reasoning.effort", () => {
    assert.deepEqual(effortFields("us.xai.grok-4.7", "max"), { reasoning: { effort: "max" } });
  });

  test("sends GPT-OSS, Kimi and GLM a top-level reasoning_effort", () => {
    for (const model of ["openai.gpt-oss-120b-1:0", "moonshotai.kimi-k2.5", "zai.glm-5"]) {
      assert.deepEqual(effortFields(model, "high"), { reasoning_effort: "high" });
    }
  });

  test("rejects models it can't map", () => {
    assert.throws(() => effortFields("qwen.qwen3-coder-480b-a35b-v1:0", "high"), { name: "UnsupportedEffort" });
    assert.throws(() => effortFields("us.meta.llama4-maverick-17b-instruct-v1:0", "max"), { name: "UnsupportedEffort" });
  });
});

describe("converseInput", () => {
  test("asks for each model's largest output unless the request sets a limit", () => {
    assert.deepEqual(request("us.anthropic.claude-opus-5-5").inferenceConfig, { maxTokens: 128000 });
    assert.deepEqual(request("openai.gpt-oss-20b-1:0").inferenceConfig, { maxTokens: 128000 });
    assert.deepEqual(request("us.xai.grok-4.7").inferenceConfig, { maxTokens: 524288 });
    assert.equal(request("us.meta.llama4-maverick-17b-instruct-v1:0").inferenceConfig, undefined);
    assert.deepEqual(request("us.anthropic.claude-opus-5-5", { max_tokens: 4096 }).inferenceConfig, { maxTokens: 4096 });
  });

  test("reserves at most 64,000 output tokens when the model shares its window with the output", () => {
    const glm = (chars: number) => converseInput({ model: "zai.glm-5", messages: [{ role: "user", content: "x".repeat(chars) }] });
    assert.equal(request("zai.glm-5").inferenceConfig!.maxTokens, 64000);
    assert.equal(glm(250000).inferenceConfig!.maxTokens, 64000);
    assert.ok(glm(300000).inferenceConfig!.maxTokens! < 64000);
  });

  test("adds no model-specific fields without reasoning_effort", () => {
    assert.equal(request("us.anthropic.claude-opus-5-5").additionalModelRequestFields, undefined);
  });

  test("puts reasoning_effort in the model's own field", () => {
    assert.deepEqual(request("us.anthropic.claude-opus-5-5", { reasoning_effort: "max" }).additionalModelRequestFields, {
      output_config: { effort: "max" },
    });
    assert.deepEqual(request("us.openai.gpt-6.2-sol", { reasoning_effort: "max" }).additionalModelRequestFields, {
      reasoning: { effort: "max" },
    });
  });

  test("rejects reasoning_effort for a model it can't map", () => {
    assert.throws(() => request("us.meta.llama4-maverick-17b-instruct-v1:0", { reasoning_effort: "max" }), {
      name: "UnsupportedEffort",
    });
  });
});

type Event = Record<string, unknown>;
type Script = (Event | number | Error)[];
let scripts: Script[] = [];
let inputs: { messages: unknown[] }[] = [];

async function* bedrock(events: Script, signal: AbortSignal) {
  for (const e of events) {
    if (typeof e === "number") await sleep(e, undefined, { signal });
    else if (e instanceof Error) throw e;
    else yield e;
  }
}

const server = http.createServer(
  handler({
    converse: async (input: { messages: unknown[] }) => {
      inputs.push(input);
      return { output: { message: { content: [{ text: "whole" }] } }, stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 1 } };
    },
    converseStream: async (input: { messages: unknown[] }, signal: AbortSignal) => {
      inputs.push(input);
      const events = scripts.shift() ?? [];
      while (typeof events[0] === "number") await sleep(events.shift() as number, undefined, { signal });
      return { stream: bedrock(events, signal) };
    },
    keepaliveMs: 100,
    stallMs: 400,
  }),
);
let url = "";
let keel: typeof import("../agent.ts");

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.BASE_URL = url;
  process.env.MODEL = "us.anthropic.claude-haiku-5-5";
  process.env.RETRY_DELAY_MS = "1";
  console.error = () => {};
  keel = await import("../agent.ts");
});

after(() => server.close());

async function post(body: object, script: Script = []) {
  scripts = [script];
  inputs = [];
  const started = performance.now();
  const res = await fetch(`${url}/chat/completions`, { method: "POST", body: JSON.stringify(body) });
  const headersAfter = performance.now() - started;
  return { type: res.headers.get("content-type"), status: res.status, headersAfter, text: await res.text() };
}

const lastEvent = (text: string) => JSON.parse(text.trim().split("\n").at(-1)!.slice(6));

const ask = { model: "us.anthropic.claude-haiku-5-5", messages: [{ role: "user", content: "hi" }] };
const text = (t: string) => ({ contentBlockDelta: { contentBlockIndex: 0, delta: { text: t } } });
const stopped = (stopReason: string) => [{ messageStop: { stopReason } }, { metadata: { usage: { inputTokens: 5, outputTokens: 2 } } }];

describe("Bedrock client", () => {
  test("waits 30 minutes for Bedrock, not the SDK's 5, and keeps one request per HTTP/2 session", () => {
    assert.deepEqual(CLIENT_CONFIG, {
      maxAttempts: 8,
      requestHandler: { requestTimeout: 1_800_000, sessionTimeout: 1_800_000, disableConcurrentStreams: true },
    });
  });
});

describe("proxy server", () => {
  test("answers a request without stream: true with one JSON reply", async () => {
    const res = await post(ask);
    assert.equal(res.type, "application/json");
    assert.equal(JSON.parse(res.text).choices[0].message.content, "whole");
  });

  test("streams server-sent events that end with the usage and [DONE]", async () => {
    const res = await post({ ...ask, stream: true }, [text("Hel"), text("lo"), ...stopped("end_turn")]);
    assert.equal(res.type, "text/event-stream");
    const lines = res.text.split("\n").filter((l) => l.startsWith("data: "));
    assert.equal(lines.at(-1), "data: [DONE]");
    const chunks = lines.slice(0, -1).map((l) => JSON.parse(l.slice(6)));
    assert.deepEqual(chunks.map((c) => c.choices[0]?.delta.content), ["Hel", "lo", undefined, undefined]);
    assert.equal(chunks.at(-1).usage.prompt_tokens, 5);
  });

  test("sends the headers at once, then keepalive comments while Bedrock is quiet", async () => {
    const res = await post({ ...ask, stream: true }, [250, text("late"), ...stopped("end_turn")]);
    assert.ok(res.headersAfter < 80, `headers after ${res.headersAfter} ms`);
    assert.ok(res.text.startsWith(": keepalive\n\n: keepalive\n\ndata: "));
  });

  test("gives up with a timeout error when Bedrock sends nothing for too long", async () => {
    for (const script of [[2000, text("late")], [text("early"), 2000, text("late")]]) {
      const res = await post({ ...ask, stream: true }, script);
      assert.deepEqual(lastEvent(res.text), { error: { message: "TimeoutError: no data from Bedrock for 0.4 seconds", code: 500 } });
    }
  });

  test("sends an error event with a client status when the reply overflows the context window", async () => {
    const res = await post({ ...ask, stream: true }, [text("partial"), ...stopped("model_context_window_exceeded")]);
    const last = lastEvent(res.text);
    assert.equal(last.error.code, 400);
    assert.match(last.error.message, /^ContextWindowExceeded: .*maximum context length/);
    assert.ok(!res.text.includes("[DONE]"));
  });

  test("sends an error event with a server status when Bedrock fails mid-stream", async () => {
    const failure = Object.assign(new Error("try again"), { name: "ModelStreamErrorException" });
    const res = await post({ ...ask, stream: true }, [text("partial"), failure]);
    assert.deepEqual(lastEvent(res.text), { error: { message: "ModelStreamErrorException: try again", code: 500 } });
  });

  test("rejects a request it can't translate before streaming starts", async () => {
    const res = await post({ ...ask, model: "us.meta.llama4-maverick-17b-instruct-v1:0", stream: true, reasoning_effort: "max" });
    assert.equal(res.type, "application/json");
    assert.match(JSON.parse(res.text).error.message, /^UnsupportedEffort/);
  });
});

describe("Keel through the proxy", () => {
  const tool = [
    { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { text: "" } } } },
    { contentBlockDelta: { contentBlockIndex: 0, delta: { reasoningContent: { signature: "sig" } } } },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { contentBlockStart: { contentBlockIndex: 1, start: { toolUse: { toolUseId: "t1", name: "bash" } } } },
    { contentBlockDelta: { contentBlockIndex: 1, delta: { toolUse: { input: '{"command":"echo hi"}' } } } },
    { contentBlockStop: { contentBlockIndex: 1 } },
    ...stopped("tool_use"),
  ];

  test("replays hidden reasoning with its signature on the next request", async () => {
    scripts = [tool, [text("Done."), ...stopped("end_turn")]];
    inputs = [];
    assert.equal(await keel.agent(keel.nativeAdapter("us.anthropic.claude-haiku-5-5"), "task", 2), "stopped: step limit reached");
    assert.deepEqual((inputs[1].messages[1] as { content: unknown[] }).content, [
      { reasoningContent: { reasoningText: { text: "", signature: "sig" } } },
      { toolUse: { toolUseId: "t1", name: "bash", input: { command: "echo hi" } } },
    ]);
  });

  test("stops without a retry when the conversation overflows the context window", async () => {
    scripts = [[text("partial"), ...stopped("model_context_window_exceeded")]];
    inputs = [];
    const result = await keel.agent(keel.nativeAdapter("us.anthropic.claude-haiku-5-5"), "task");
    assert.match(result, /^stopped: the model request failed: 400 .*maximum context length of us\.anthropic\.claude-haiku-5-5/);
    assert.equal(inputs.length, 1);
  });
});
