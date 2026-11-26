import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";

type WireMessage = { role: string; content: string | null; tool_call_id?: string; reasoning?: string; reasoning_details?: unknown };
type Wire = { messages: WireMessage[]; stream?: boolean; stream_options?: unknown };
type Reply = { type?: string; headers?: boolean; pieces: (string | number)[] };

const DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";

let script: Reply[] = [];
let requests: Wire[] = [];
let logged: string[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  const { type = "text/event-stream", headers = true, pieces } = script.shift() ?? { pieces: [] };
  if (headers) res.writeHead(200, { "Content-Type": type }).flushHeaders();
  for (const piece of pieces) {
    if (typeof piece === "number") await new Promise((r) => setTimeout(r, piece));
    else if (!res.destroyed) res.write(piece);
  }
  if (!res.headersSent) res.writeHead(200, { "Content-Type": type });
  res.end();
});

let keel: typeof import("../agent.ts");
let dir: string;
let usageFile: string;

before(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  process.env.MODEL = "fake";
  process.env.RETRY_DELAY_MS = "1";
  process.env.IDLE_TIMEOUT_MS = "500";
  console.error = (line: unknown) => void logged.push(String(line));
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-stream-"));
  usageFile = path.join(dir, "usage.json");
  process.env.USAGE_FILE = usageFile;
  process.chdir(dir);
  keel = await import("../agent.ts");
});

after(() => server.close());

const data = (chunk: object) => `data: ${JSON.stringify(chunk)}\n\n`;
const delta = (d: object, finish_reason: string | null = null) => data({ choices: [{ index: 0, delta: d, finish_reason }] });
const usage = (prompt_tokens: number, completion_tokens: number, cached_tokens = 0, cache_write_tokens = 0) =>
  data({ choices: [], usage: { prompt_tokens, completion_tokens, prompt_tokens_details: { cached_tokens, cache_write_tokens } } });
const END = "data: [DONE]\n\n";
const stream = (...pieces: (string | number)[]): Reply => ({ pieces });
const say = (content: string, finish = "stop") => stream(delta({ role: "assistant", content }), delta({}, finish), END);
const bash = (command: string, text = "Plan.") => `${text}\n\n\`\`\`bash\n${command}\n\`\`\``;
const submit = bash(`printf '${DONE}\\nall done\\n'`);
const call = (index: number, id: string, command: string) => [
  delta({ tool_calls: [{ index, id, type: "function", function: { name: "bash", arguments: "" } }] }),
  delta({ tool_calls: [{ index, function: { arguments: `{"command":` } }] }),
  delta({ tool_calls: [{ index, function: { arguments: JSON.stringify(command) + "}" } }] }),
];

function run(replies: Reply[], native = false) {
  script = [...replies];
  requests = [];
  logged = [];
  fs.rmSync(usageFile, { force: true });
  return keel.agent(native ? keel.nativeAdapter("fake") : keel.textAdapter("fake"), "the task");
}

describe("streaming", () => {
  test("asks for a stream that ends with the usage", async () => {
    await run([say(submit)]);
    assert.equal(requests[0].stream, true);
    assert.deepEqual(requests[0].stream_options, { include_usage: true });
  });

  test("joins content split across chunks and across reads, and ignores keepalive comments", async () => {
    const body = [": keepalive\n\n", delta({ role: "assistant", content: "Plan.\n\n```ba" }), ": keepalive\n\n"];
    body.push(delta({ content: `sh\nprintf '${DONE}\\nsplit\\n'\n\`\`\`` }), delta({}, "stop"), END);
    const text = body.join("");
    const pieces = Array.from({ length: Math.ceil(text.length / 7) }, (_, i) => text.slice(i * 7, i * 7 + 7));
    assert.equal(await run([stream(...pieces)]), "split");
  });

  test("assembles tool calls from deltas by index and runs each", async () => {
    const calls = stream(...call(0, "a", "echo one"), ...call(1, "b", "echo two"), delta({}, "tool_calls"), END);
    const result = await run([calls, say("Done."), say("Done.")], true);
    assert.equal(result, "Done.");
    const [assistant, first, second] = requests[1].messages.slice(2);
    assert.equal(assistant.content, null);
    assert.deepEqual([first.tool_call_id, first.content], ["a", "one\n[exit code: 0]"]);
    assert.deepEqual([second.tool_call_id, second.content], ["b", "two\n[exit code: 0]"]);
  });

  test("assembles reasoning text and details, signatures and encrypted data included, and replays them", async () => {
    const reasoning = [
      delta({ reasoning: "Thi", reasoning_details: [{ type: "reasoning.text", index: 0, text: "Thi" }] }),
      delta({ reasoning: "nk.", reasoning_details: [{ type: "reasoning.text", index: 0, text: "nk." }] }),
      delta({ reasoning_details: [{ type: "reasoning.text", index: 0, text: "", signature: "sig" }] }),
      delta({ reasoning_details: [{ type: "reasoning.encrypted", index: 1, data: "AAEC" }] }),
    ];
    await run([stream(...reasoning, delta({ content: bash("echo hi") }), delta({}, "stop"), END), say(submit)]);
    const assistant = requests[1].messages[2];
    assert.equal(assistant.reasoning, "Think.");
    assert.deepEqual(assistant.reasoning_details, [
      { type: "reasoning.text", text: "Think.", signature: "sig" },
      { type: "reasoning.encrypted", data: "AAEC" },
    ]);
  });

  test("a reply that ends at the output limit is treated as cut off", async () => {
    await run([say(bash("rm -rf /"), "length"), say(submit)]);
    assert.match(requests[1].messages.at(-1)!.content!, /cut off/);
  });

  test("reads a last line that has no newline after it", async () => {
    assert.equal(await run([stream(delta({ content: submit }), delta({}, "stop").trimEnd())]), "all done");
  });

  test("stops reading at [DONE] even if the server keeps the connection open", async () => {
    assert.equal(await run([stream(...say(submit).pieces, 1500)]), "all done");
    assert.equal(requests.length, 1);
  });

  test("starts a new tool call for each id when the server leaves out the index", async () => {
    const whole = (id: string, command: string) => ({
      id,
      type: "function",
      function: { name: "bash", arguments: JSON.stringify({ command }) },
    });
    const calls = stream(delta({ tool_calls: [whole("a", "echo one"), whole("b", "echo two")] }), delta({}, "tool_calls"), END);
    await run([calls, say("Done."), say("Done.")], true);
    assert.deepEqual(requests[1].messages.slice(3).map((m) => [m.tool_call_id, m.content]), [
      ["a", "one\n[exit code: 0]"],
      ["b", "two\n[exit code: 0]"],
    ]);
  });

  test("still reads a plain JSON reply", async () => {
    const json = JSON.stringify({ choices: [{ message: { role: "assistant", content: submit }, finish_reason: "stop" }] });
    assert.equal(await run([{ type: "application/json", pieces: [json] }]), "all done");
  });
});

describe("stream failures", () => {
  test("gives up on a server that goes quiet, before or after the headers, and names the timeout", async () => {
    const result = await run([{ headers: false, pieces: [1500] }, stream(1500), stream(delta({ content: "Pl" }), 1500), stream(1500)]);
    assert.equal(result, "stopped: the model request failed: TimeoutError: no data from the model server for 0.5 seconds");
    const failures = logged.filter((l) => l.startsWith("model request failed"));
    assert.equal(failures.length, 4);
    assert.ok(failures.every((l) => l.startsWith("model request failed (TimeoutError: no data")), failures.join("\n"));
  });

  test("keepalive comments hold a slow reply open", async () => {
    const ping = ": keepalive\n\n";
    const result = await run([stream(ping, 150, ping, 150, ping, 150, ping, 150, ...say(submit).pieces)]);
    assert.equal(result, "all done");
    assert.equal(requests.length, 1);
  });

  test("an error sent in the stream with a client status fails the request without a retry", async () => {
    const error = data({ error: { message: "ContextWindowExceeded: the conversation exceeds the maximum context length of m", code: 400 } });
    const result = await run([stream(delta({ content: "partial" }), error), say(submit)]);
    assert.match(result, /^stopped: the model request failed: 400 .*maximum context length/);
    assert.equal(requests.length, 1);
  });

  test("an error sent in the stream without a client status is retried", async () => {
    const result = await run([stream(data({ error: { message: "ModelStreamErrorException: try again" } })), say(submit)]);
    assert.equal(result, "all done");
    assert.equal(requests.length, 2);
  });

  test("a stream that ends before the reply finishes is retried", async () => {
    assert.equal(await run([stream(delta({ content: "Plan." })), say(submit)]), "all done");
    assert.equal(requests.length, 2);
  });
});

describe("usage", () => {
  test("adds up steps and tokens for the task in USAGE_FILE", async () => {
    const first = stream(delta({ content: bash("echo hi") }), delta({}, "stop"), usage(100, 10, 60, 40), END);
    const second = stream(delta({ content: submit }), delta({}, "stop"), usage(150, 20, 100), END);
    assert.equal(await run([first, second]), "all done");
    assert.deepEqual(JSON.parse(fs.readFileSync(usageFile, "utf8")), {
      steps: 2,
      input_tokens: 250,
      output_tokens: 30,
      cache_read_tokens: 160,
      cache_write_tokens: 40,
    });
  });

  test("counts a reply without usage as a step with no tokens, and starts again for the next task", async () => {
    await run([say(submit)]);
    assert.deepEqual(JSON.parse(fs.readFileSync(usageFile, "utf8")), {
      steps: 1,
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    });
  });

  test("leaves failed attempts out of the count", async () => {
    await run([stream(data({ error: { message: "busy" } })), stream(delta({ content: submit }), delta({}, "stop"), usage(5, 1), END)]);
    assert.equal(JSON.parse(fs.readFileSync(usageFile, "utf8")).steps, 1);
  });
});
