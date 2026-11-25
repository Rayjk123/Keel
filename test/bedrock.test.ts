import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { fromConverse, toConverse, type OpenAIRequest } from "../bedrock/convert.ts";

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
    assert.deepEqual(out.usage, { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
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

  test("a round trip through both directions keeps the tool call", () => {
    const reply = fromConverse(
      { output: { message: { content: [{ toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } }] } } },
      "m",
    );
    const back = toConverse(req([{ role: "user", content: "task" }, reply.choices[0].message as OpenAIRequest["messages"][number]]));
    assert.deepEqual(back.messages[1].content, [{ toolUse: { toolUseId: "r", name: "bash", input: { command: "ls" } } }]);
  });
});
