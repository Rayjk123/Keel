import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type WireMessage = { role: string; content: string; reasoning?: string; reasoning_details?: unknown };
type Wire = { model: string; messages: WireMessage[]; reasoning_effort?: string };

const DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";

type Reply = string | { content: string; finish_reason: string; reasoning?: string; reasoning_details?: unknown };

let script: Reply[] = [];
let requests: Wire[] = [];
let connections: (string | undefined)[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  connections.push(req.headers.connection);
  const next = script.shift() ?? "script exhausted";
  const { content, finish_reason, ...extra } = typeof next === "string" ? { content: next, finish_reason: "stop" } : next;
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content, ...extra }, finish_reason }] }));
});

let keel: typeof import("../agent.ts");

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.MODEL = "fake";
  console.error = () => {};
  keel = await import("../agent.ts");
});

after(() => server.close());

const reply = (command: string, text = "Plan.") => `${text}\n\n\`\`\`bash\n${command}\n\`\`\``;
const submit = (summary: string) => reply(`printf '${DONE}\\n${summary}\\n'`);

function run(replies: Reply[], maxSteps?: number) {
  script = [...replies];
  requests = [];
  connections = [];
  return keel.agent(keel.textAdapter("fake"), "the task", maxSteps);
}

const lastWire = (n: number) => requests[n].messages[requests[n].messages.length - 1];

describe("completion", () => {
  test("a command printing the completion string first and exiting 0 ends the run with the rest as summary", async () => {
    assert.equal(await run([submit("all done")]), "all done");
    assert.equal(requests.length, 1);
  });

  test("falls back to the reply text when there is no summary", async () => {
    assert.equal(await run([reply(`echo ${DONE}`, "Finished the work.")]), "Finished the work.");
  });

  test("a non-zero exit does not end the run", async () => {
    const result = await run([reply(`echo ${DONE}; exit 1`), submit("second try")]);
    assert.equal(result, "second try");
    assert.equal(requests.length, 2);
  });

  test("the completion string must be the first stdout line", async () => {
    const result = await run([reply(`echo hi; echo ${DONE}`), submit("later")]);
    assert.equal(result, "later");
    assert.equal(requests.length, 2);
  });
});

describe("limits", () => {
  test("stops at the step limit", async () => {
    const result = await run(Array(10).fill(reply("true")), 3);
    assert.equal(result, "stopped: step limit reached");
    assert.equal(requests.length, 3);
  });

  test("stops after three consecutive replies without a command", async () => {
    const result = await run(["no block", "still none", "nothing again"]);
    assert.equal(result, "stopped: no command in 3 consecutive replies");
    assert.equal(requests.length, 3);
  });

  test("a good command resets the no-command streak", async () => {
    const result = await run(["no block", reply("true"), "none", "none again", submit("ok")]);
    assert.equal(result, "ok");
  });
});

describe("bad replies", () => {
  test("are dropped from history and followed by a corrective message", async () => {
    await run(["I forgot the block", submit("ok")]);
    const history = requests[1].messages;
    assert.equal(history.length, 3);
    assert.ok(history.every((m) => !m.content.includes("I forgot the block")));
    assert.match(lastWire(1).content, /^No bash command found/);
    assert.equal(lastWire(1).role, "user");
  });

  test("a cut-off reply is not run, and the model is told it was cut off", async () => {
    const result = await run([{ content: reply("rm -rf /"), finish_reason: "length" }, "none", "none again", submit("ok")]);
    assert.equal(result, "ok");
    assert.match(requests[1].messages.at(-1)!.content, /output token limit and was cut off/);
    assert.ok(requests[1].messages.every((m) => !m.content.includes("rm -rf")));
  });

  test("two bash blocks in one reply count as no command", async () => {
    await run([`${reply("echo one")}\n\n${reply("echo two")}`, submit("ok")]);
    assert.match(lastWire(1).content, /^No bash command found/);
  });
});

describe("history", () => {
  test("a command and its output are replayed as an assistant block and a user message", async () => {
    await run([reply("echo hi"), submit("ok")]);
    const [, , assistant, result] = requests[1].messages;
    assert.equal(assistant.role, "assistant");
    assert.match(assistant.content, /```bash\necho hi\n```/);
    assert.equal(result.role, "user");
    assert.equal(result.content, "exit=0\nhi\n");
  });

  test("sends the system prompt first and the task second", async () => {
    await run([submit("ok")]);
    assert.equal(requests[0].messages[0].role, "system");
    assert.deepEqual(requests[0].messages[1], { role: "user", content: "the task" });
    assert.equal(requests[0].model, "fake");
  });
});

describe("reasoning", () => {
  const details = [{ type: "reasoning.text", text: "Think.", signature: "sig" }, { type: "reasoning.encrypted", data: "AAEC" }];
  const thinking = (content: string, reasoning: string) => ({ content, finish_reason: "stop", reasoning, reasoning_details: details });

  test("is replayed unchanged on the assistant message with the command", async () => {
    await run([thinking(reply("echo hi"), "Think."), submit("ok")]);
    const assistant = requests[1].messages[2];
    assert.equal(assistant.content, reply("echo hi"));
    assert.equal(assistant.reasoning, "Think.");
    assert.deepEqual(assistant.reasoning_details, details);
  });

  test("a bash block in the reasoning is not run", async () => {
    await run([thinking("No block.", reply("echo from-reasoning")), thinking(reply("echo from-reply"), reply("echo nope")), submit("ok")]);
    assert.match(lastWire(1).content, /^No bash command found/);
    assert.equal(lastWire(2).content, "exit=0\nfrom-reply\n");
  });

  test("is dropped with a reply that has no command", async () => {
    await run([thinking("No block here.", "lost"), submit("ok")]);
    assert.ok(requests[1].messages.every((m) => !("reasoning" in m) && !("reasoning_details" in m)));
  });

  test("a cut-off reply's reasoning is not replayed", async () => {
    await run([{ ...thinking(reply("echo hi"), "lost"), finish_reason: "length" }, submit("ok")]);
    assert.ok(requests[1].messages.every((m) => !("reasoning" in m) && !("reasoning_details" in m)));
  });

  test("a reply without reasoning sends no reasoning fields", async () => {
    await run([reply("echo hi"), submit("ok")]);
    assert.ok(requests[1].messages.every((m) => !("reasoning" in m) && !("reasoning_details" in m)));
  });
});

describe("effort", () => {
  test("leaves reasoning_effort out when EFFORT is unset or empty", async () => {
    delete process.env.EFFORT;
    await run([submit("ok")]);
    assert.equal("reasoning_effort" in requests[0], false);
    process.env.EFFORT = "";
    try {
      await run([submit("ok")]);
    } finally {
      delete process.env.EFFORT;
    }
    assert.equal("reasoning_effort" in requests[0], false);
  });

  test("sends EFFORT as reasoning_effort", async () => {
    process.env.EFFORT = "max";
    try {
      await run([submit("ok")]);
    } finally {
      delete process.env.EFFORT;
    }
    assert.equal(requests[0].reasoning_effort, "max");
  });
});

describe("connection", () => {
  test("asks the server to close the connection after every reply", async () => {
    await run([reply("echo hi"), submit("ok")]);
    assert.deepEqual(connections, ["close", "close"]);
  });
});

describe("textAdapter.fromWire", () => {
  const parse = (content: string) =>
    keel.textAdapter("m").fromWire({ choices: [{ message: { role: "assistant", content } }] });

  test("one bash block becomes one tool call and is stripped from the text", () => {
    const msg = parse("Look around.\n\n```bash\nls -la\n```");
    assert.deepEqual(msg.parts[0], { type: "text", text: "Look around." });
    assert.equal(msg.parts[1].type, "tool_call");
    assert.deepEqual((msg.parts[1] as { args: unknown }).args, { command: "ls -la" });
  });

  test("no block yields text only", () => {
    assert.deepEqual(parse("just talking").parts, [{ type: "text", text: "just talking" }]);
  });

  test("two blocks yield no tool call", () => {
    const msg = parse("```bash\na\n```\n\n```bash\nb\n```");
    assert.ok(msg.parts.every((p) => p.type !== "tool_call"));
  });
});

describe("runBash", () => {
  test("reports the exit code and combines stdout and stderr", () => {
    assert.equal(keel.runBash("echo out; echo err >&2; exit 3"), "exit=3\nout\nerr\n");
  });

  test("keeps only the last 10000 characters of long output", () => {
    const out = keel.runBash("head -c 20000 /dev/zero | tr '\\0' x");
    assert.equal(out.length, 10_000);
  });

  test("each command runs in a fresh shell", () => {
    keel.runBash("export KEEL_TEST_VAR=1");
    assert.equal(keel.runBash('echo "[$KEEL_TEST_VAR]"'), "exit=0\n[]\n");
  });
});
