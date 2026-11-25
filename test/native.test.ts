import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

type WireCall = { id: string; type: string; function: { name: string; arguments: string } };
type WireMessage = { role: string; content: string | null; tool_calls?: WireCall[]; tool_call_id?: string };
type Wire = { model: string; messages: WireMessage[]; tools: { type: string; function: { name: string } }[] };
type Reply = { content?: string | null; tool_calls?: unknown[]; status?: number; drop?: boolean };

let script: Reply[] = [];
let requests: Wire[] = [];
let auth: (string | undefined)[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  auth.push(req.headers.authorization);
  const { status, drop, ...message } = script.shift() ?? { content: "script exhausted" };
  if (drop) {
    req.socket.destroy();
    return;
  }
  if (status) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { message: `failure ${status}` } }));
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content: null, ...message } }] }));
});

let keel: typeof import("../agent.ts");
let dir: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.MODEL = "fake";
  process.env.RETRY_DELAY_MS = "1";
  process.env.API_KEY = "sk-test-key";
  console.error = () => {};
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-native-"));
  process.chdir(dir);
  keel = await import("../agent.ts");
});

after(() => server.close());

let callN = 0;
const call = (name: string, args: unknown, id = `c${callN++}`) => ({
  id,
  type: "function",
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});
const tools = (...calls: unknown[]): Reply => ({ content: null, tool_calls: calls });
const finish = (text: string): Reply => ({ content: text });
const end = (text: string): Reply[] => [finish(text), finish(text)];

function run(replies: Reply[], maxSteps?: number) {
  script = [...replies];
  requests = [];
  return keel.agent(keel.nativeAdapter("fake"), "the task", maxSteps);
}

const toolMessages = (n: number) => requests[n].messages.filter((m) => m.role === "tool");

describe("request", () => {
  test("sends all five tools as functions", async () => {
    await run(end("done"));
    assert.deepEqual(
      requests[0].tools.map((t) => [t.type, t.function.name]),
      [["function", "bash"], ["function", "read"], ["function", "write"], ["function", "edit"], ["function", "patch"]],
    );
  });

  test("starts with the native system prompt and the task", async () => {
    await run(end("done"));
    const [system, user] = requests[0].messages;
    assert.equal(system.role, "system");
    assert.match(system.content!, /reply without calling a tool/);
    assert.doesNotMatch(system.content!, /```bash/);
    assert.deepEqual(user, { role: "user", content: "the task" });
    assert.equal(requests[0].model, "fake");
  });
});

describe("authentication", () => {
  test("sends API_KEY as a bearer token on every request", async () => {
    auth = [];
    await run([tools(call("bash", { command: "true" })), ...end("ok")]);
    assert.deepEqual(auth, ["Bearer sk-test-key", "Bearer sk-test-key", "Bearer sk-test-key"]);
  });
});

describe("finishing", () => {
  test("a reply without tool calls is confirmed once, then ends the run", async () => {
    assert.equal(await run([finish("Working on it."), finish("All fixed.")]), "All fixed.");
    assert.equal(requests.length, 2);
    const nudge = requests[1].messages.at(-1)!;
    assert.equal(nudge.role, "user");
    assert.match(nudge.content!, /replied without calling a tool/);
    assert.equal(requests[1].messages.at(-2)!.content, "Working on it.");
  });

  test("a tool call after the nudge carries on, and the next text reply is confirmed again", async () => {
    const result = await run([finish("Let me check."), tools(call("bash", { command: "true" })), finish("Done."), finish("Really done.")]);
    assert.equal(result, "Really done.");
    assert.equal(requests.length, 4);
  });

  test("falls back to the first summary when the confirming reply is empty", async () => {
    assert.equal(await run([finish("Summary here."), { content: "" }]), "Summary here.");
  });

  test("two empty replies still end the run", async () => {
    assert.equal(await run([{ content: "" }, { content: "" }]), "finished without a summary");
  });

  test("stops at the step limit", async () => {
    const result = await run(Array(10).fill(tools(call("bash", { command: "true" }))), 3);
    assert.equal(result, "stopped: step limit reached");
    assert.equal(requests.length, 3);
  });
});

describe("tool calls", () => {
  test("runs a call and sends the result back as a tool message with the same id", async () => {
    await run([tools(call("bash", { command: "echo hi" }, "abc")), ...end("ok")]);
    const history = requests[1].messages;
    const assistant = history[2];
    assert.equal(assistant.role, "assistant");
    assert.equal(assistant.content, null);
    assert.deepEqual(assistant.tool_calls, [
      { id: "abc", type: "function", function: { name: "bash", arguments: JSON.stringify({ command: "echo hi" }) } },
    ]);
    assert.deepEqual(history[3], { role: "tool", tool_call_id: "abc", content: "hi\n[exit code: 0]" });
  });

  test("runs several calls from one reply in order, each answered by id", async () => {
    await run([
      tools(call("write", { path: "a.txt", content: "one\n" }, "w"), call("read", { path: "a.txt" }, "r")),
      ...end("ok"),
    ]);
    const results = toolMessages(1);
    assert.deepEqual(results.map((m) => m.tool_call_id), ["w", "r"]);
    assert.match(results[0].content!, /Created a\.txt/);
    assert.equal(results[1].content, "     1\tone");
  });

  test("keeps the reply's text next to its tool calls", async () => {
    await run([{ content: "Let me look.", tool_calls: [call("bash", { command: "true" }, "t")] }, ...end("ok")]);
    assert.equal(requests[1].messages[2].content, "Let me look.");
  });

  test("a final reply after tool calls is part of the history", async () => {
    await run([tools(call("bash", { command: "true" })), tools(call("bash", { command: "true" })), ...end("ok")]);
    assert.equal(requests.length, 4);
    assert.equal(requests[2].messages.length, 6);
  });

  test("invalid JSON arguments get an error result and the run continues", async () => {
    const result = await run([tools(call("bash", "{not json", "bad")), ...end("recovered")]);
    assert.equal(result, "recovered");
    const [toolMsg] = toolMessages(1);
    assert.equal(toolMsg.tool_call_id, "bad");
    assert.match(toolMsg.content!, /not valid JSON/);
    assert.equal(requests[1].messages[2].tool_calls![0].function.arguments, "{not json");
  });

  test("an unknown tool gets an error result", async () => {
    await run([tools(call("browse", { url: "x" })), ...end("ok")]);
    assert.match(toolMessages(1)[0].content!, /unknown tool "browse"/);
  });

  test("a failing tool gets an error result and the run continues", async () => {
    await run([tools(call("read", { path: "missing.txt" })), ...end("ok")]);
    assert.match(toolMessages(1)[0].content!, /^error: file not found/);
  });

  test("accepts arguments sent as an object instead of a JSON string", async () => {
    await run([{ tool_calls: [{ id: "o", type: "function", function: { name: "bash", arguments: { command: "echo obj" } } }] }, ...end("ok")]);
    assert.equal(toolMessages(1)[0].content, "obj\n[exit code: 0]");
  });

  test("gives an id to a call that arrives without one", async () => {
    await run([{ tool_calls: [{ type: "function", function: { name: "bash", arguments: '{"command":"true"}' } }] }, ...end("ok")]);
    const id = requests[1].messages[2].tool_calls![0].id;
    assert.ok(id);
    assert.equal(toolMessages(1)[0].tool_call_id, id);
  });

  test("treats missing arguments as an empty object", async () => {
    await run([{ tool_calls: [{ id: "e", type: "function", function: { name: "read" } }] }, ...end("ok")]);
    assert.match(toolMessages(1)[0].content!, /missing required argument "path"/);
  });
});

describe("end to end", () => {
  test("the model reads, edits and checks a file, then finishes", async () => {
    fs.writeFileSync(path.join(dir, "calc.py"), "def add(a, b):\n    return a - b\n");
    const result = await run([
      tools(call("read", { path: "calc.py" })),
      tools(call("edit", { path: "calc.py", old_string: "return a - b", new_string: "return a + b" })),
      tools(call("bash", { command: "python3 -c 'import calc; print(calc.add(2, 3))'" })),
      ...end("Fixed add."),
    ]);
    assert.equal(result, "Fixed add.");
    assert.equal(fs.readFileSync(path.join(dir, "calc.py"), "utf8"), "def add(a, b):\n    return a + b\n");
    assert.equal(toolMessages(3).at(-1)!.content, "5\n[exit code: 0]");
  });

  test("the model must read a file before replacing it", async () => {
    fs.writeFileSync(path.join(dir, "keep.txt"), "important\n");
    await run([
      tools(call("write", { path: "keep.txt", content: "clobbered\n" })),
      tools(call("read", { path: "keep.txt" })),
      tools(call("write", { path: "keep.txt", content: "replaced\n" })),
      ...end("ok"),
    ]);
    assert.match(toolMessages(1)[0].content!, /read the file before you replace it/);
    assert.match(toolMessages(3).at(-1)!.content!, /^Overwrote keep\.txt/);
    assert.equal(fs.readFileSync(path.join(dir, "keep.txt"), "utf8"), "replaced\n");
  });

  test("the model applies a patch across two files", async () => {
    fs.writeFileSync(path.join(dir, "x.py"), "X = 1\n");
    await run([
      tools(call("read", { path: "x.py" })),
      tools(call("patch", { patch: "*** Begin Patch\n*** Update File: x.py\n-X = 1\n+X = 2\n*** Add File: y.py\n+Y = 3\n*** End Patch" })),
      ...end("ok"),
    ]);
    assert.equal(fs.readFileSync(path.join(dir, "x.py"), "utf8"), "X = 2\n");
    assert.equal(fs.readFileSync(path.join(dir, "y.py"), "utf8"), "Y = 3\n");
    assert.equal(toolMessages(2).at(-1)!.content, "Applied patch: updated x.py, added y.py");
  });
});

describe("model errors", () => {
  test("retries a server error and carries on", async () => {
    const result = await run([{ status: 500 }, tools(call("bash", { command: "true" })), { status: 503 }, ...end("ok")]);
    assert.equal(result, "ok");
    assert.equal(requests.length, 5);
  });

  test("retries a rate limit", async () => {
    assert.equal(await run([{ status: 429 }, ...end("ok")]), "ok");
  });

  test("stops cleanly after the retries run out", async () => {
    const result = await run([{ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 }, ...end("never")]);
    assert.match(result, /^stopped: the model request failed: 500 .*failure 500/);
    assert.equal(requests.length, 4);
  });

  test("names the cause of a failed connection", async () => {
    const result = await run([{ drop: true }, { drop: true }, { drop: true }, { drop: true }, ...end("never")]);
    assert.match(result, /^stopped: the model request failed: TypeError: fetch failed \(\w+Error: .+\)$/);
  });

  test("does not retry a request the server rejects", async () => {
    const result = await run([{ status: 400 }, ...end("never")]);
    assert.match(result, /^stopped: the model request failed: 400/);
    assert.equal(requests.length, 1);
  });

  test("the text adapter stops cleanly too", async () => {
    script = [{ status: 400 }];
    requests = [];
    assert.match(await keel.agent(keel.textAdapter("fake"), "task"), /^stopped: the model request failed: 400/);
  });
});

describe("adapterFor", () => {
  test("defaults to native tool calling", () => {
    assert.equal(keel.adapterFor(undefined, "m").native, true);
    assert.equal(keel.adapterFor("", "m").native, true);
    assert.equal(keel.adapterFor("native", "m").native, true);
  });

  test("picks the text adapter on request and rejects anything else", () => {
    assert.equal(keel.adapterFor("text", "m").native, false);
    assert.throws(() => keel.adapterFor("xml", "m"), /ADAPTER must be/);
  });
});

describe("nativeAdapter.fromWire", () => {
  const parse = (message: Reply) => keel.nativeAdapter("m").fromWire({ choices: [{ message }] });

  test("turns tool calls into tool_call parts with parsed arguments", () => {
    const msg = parse({ content: "Plan.", tool_calls: [call("read", { path: "a" }, "1")] });
    assert.deepEqual(msg.parts, [
      { type: "text", text: "Plan." },
      { type: "tool_call", id: "1", name: "read", args: { path: "a" } },
    ]);
  });

  test("a plain reply is text only", () => {
    assert.deepEqual(parse({ content: "just talking" }).parts, [{ type: "text", text: "just talking" }]);
  });

  test("a fenced bash block in plain text is not a tool call", () => {
    assert.ok(parse({ content: "```bash\nls\n```" }).parts.every((p) => p.type !== "tool_call"));
  });
});
