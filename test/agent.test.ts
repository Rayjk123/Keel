import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

type Wire = { model: string; messages: { role: string; content: string }[] };

const DONE = "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT";

let script: string[] = [];
let requests: Wire[] = [];

const server = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  requests.push(JSON.parse(raw));
  const content = script.shift() ?? "script exhausted";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ choices: [{ message: { role: "assistant", content } }] }));
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

function run(replies: string[], maxSteps?: number) {
  script = [...replies];
  requests = [];
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
