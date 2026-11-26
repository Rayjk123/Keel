import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TOOLS,
  applyPatch,
  clip,
  editFile,
  findText,
  forgetFiles,
  parsePatch,
  readFile,
  runTool,
  shell,
  writeFile,
} from "../tools.ts";

let dir: string;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "keel-tools-"));
  process.chdir(dir);
});

const put = (p: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
  fs.writeFileSync(path.join(dir, p), content);
};
const known = (p: string, content: string) => {
  put(p, content);
  readFile(p);
};
const get = (p: string) => fs.readFileSync(path.join(dir, p), "utf8");
const exists = (p: string) => fs.existsSync(path.join(dir, p));

describe("shell", () => {
  test("returns combined output followed by the exit code", () => {
    assert.equal(shell("echo out; echo err >&2"), "out\nerr\n[exit code: 0]");
  });

  test("reports a non-zero exit code", () => {
    assert.equal(shell("echo nope; exit 3"), "nope\n[exit code: 3]");
  });

  test("adds a newline before the exit code when output lacks one", () => {
    assert.equal(shell("printf abc"), "abc\n[exit code: 0]");
  });

  test("an empty output shows only the exit code", () => {
    assert.equal(shell("true"), "[exit code: 0]");
  });

  test("stops a command that runs past its timeout", () => {
    const out = shell("echo started; sleep 5", 1);
    assert.match(out, /started/);
    assert.match(out, /timed out after 1s/);
  });

  test("runs in the working directory", () => {
    assert.equal(shell("pwd -P"), `${fs.realpathSync(dir)}\n[exit code: 0]`);
  });

  test("each command starts a fresh shell", () => {
    shell("export KEEL_TOOL_VAR=1");
    assert.equal(shell('echo "[$KEEL_TOOL_VAR]"'), "[]\n[exit code: 0]");
  });

  test("long output keeps the start and the end", () => {
    const out = shell("seq 1 20000");
    assert.ok(out.length <= 10_100);
    assert.match(out, /^1\n2\n3\n/);
    assert.match(out, /characters omitted/);
    assert.match(out, /20000\n\[exit code: 0\]$/);
  });
});

describe("clip", () => {
  test("leaves short text alone", () => {
    assert.equal(clip("hello", 100), "hello");
  });

  test("keeps the head and tail of long text and says how much was dropped", () => {
    const text = "a".repeat(3000) + "b".repeat(20000) + "c".repeat(3000);
    const out = clip(text, 10_000);
    assert.ok(out.startsWith("a".repeat(2000)));
    assert.ok(out.endsWith("c".repeat(3000)));
    assert.match(out, /\[16000 characters omitted\]/);
  });
});

describe("read", () => {
  test("numbers each line", () => {
    put("r/a.txt", "alpha\nbeta\n");
    assert.equal(readFile("r/a.txt"), "     1\talpha\n     2\tbeta");
  });

  test("handles a last line without a newline", () => {
    put("r/b.txt", "one\ntwo");
    assert.equal(readFile("r/b.txt"), "     1\tone\n     2\ttwo");
  });

  test("pages with offset and limit and says how to continue", () => {
    put("r/c.txt", "1\n2\n3\n4\n5\n");
    assert.equal(readFile("r/c.txt", 2, 2), "     2\t2\n     3\t3\n\n[2 more lines; read again with offset=4]");
    assert.equal(readFile("r/c.txt", 4, 10), "     4\t4\n     5\t5");
  });

  test("cuts very long lines", () => {
    put("r/long.txt", "x".repeat(5000));
    assert.match(readFile("r/long.txt"), /x{2000}\.\.\. \[line cut\]$/);
  });

  test("an empty file says so", () => {
    put("r/empty.txt", "");
    assert.equal(readFile("r/empty.txt"), "(empty file)");
  });

  test("accepts absolute paths", () => {
    put("r/abs.txt", "hi\n");
    assert.equal(readFile(path.join(dir, "r/abs.txt")), "     1\thi");
  });

  test("rejects a missing file, a directory, a binary file and an offset past the end", () => {
    put("r/bin", "\u0000\u0001\u0002");
    assert.throws(() => readFile("r/missing.txt"), /file not found/);
    assert.throws(() => readFile("r"), /is a directory/);
    assert.throws(() => readFile("r/bin"), /binary/);
    assert.throws(() => readFile("r/a.txt", 9), /past the end/);
    assert.throws(() => readFile("r/a.txt", 0), /offset must be 1 or more/);
  });
});

describe("write", () => {
  test("creates a file and its parent directories", () => {
    assert.equal(writeFile("w/deep/new.txt", "a\nb\n"), "Created w/deep/new.txt (2 lines)");
    assert.equal(get("w/deep/new.txt"), "a\nb\n");
  });

  test("overwrites an existing file after it has been read", () => {
    put("w/old.txt", "old");
    readFile("w/old.txt");
    assert.equal(writeFile("w/old.txt", "new"), "Overwrote w/old.txt (1 lines)");
    assert.equal(get("w/old.txt"), "new");
  });

  test("can write an empty file", () => {
    assert.equal(writeFile("w/blank.txt", ""), "Created w/blank.txt (0 lines)");
    assert.equal(get("w/blank.txt"), "");
  });
});

describe("write guard", () => {
  test("refuses to replace a file that hasn't been read, and leaves it alone", () => {
    put("g/unread.txt", "precious\n");
    assert.throws(() => writeFile("g/unread.txt", "oops"), /read the file before you replace it/);
    assert.equal(get("g/unread.txt"), "precious\n");
  });

  test("a partial read counts as reading the file", () => {
    put("g/partial.txt", "1\n2\n3\n");
    readFile("g/partial.txt", 2, 1);
    assert.doesNotThrow(() => writeFile("g/partial.txt", "new\n"));
  });

  test("refuses when the file changed after it was read, until it is read again", () => {
    put("g/changed.txt", "v1\n");
    readFile("g/changed.txt");
    shell("echo v2 > g/changed.txt");
    assert.throws(() => writeFile("g/changed.txt", "mine"), /changed since you last read it/);
    assert.equal(get("g/changed.txt"), "v2\n");
    readFile("g/changed.txt");
    writeFile("g/changed.txt", "mine");
    assert.equal(get("g/changed.txt"), "mine");
  });

  test("a file written by the tools can be replaced again without reading", () => {
    writeFile("g/mine.txt", "first");
    writeFile("g/mine.txt", "second");
    assert.equal(get("g/mine.txt"), "second");
  });

  test("a file changed by edit or patch can be replaced without reading it again", () => {
    known("g/edited.txt", "a\n");
    editFile("g/edited.txt", "a", "b");
    assert.doesNotThrow(() => writeFile("g/edited.txt", "c\n"));
    known("g/patched.txt", "x\n");
    applyPatch("*** Update File: g/patched.txt\n-x\n+y\n");
    assert.doesNotThrow(() => writeFile("g/patched.txt", "z\n"));
  });

  test("the same file reached by a different path is still recognised", () => {
    put("g/alias.txt", "a\n");
    readFile(path.join(dir, "g/alias.txt"));
    assert.doesNotThrow(() => writeFile("g/./alias.txt", "b\n"));
  });

  test("forgetting the session means files must be read again", () => {
    put("g/forget.txt", "a\n");
    readFile("g/forget.txt");
    forgetFiles();
    assert.throws(() => writeFile("g/forget.txt", "b"), /read the file before you replace it/);
  });

  test("edit refuses a file that hasn't been read, and leaves it alone", () => {
    put("g/e1.py", "x = 1\n");
    assert.throws(() => editFile("g/e1.py", "x = 1", "x = 2"), /g\/e1\.py: read the file before you edit it/);
    assert.equal(get("g/e1.py"), "x = 1\n");
  });

  test("edit refuses a file that changed after it was read", () => {
    known("g/e2.py", "x = 1\n");
    shell("echo 'x = 5' > g/e2.py");
    assert.throws(() => editFile("g/e2.py", "x = 5", "x = 6"), /changed since you last read it\. Read it again before you edit it/);
  });

  test("several edits in a row need only one read", () => {
    known("g/e3.py", "a = 1\nb = 2\n");
    editFile("g/e3.py", "a = 1", "a = 10");
    editFile("g/e3.py", "b = 2", "b = 20");
    assert.equal(get("g/e3.py"), "a = 10\nb = 20\n");
  });

  test("patch refuses to update, delete or move a file that hasn't been read", () => {
    put("g/p1.py", "one\n");
    assert.throws(() => applyPatch("*** Update File: g/p1.py\n-one\n+two\n"), /read the file before you patch it/);
    assert.throws(() => applyPatch("*** Delete File: g/p1.py"), /read the file before you delete it/);
    assert.throws(() => applyPatch("*** Move File: g/p1.py -> g/p1b.py"), /read the file before you move it/);
    assert.equal(get("g/p1.py"), "one\n");
    assert.ok(!exists("g/p1b.py"));
  });

  test("patch changes nothing when one of its files hasn't been read", () => {
    known("g/p2.py", "a\n");
    put("g/p3.py", "b\n");
    assert.throws(() => applyPatch("*** Update File: g/p2.py\n-a\n+A\n*** Update File: g/p3.py\n-b\n+B\n"), /g\/p3\.py: read the file/);
    assert.equal(get("g/p2.py"), "a\n");
    assert.equal(get("g/p3.py"), "b\n");
  });

  test("patch can add new files without reading anything", () => {
    assert.doesNotThrow(() => applyPatch("*** Add File: g/fresh.py\n+new\n"));
  });

  test("refuses to write over a directory", () => {
    fs.mkdirSync(path.join(dir, "g/folder"), { recursive: true });
    assert.throws(() => writeFile("g/folder", "x"), /is a directory/);
  });

  test("the refusal reaches the model as an error result", () => {
    put("g/tool.txt", "keep\n");
    const r = runTool("write", { path: "g/tool.txt", content: "lost" });
    assert.equal(r.isError, true);
    assert.match(r.output, /^error: g\/tool\.txt: read the file before you replace it/);
  });
});

describe("edit", () => {
  test("replaces a unique match and shows the change", () => {
    known("e/a.py", "def f():\n    return 1\n\ndef g():\n    return 2\n");
    const out = editFile("e/a.py", "    return 2", "    return 3");
    assert.equal(get("e/a.py"), "def f():\n    return 1\n\ndef g():\n    return 3\n");
    assert.match(out, /^Edited e\/a\.py: 1 replacement\n@@ line 5\n-    return 2\n\+    return 3$/);
  });

  test("refuses an ambiguous match and lists where it appears", () => {
    known("e/b.py", "x = 1\ny = 2\nx = 1\n");
    assert.throws(() => editFile("e/b.py", "x = 1", "x = 9"), /appears 2 times \(lines 1, 3\)/);
    assert.equal(get("e/b.py"), "x = 1\ny = 2\nx = 1\n");
  });

  test("replace_all changes every match", () => {
    known("e/c.py", "x = 1\ny = 2\nx = 1\n");
    assert.match(editFile("e/c.py", "x = 1", "x = 9", true), /2 replacements/);
    assert.equal(get("e/c.py"), "x = 9\ny = 2\nx = 9\n");
  });

  test("matches despite different indentation", () => {
    known("e/d.py", "class A:\n    def f(self):\n        return 1\n");
    const out = editFile("e/d.py", "def f(self):\n    return 1", "    def f(self):\n        return 2");
    assert.equal(get("e/d.py"), "class A:\n    def f(self):\n        return 2\n");
    assert.match(out, /matched ignoring indentation/);
  });

  test("matches despite trailing whitespace in the file", () => {
    known("e/e.py", "a = 1   \nb = 2\n");
    editFile("e/e.py", "a = 1\nb = 2", "a = 10\nb = 20");
    assert.equal(get("e/e.py"), "a = 10\nb = 20\n");
  });

  test("matches despite runs of spaces inside a line", () => {
    known("e/f.py", "total  =   a +  b\n");
    editFile("e/f.py", "total = a + b", "total = a - b");
    assert.equal(get("e/f.py"), "total = a - b\n");
  });

  test("prefers an exact match over a loose one", () => {
    assert.equal(findText("  x\nx\n", "x").strategy, "exact");
  });

  test("points to the closest line when nothing matches", () => {
    known("e/g.py", "def compute_total(items):\n    pass\n");
    assert.throws(() => editFile("e/g.py", "def compute_totl(items):", "def x():"), /closest line is 1: "def compute_total\(items\):"/);
  });

  test("says when the change already seems applied", () => {
    known("e/h.py", "value = 2\n");
    assert.throws(() => editFile("e/h.py", "value = 1", "value = 2"), /already there/);
  });

  test("rejects an empty old_string, a no-op edit and a missing file", () => {
    known("e/i.py", "a\n");
    assert.throws(() => editFile("e/i.py", "", "b"), /use write/);
    assert.throws(() => editFile("e/i.py", "a", "a"), /nothing to change/);
    assert.throws(() => editFile("e/none.py", "a", "b"), /file not found/);
  });

  test("can delete text by replacing it with nothing", () => {
    known("e/j.py", "keep\ndrop\nkeep2\n");
    editFile("e/j.py", "drop\n", "");
    assert.equal(get("e/j.py"), "keep\nkeep2\n");
  });
});

describe("parsePatch", () => {
  test("reads update, add, delete and move sections", () => {
    const ops = parsePatch(
      [
        "*** Begin Patch",
        "*** Update File: a.py",
        "@@ def f",
        " ctx",
        "-old",
        "+new",
        "*** Add File: b.py",
        "+hello",
        "*** Delete File: c.py",
        "*** Move File: d.py -> e.py",
        "*** End Patch",
      ].join("\n"),
    );
    assert.deepEqual(ops, [
      {
        kind: "update",
        path: "a.py",
        hunks: [{ hint: "def f", lines: [{ op: " ", text: "ctx" }, { op: "-", text: "old" }, { op: "+", text: "new" }] }],
      },
      { kind: "add", path: "b.py", lines: ["hello"] },
      { kind: "delete", path: "c.py" },
      { kind: "move", path: "d.py", to: "e.py" },
    ]);
  });

  test("works without the begin and end markers and with Windows line endings", () => {
    const ops = parsePatch("*** Update File: a.py\r\n-x\r\n+y\r\n");
    assert.deepEqual(ops, [{ kind: "update", path: "a.py", hunks: [{ lines: [{ op: "-", text: "x" }, { op: "+", text: "y" }] }] }]);
  });

  test("reads a Move to line inside an update", () => {
    const [op] = parsePatch("*** Begin Patch\n*** Update File: a.py\n*** Move to: b.py\n-x\n+y\n*** End Patch");
    assert.equal(op.kind === "update" && op.moveTo, "b.py");
  });

  test("splits hunks at each @@ line and strips trailing @@", () => {
    const [op] = parsePatch("*** Update File: a.py\n@@ class A @@\n-1\n+2\n@@\n-3\n+4\n");
    assert.ok(op.kind === "update");
    assert.equal(op.hunks.length, 2);
    assert.equal(op.hunks[0].hint, "class A");
    assert.equal(op.hunks[1].hint, undefined);
  });

  test("treats a line with no prefix as context", () => {
    const [op] = parsePatch("*** Update File: a.py\nplain\n-x\n+y\n");
    assert.ok(op.kind === "update");
    assert.deepEqual(op.hunks[0].lines[0], { op: " ", text: "plain" });
  });

  test("rejects a patch with no file sections, an add line without +, and an empty update", () => {
    assert.throws(() => parsePatch("*** Begin Patch\n*** End Patch"), /no file sections/);
    assert.throws(() => parsePatch("*** Add File: a.py\nno plus"), /must start with "\+"/);
    assert.throws(() => parsePatch("*** Update File: a.py\n*** End Patch"), /no changes found/);
    assert.throws(() => parsePatch("stray text\n*** Update File: a.py\n-a\n+b"), /outside a file section/);
  });
});

describe("applyPatch", () => {
  test("updates a file using context lines", () => {
    known("p/a.py", "def f():\n    x = 1\n    return x\n");
    const out = applyPatch("*** Begin Patch\n*** Update File: p/a.py\n def f():\n-    x = 1\n+    x = 2\n     return x\n*** End Patch");
    assert.equal(get("p/a.py"), "def f():\n    x = 2\n    return x\n");
    assert.equal(out, "Applied patch: updated p/a.py");
  });

  test("applies several hunks in one file", () => {
    known("p/b.py", "a = 1\nb = 2\nc = 3\nd = 4\n");
    applyPatch("*** Update File: p/b.py\n@@\n-a = 1\n+a = 10\n@@\n-d = 4\n+d = 40\n");
    assert.equal(get("p/b.py"), "a = 10\nb = 2\nc = 3\nd = 40\n");
  });

  test("adds, deletes and moves files", () => {
    known("p/old.py", "bye\n");
    known("p/move.py", "moving\n");
    const out = applyPatch(
      "*** Begin Patch\n*** Add File: p/new/hello.py\n+print('hi')\n+print('there')\n*** Delete File: p/old.py\n*** Move File: p/move.py -> p/moved.py\n*** End Patch",
    );
    assert.equal(get("p/new/hello.py"), "print('hi')\nprint('there')\n");
    assert.ok(!exists("p/old.py"));
    assert.ok(!exists("p/move.py"));
    assert.equal(get("p/moved.py"), "moving\n");
    assert.equal(out, "Applied patch: added p/new/hello.py, deleted p/old.py, moved p/move.py -> p/moved.py");
  });

  test("updates and renames a file with Move to", () => {
    known("p/src.py", "x = 1\n");
    applyPatch("*** Update File: p/src.py\n*** Move to: p/dst.py\n-x = 1\n+x = 2\n");
    assert.ok(!exists("p/src.py"));
    assert.equal(get("p/dst.py"), "x = 2\n");
  });

  test("changes nothing when any part of the patch fails", () => {
    known("p/one.py", "one\n");
    known("p/two.py", "two\n");
    assert.throws(
      () => applyPatch("*** Update File: p/one.py\n-one\n+ONE\n*** Update File: p/two.py\n-missing\n+X\n"),
      /Update File p\/two\.py, change 1: the text to replace was not found/,
    );
    assert.equal(get("p/one.py"), "one\n");
    assert.equal(get("p/two.py"), "two\n");
  });

  test("refuses to add a file that exists, or to update or delete one that doesn't", () => {
    known("p/here.py", "x\n");
    assert.throws(() => applyPatch("*** Add File: p/here.py\n+y"), /already exists/);
    assert.throws(() => applyPatch("*** Update File: p/nowhere.py\n-a\n+b"), /does not exist; use Add File/);
    assert.throws(() => applyPatch("*** Delete File: p/nowhere.py"), /does not exist/);
  });

  test("inserts added-only lines after the @@ line", () => {
    known("p/ins.py", "import os\n\ndef main():\n    pass\n");
    applyPatch("*** Update File: p/ins.py\n@@ import os\n+import sys\n");
    assert.equal(get("p/ins.py"), "import os\nimport sys\n\ndef main():\n    pass\n");
  });

  test("appends added-only lines to the end when there is no @@ line", () => {
    known("p/app.py", "a = 1\n");
    applyPatch("*** Update File: p/app.py\n+b = 2\n");
    assert.equal(get("p/app.py"), "a = 1\nb = 2\n");
  });

  test("uses the @@ line to pick between repeated blocks", () => {
    known("p/rep.py", "def a():\n    return 0\n\ndef b():\n    return 0\n");
    applyPatch("*** Update File: p/rep.py\n@@ def b():\n-    return 0\n+    return 1\n");
    assert.equal(get("p/rep.py"), "def a():\n    return 0\n\ndef b():\n    return 1\n");
  });

  test("tolerates indentation drift in the patch", () => {
    known("p/drift.py", "if x:\n        y = 1\n");
    applyPatch("*** Update File: p/drift.py\n if x:\n-    y = 1\n+        y = 2\n");
    assert.equal(get("p/drift.py"), "if x:\n        y = 2\n");
  });

  test("ignores the End of File marker and the no-newline marker", () => {
    known("p/eof.py", "last\n");
    applyPatch("*** Update File: p/eof.py\n-last\n+final\n\\ No newline at end of file\n*** End of File\n");
    assert.equal(get("p/eof.py"), "final\n");
  });

  test("applies changes to the same file in sequence across sections", () => {
    known("p/seq.py", "a\n");
    applyPatch("*** Update File: p/seq.py\n-a\n+b\n*** Update File: p/seq.py\n-b\n+c\n");
    assert.equal(get("p/seq.py"), "c\n");
  });
});

describe("runTool", () => {
  test("offers exactly bash, read, write, edit and patch, each with required arguments", () => {
    assert.deepEqual(TOOLS.map((t) => t.name), ["bash", "read", "write", "edit", "patch"]);
    for (const t of TOOLS) {
      const params = t.parameters as { type: string; required: string[]; properties: Record<string, unknown> };
      assert.equal(params.type, "object");
      assert.ok(params.required.length > 0);
      for (const r of params.required) assert.ok(r in params.properties, `${t.name}.${r}`);
      assert.ok(t.description.length > 20);
    }
  });

  test("runs a tool by name", () => {
    put("t/a.txt", "hi\n");
    assert.deepEqual(runTool("read", { path: "t/a.txt" }), { output: "     1\thi", isError: false });
  });

  test("reports an unknown tool and lists the real ones", () => {
    const r = runTool("browse", {});
    assert.equal(r.isError, true);
    assert.match(r.output, /unknown tool "browse".*bash, read, write, edit, patch/);
  });

  test("reports missing, empty and mistyped arguments as errors", () => {
    assert.match(runTool("read", {}).output, /missing required argument "path"/);
    assert.match(runTool("bash", { command: "" }).output, /must not be empty/);
    assert.match(runTool("write", { path: "x", content: 5 }).output, /"content" must be a string/);
    assert.match(runTool("read", { path: "t/a.txt", offset: "abc" }).output, /"offset" must be a number/);
    assert.match(runTool("edit", { path: "t/a.txt", old_string: "hi", new_string: "yo", replace_all: "maybe" }).output, /true or false/);
    assert.equal(runTool("read", {}).isError, true);
  });

  test("accepts numbers and booleans sent as strings", () => {
    put("t/n.txt", "1\n2\n3\n");
    assert.equal(runTool("read", { path: "t/n.txt", offset: "2", limit: "1" }).output, "     2\t2\n\n[1 more lines; read again with offset=3]");
    known("t/b.txt", "a a\n");
    assert.equal(runTool("edit", { path: "t/b.txt", old_string: "a", new_string: "b", replace_all: "true" }).isError, false);
    assert.equal(get("t/b.txt"), "b b\n");
  });

  test("rejects arguments that are not an object", () => {
    assert.match(runTool("bash", "ls").output, /must be a JSON object/);
    assert.match(runTool("bash", ["ls"]).output, /must be a JSON object/);
    assert.match(runTool("bash", null).output, /must be a JSON object/);
  });

  test("turns a tool failure into an error result instead of throwing", () => {
    const r = runTool("edit", { path: "t/missing.txt", old_string: "a", new_string: "b" });
    assert.equal(r.isError, true);
    assert.match(r.output, /^error: file not found/);
  });

  test("a failing command is a normal result, not a tool error", () => {
    assert.deepEqual(runTool("bash", { command: "exit 2" }), { output: "[exit code: 2]", isError: false });
  });
});
