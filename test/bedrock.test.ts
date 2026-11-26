import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fromConverse, streamConverter, toConverse, type OpenAIRequest, type StreamEvent } from "../bedrock/convert.ts";
import { readReply } from "../agent.ts";

const req = (messages: OpenAIRequest["messages"], extra: Partial<OpenAIRequest> = {}): OpenAIRequest => ({
  model: "m",
  messages,
  ...extra,
});

describe("toConverse", () => {
  test("moves system messages out and keeps user and assistant turns", () => {
    const out = toConverse(req([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]));
    assert.deepEqual(out.system, [{ text: "be brief" }]);
    assert.deepEqual(out.messages, [
      { role: "user", content: [{ text: "hi" }] },
      { role: "assistant", content: [{ text: "hello" }] },
    ]);
    assert.equal(out.toolConfig, undefined);
  });

  test("turns tool definitions into a tool config", () => {
    const out = toConverse(req([{ role: "user", content: "x" }], {
      tools: [{ type: "function", function: { name: "bash", description: "run", parameters: { type: "object", properties: {} } } }],
    }));
    assert.deepEqual(out.toolConfig, {
      tools: [{ toolSpec: { name: "bash", description: "run", inputSchema: { json: { type: "object", properties: {} } } } }],
    });
  });

  test("turns assistant tool calls into toolUse blocks after the text", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [{ id: "t1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }],
      },
    ]));
    assert.deepEqual(out.messages[1], {
      role: "assistant",
      content: [{ text: "Looking." }, { toolUse: { toolUseId: "t1", name: "bash", input: { command: "ls" } } }],
    });
  });

  test("puts reasoning blocks first, in order, with signatures and redacted bytes, before text and toolUse", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: "Looking.",
        tool_calls: [{ id: "t1", type: "function", function: { name: "bash", arguments: '{"command":"ls"}' } }],
        reasoning_details: [
          { type: "reasoning.text", text: "", signature: "sig-1" },
          { type: "reasoning.encrypted", data: "AAEC/w==" },
          { type: "reasoning.text", text: "plain" },
        ],
      },
    ]));
    assert.deepEqual(out.messages[1].content, [
      { reasoningContent: { reasoningText: { text: "", signature: "sig-1" } } },
      { reasoningContent: { redactedContent: Buffer.from([0, 1, 2, 255]) } },
      { reasoningContent: { reasoningText: { text: "plain" } } },
      { text: "Looking." },
      { toolUse: { toolUseId: "t1", name: "bash", input: { command: "ls" } } },
    ]);
  });

  test("a reply with only reasoning still has a text block after it", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      { role: "assistant", content: "", reasoning_details: [{ type: "reasoning.text", text: "hm" }] },
    ]));
    assert.deepEqual(out.messages[1].content, [{ reasoningContent: { reasoningText: { text: "hm" } } }, { text: "(empty)" }]);
  });

  test("skips thinking with neither text nor a signature", () => {
    type Details = OpenAIRequest["messages"][number]["reasoning_details"];
    const details = [{ type: "reasoning.text", text: "" }, { type: "reasoning.text", text: "kept" }] as Details;
    const out = toConverse(req([{ role: "user", content: "task" }, { role: "assistant", content: "ok", reasoning_details: details }]));
    assert.deepEqual(out.messages[1].content, [{ reasoningContent: { reasoningText: { text: "kept" } } }, { text: "ok" }]);
  });

  test("ignores reasoning details of a type it doesn't know", () => {
    const details = [{ type: "reasoning.summary", summary: "x" }] as unknown as OpenAIRequest["messages"][number]["reasoning_details"];
    const out = toConverse(req([{ role: "user", content: "task" }, { role: "assistant", content: "ok", reasoning_details: details }]));
    assert.deepEqual(out.messages[1].content, [{ text: "ok" }]);
  });

  test("replays a tool name Bedrock would reject with only the characters it accepts", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "<|channel|>", arguments: "{}" } }] },
    ]));
    assert.equal((out.messages[1].content[0] as { toolUse: { name: string } }).toolUse.name, "__channel__");
  });

  test("an assistant message with only tool calls has no empty text block", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      { role: "assistant", content: null, tool_calls: [{ id: "t1", type: "function", function: { name: "read", arguments: '{"path":"a"}' } }] },
    ]));
    assert.deepEqual(out.messages[1].content, [{ toolUse: { toolUseId: "t1", name: "read", input: { path: "a" } } }]);
  });

  test("groups consecutive tool results into one user turn", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "a", type: "function", function: { name: "bash", arguments: "{}" } },
          { id: "b", type: "function", function: { name: "bash", arguments: "{}" } },
        ],
      },
      { role: "tool", tool_call_id: "a", content: "out a" },
      { role: "tool", tool_call_id: "b", content: "" },
    ]));
    assert.equal(out.messages.length, 3);
    assert.deepEqual(out.messages[2], {
      role: "user",
      content: [
        { toolResult: { toolUseId: "a", content: [{ text: "out a" }] } },
        { toolResult: { toolUseId: "b", content: [{ text: "(no output)" }] } },
      ],
    });
  });

  test("puts tool results before any text in the same user turn", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "bash", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "a", content: "out" },
      { role: "user", content: "keep going" },
    ]));
    assert.deepEqual(out.messages[2].content, [
      { toolResult: { toolUseId: "a", content: [{ text: "out" }] } },
      { text: "keep going" },
    ]);
  });

  test("keeps arguments that are not valid JSON so the model can see them", () => {
    const out = toConverse(req([
      { role: "user", content: "task" },
      { role: "assistant", content: null, tool_calls: [{ id: "a", type: "function", function: { name: "bash", arguments: "{oops" } }] },
    ]));
    assert.deepEqual(out.messages[1].content, [{ toolUse: { toolUseId: "a", name: "bash", input: { raw: "{oops" } } }]);
  });

  test("starts with a user turn even if the history doesn't", () => {
    const out = toConverse(req([{ role: "assistant", content: "hello" }]));
    assert.equal(out.messages[0].role, "user");
  });

  test("merges consecutive plain user messages", () => {
    const out = toConverse(req([{ role: "user", content: "a" }, { role: "user", content: "b" }]));
    assert.deepEqual(out.messages, [{ role: "user", content: [{ text: "a" }, { text: "b" }] }]);
  });
});

describe("fromConverse", () => {
  test("returns plain text as an assistant message", () => {
    const out = fromConverse({ output: { message: { content: [{ text: "done" }] } }, stopReason: "end_turn" }, "m");
    assert.deepEqual(out.choices[0].message, { role: "assistant", content: "done" });
    assert.equal(out.choices[0].finish_reason, "stop");
  });

  test("returns toolUse blocks as tool calls with JSON arguments", () => {
    const out = fromConverse(
      {
        output: { message: { content: [{ text: "Checking." }, { toolUse: { toolUseId: "x1", name: "read", input: { path: "a.py" } } }] } },
        stopReason: "tool_use",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      },
      "m",
    );
    assert.deepEqual(out.choices[0].message, {
      role: "assistant",
      content: "Checking.",
      tool_calls: [{ id: "x1", type: "function", function: { name: "read", arguments: '{"path":"a.py"}' } }],
    });
    assert.equal(out.choices[0].finish_reason, "tool_calls");
    assert.deepEqual(out.usage, {
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 15,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    });
  });

  test("counts cache reads and writes as input and reports them in prompt_tokens_details", () => {
    const usage = { inputTokens: 4, outputTokens: 7, totalTokens: 911, cacheReadInputTokens: 800, cacheWriteInputTokens: 100 };
    assert.deepEqual(fromConverse({ output: { message: { content: [{ text: "hi" }] } }, usage }, "m").usage, {
      prompt_tokens: 904,
      completion_tokens: 7,
      total_tokens: 911,
      prompt_tokens_details: { cached_tokens: 800, cache_write_tokens: 100 },
    });
  });

  test("rejects a reply cut off by the context window as a client error", () => {
    const out = { output: { message: { content: [{ text: "partial" }] } }, stopReason: "model_context_window_exceeded" };
    assert.throws(() => fromConverse(out, "m"), { name: "ContextWindowExceeded", status: 400, message: /maximum context length/ });
  });

  test("a tool-only reply has null content", () => {
    const out = fromConverse({ output: { message: { content: [{ toolUse: { toolUseId: "x", name: "bash", input: {} } }] } } }, "m");
    assert.equal(out.choices[0].message.content, null);
  });

  test("reports a cut-off reply as length", () => {
    const out = fromConverse({ output: { message: { content: [{ text: "partial" }] } }, stopReason: "max_tokens" }, "m");
    assert.equal(out.choices[0].finish_reason, "length");
  });

  test("returns reasoning blocks in order as reasoning_details, and their text as reasoning", () => {
    const content = [
      { reasoningContent: { reasoningText: { text: "First. ", signature: "sig" } } },
      { reasoningContent: { redactedContent: new Uint8Array([0, 1, 2, 255]) } },
      { reasoningContent: { reasoningText: { text: "Second." } } },
      { text: "Done." },
    ];
    assert.deepEqual(fromConverse({ output: { message: { content } }, stopReason: "end_turn" }, "m").choices[0].message, {
      role: "assistant",
      content: "Done.",
      reasoning: "First. Second.",
      reasoning_details: [
        { type: "reasoning.text", text: "First. ", signature: "sig" },
        { type: "reasoning.encrypted", data: "AAEC/w==" },
        { type: "reasoning.text", text: "Second." },
      ],
    });
  });

  test("reasoning with a signature but no text has details and no reasoning text", () => {
    const content = [
      { reasoningContent: { reasoningText: { text: "", signature: "sig" } } },
      { toolUse: { toolUseId: "x", name: "bash", input: {} } },
    ];
    const message = fromConverse({ output: { message: { content } } }, "m").choices[0].message;
    assert.equal("reasoning" in message, false);
    assert.deepEqual(message.reasoning_details, [{ type: "reasoning.text", text: "", signature: "sig" }]);
  });

  test("a reply without reasoning has no reasoning fields", () => {
    const message = fromConverse({ output: { message: { content: [{ text: "hi" }] } } }, "m").choices[0].message;
    assert.ok(!("reasoning" in message) && !("reasoning_details" in message));
  });

  test("a round trip through both directions keeps the reasoning blocks exactly", () => {
    const content = [
      { reasoningContent: { reasoningText: { text: "Plan.", signature: "c2ln" } } },
      { reasoningContent: { redactedContent: new Uint8Array([9, 8, 7]) } },
      { text: "Running." },
      { toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } },
    ];
    const reply = JSON.parse(JSON.stringify(fromConverse({ output: { message: { content } }, stopReason: "tool_use" }, "m")));
    const back = toConverse(req([{ role: "user", content: "task" }, reply.choices[0].message]));
    assert.deepEqual(back.messages[1].content, [
      { reasoningContent: { reasoningText: { text: "Plan.", signature: "c2ln" } } },
      { reasoningContent: { redactedContent: Buffer.from([9, 8, 7]) } },
      { text: "Running." },
      { toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } },
    ]);
  });

  test("a round trip through both directions keeps the tool call", () => {
    const reply = fromConverse(
      { output: { message: { content: [{ toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } }] } } },
      "m",
    );
    const back = toConverse(req([{ role: "user", content: "task" }, reply.choices[0].message as OpenAIRequest["messages"][number]]));
    assert.deepEqual(back.messages[1].content, [{ toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } }]);
  });
});

const delta = (contentBlockIndex: number, d: NonNullable<StreamEvent["contentBlockDelta"]>["delta"]): StreamEvent => ({
  contentBlockDelta: { contentBlockIndex, delta: d },
});
const toolStart = (contentBlockIndex: number, toolUseId: string, name: string): StreamEvent => ({
  contentBlockStart: { contentBlockIndex, start: { toolUse: { toolUseId, name } } },
});
const stop = (contentBlockIndex: number): StreamEvent => ({ contentBlockStop: { contentBlockIndex } });
const end = (stopReason: string, usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5 }): StreamEvent[] => [
  { messageStop: { stopReason } },
  { metadata: { usage } },
];

function convert(events: StreamEvent[]) {
  const c = streamConverter("m");
  const chunks = events.flatMap((e) => c.push(e));
  type Chunk = { choices: { delta: Record<string, unknown>; finish_reason: string | null }[]; usage?: unknown };
  return { chunks: [...chunks, ...c.end()] as Chunk[], seen: c.seen };
}

const deltas = (events: StreamEvent[]) => convert(events).chunks.flatMap((c) => c.choices.map((ch) => ch.delta));

async function assemble(chunks: object[]) {
  const body = chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
  return readReply(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
}

describe("streamConverter", () => {
  test("streams text as content deltas and ends with the finish reason and usage", () => {
    const { chunks } = convert([delta(0, { text: "" }), delta(0, { text: "Hel" }), delta(0, { text: "lo" }), stop(0), ...end("end_turn")]);
    assert.deepEqual(chunks.map((c) => c.choices[0]?.delta), [{ content: "Hel" }, { content: "lo" }, {}, undefined]);
    assert.equal(chunks.at(-2)!.choices[0].finish_reason, "stop");
    assert.deepEqual(chunks.at(-1), {
      id: (chunks[0] as unknown as { id: string }).id,
      object: "chat.completion.chunk",
      model: "m",
      choices: [],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 2,
        total_tokens: 5,
        prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      },
    });
  });

  test("numbers tool calls in order and streams their input as arguments", () => {
    const events = [
      delta(0, { text: "Two." }),
      stop(0),
      toolStart(1, "t1", "bash"),
      delta(1, { toolUse: { input: '{"comm' } }),
      delta(1, { toolUse: { input: 'and":"ls"}' } }),
      stop(1),
      toolStart(2, "t2", "read"),
      stop(2),
      ...end("tool_use"),
    ];
    assert.deepEqual(deltas(events).slice(1, 5), [
      { tool_calls: [{ index: 0, id: "t1", type: "function", function: { name: "bash", arguments: "" } }] },
      { tool_calls: [{ index: 0, function: { arguments: '{"comm' } }] },
      { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] },
      { tool_calls: [{ index: 1, id: "t2", type: "function", function: { name: "read", arguments: "" } }] },
    ]);
    assert.equal(convert(events).chunks.at(-2)!.choices[0].finish_reason, "tool_calls");
  });

  test("streams reasoning text and signatures as reasoning details numbered by block", () => {
    const events = [
      delta(0, { reasoningContent: { text: "" } }),
      delta(0, { reasoningContent: { signature: "sig" } }),
      stop(0),
      delta(1, { reasoningContent: { text: "Think." } }),
      stop(1),
      ...end("end_turn"),
    ];
    assert.deepEqual(deltas(events).slice(0, 3), [
      { reasoning_details: [{ type: "reasoning.text", index: 0, text: "" }] },
      { reasoning_details: [{ type: "reasoning.text", index: 0, text: "", signature: "sig" }] },
      { reasoning: "Think.", reasoning_details: [{ type: "reasoning.text", index: 1, text: "Think." }] },
    ]);
    assert.equal(convert(events).seen.reasoning, 2);
  });

  test("sends redacted reasoning once, in base64, when its block ends", () => {
    const events = [
      delta(0, { reasoningContent: { redactedContent: new Uint8Array([0, 1]) } }),
      delta(0, { reasoningContent: { redactedContent: new Uint8Array([2, 255]) } }),
      stop(0),
      ...end("end_turn"),
    ];
    assert.deepEqual(deltas(events)[0], { reasoning_details: [{ type: "reasoning.encrypted", index: 0, data: "AAEC/w==" }] });
  });

  test("reports a reply cut off at the output limit as length", () => {
    assert.equal(convert([delta(0, { text: "par" }), ...end("max_tokens")]).chunks.at(-2)!.choices[0].finish_reason, "length");
  });

  test("rejects a reply cut off by the context window as a client error", () => {
    const c = streamConverter("m");
    [delta(0, { text: "partial" }), ...end("model_context_window_exceeded")].forEach((e) => c.push(e));
    assert.throws(() => c.end(), { name: "ContextWindowExceeded", status: 400, message: /maximum context length/ });
  });

  test("rejects a stream that ends without a stop reason", () => {
    const c = streamConverter("m");
    c.push(delta(0, { text: "partial" }));
    assert.throws(() => c.end(), { name: "StreamEnded" });
  });

  test("keeps the usage for the log, cache tokens included", () => {
    const usage = { inputTokens: 0, outputTokens: 2, totalTokens: 868, cacheReadInputTokens: 0, cacheWriteInputTokens: 866 };
    const { chunks, seen } = convert([delta(0, { text: "hi" }), ...end("end_turn", usage)]);
    assert.deepEqual(seen.usage, usage);
    assert.deepEqual(chunks.at(-1)!.usage, {
      prompt_tokens: 866,
      completion_tokens: 2,
      total_tokens: 868,
      prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: 866 },
    });
  });

  test("Keel assembles the stream into the reply the non-streaming path returns", async () => {
    const content = [
      { reasoningContent: { reasoningText: { text: "", signature: "sig-1" } } },
      { reasoningContent: { redactedContent: new Uint8Array([9, 8, 7]) } },
      { reasoningContent: { reasoningText: { text: "Plan it." } } },
      { text: "Running." },
      { toolUse: { toolUseId: "r1", name: "bash", input: { command: "ls" } } },
      { toolUse: { toolUseId: "r2", name: "read", input: { path: "a.py" } } },
    ];
    const events = [
      delta(0, { reasoningContent: { text: "" } }),
      delta(0, { reasoningContent: { signature: "sig-1" } }),
      stop(0),
      delta(1, { reasoningContent: { redactedContent: new Uint8Array([9, 8, 7]) } }),
      stop(1),
      delta(2, { reasoningContent: { text: "Plan " } }),
      delta(2, { reasoningContent: { text: "it." } }),
      stop(2),
      delta(3, { text: "Run" }),
      delta(3, { text: "ning." }),
      stop(3),
      toolStart(4, "r1", "bash"),
      delta(4, { toolUse: { input: '{"command":' } }),
      delta(4, { toolUse: { input: '"ls"}' } }),
      stop(4),
      toolStart(5, "r2", "read"),
      delta(5, { toolUse: { input: '{"path":"a.py"}' } }),
      stop(5),
      ...end("tool_use"),
    ];
    const streamed = await assemble(convert(events).chunks);
    const usage = { inputTokens: 3, outputTokens: 2, totalTokens: 5 };
    const whole = fromConverse({ output: { message: { content } }, stopReason: "tool_use", usage }, "m");
    const { index, ...choice } = JSON.parse(JSON.stringify(whole.choices[0]));
    assert.deepEqual(streamed.choices, [choice]);
    assert.deepEqual(streamed.usage, whole.usage);
  });
});
