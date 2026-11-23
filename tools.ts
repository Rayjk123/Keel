// The native tools: bash, read, write, edit and patch, each a plain function from arguments to text.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type ToolDef = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export class ToolError extends Error {}

type Args = Record<string, unknown>;
type Tool = ToolDef & { run(args: Args): string };

const MAX_OUTPUT_CHARS = 10_000;
const HEAD_CHARS = 2_000;
const DEFAULT_TIMEOUT_S = 120;
const MAX_TIMEOUT_S = 600;
const DEFAULT_READ_LINES = 2_000;
const MAX_LINE_CHARS = 2_000;

function str(args: Args, key: string, { optional = false, allowEmpty = true } = {}): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) {
    if (optional) return undefined;
    throw new ToolError(`missing required argument "${key}"`);
  }
  if (typeof value !== "string") throw new ToolError(`argument "${key}" must be a string`);
  if (!allowEmpty && value === "") throw new ToolError(`argument "${key}" must not be empty`);
  return value;
}

function num(args: Args, key: string): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new ToolError(`argument "${key}" must be a number`);
  return n;
}

function bool(args: Args, key: string): boolean {
  const value = args[key];
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "false") return value === "true";
  throw new ToolError(`argument "${key}" must be true or false`);
}

export function clip(text: string, max = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  const tail = max - HEAD_CHARS;
  const dropped = text.length - HEAD_CHARS - tail;
  return `${text.slice(0, HEAD_CHARS)}\n... [${dropped} characters omitted] ...\n${text.slice(-tail)}`;
}

const resolve = (p: string) => path.resolve(process.cwd(), p);

const seen = new Map<string, string>();
const fingerprint = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
function identity(p: string): string {
  const full = resolve(p);
  try {
    return fs.realpathSync(full);
  } catch {
    return full;
  }
}
const remember = (p: string, content: string) => seen.set(identity(p), fingerprint(content));

export function forgetFiles(): void {
  seen.clear();
}

function readText(p: string): string {
  const full = resolve(p);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new ToolError(`file not found: ${p}`);
  }
  if (stat.isDirectory()) throw new ToolError(`${p} is a directory; use bash with ls to list it`);
  const buf = fs.readFileSync(full);
  if (buf.subarray(0, 8192).includes(0)) throw new ToolError(`${p} looks like a binary file`);
  return buf.toString("utf8");
}

function writeText(p: string, content: string): void {
  const full = resolve(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  remember(p, content);
}

const lineCount = (text: string) => (text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0));

export function shell(command: string, timeoutS = DEFAULT_TIMEOUT_S): string {
  const r = spawnSync("bash", ["-c", command], {
    encoding: "utf8",
    timeout: Math.min(Math.max(timeoutS, 1), MAX_TIMEOUT_S) * 1000,
    maxBuffer: 50 * 1024 * 1024,
  });
  const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  if (r.error && (r.error as NodeJS.ErrnoException).code === "ETIMEDOUT") {
    return clip(`${output}\n[timed out after ${timeoutS}s; the command was stopped]`);
  }
  if (r.error) return `[could not run command: ${r.error.message}]`;
  const status = r.status ?? `signal ${r.signal}`;
  return clip(`${output}${output && !output.endsWith("\n") ? "\n" : ""}[exit code: ${status}]`);
}

export function readFile(p: string, offset = 1, limit = DEFAULT_READ_LINES): string {
  const text = readText(p);
  remember(p, text);
  if (text === "") return "(empty file)";
  const lines = text.split("\n");
  if (text.endsWith("\n")) lines.pop();
  if (offset < 1) throw new ToolError("offset must be 1 or more");
  if (offset > lines.length) throw new ToolError(`offset ${offset} is past the end of the file (${lines.length} lines)`);
  const end = Math.min(lines.length, offset - 1 + Math.max(1, limit));
  const body = lines
    .slice(offset - 1, end)
    .map((line, i) => {
      const shown = line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}... [line cut]` : line;
      return `${String(offset + i).padStart(6)}\t${shown}`;
    })
    .join("\n");
  const rest = lines.length - end;
  return rest > 0 ? `${body}\n\n[${rest} more lines; read again with offset=${end + 1}]` : body;
}

function requireRead(p: string, action: string): void {
  const full = resolve(p);
  if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return;
  const known = seen.get(identity(p));
  if (known === undefined) throw new ToolError(`${p}: read the file before you ${action} it`);
  if (known !== fingerprint(fs.readFileSync(full))) {
    throw new ToolError(`${p} has changed since you last read it. Read it again before you ${action} it.`);
  }
}

export function writeFile(p: string, content: string): string {
  const full = resolve(p);
  const existed = fs.existsSync(full);
  if (existed && fs.statSync(full).isDirectory()) throw new ToolError(`${p} is a directory`);
  requireRead(p, "replace");
  writeText(p, content);
  return `${existed ? "Overwrote" : "Created"} ${p} (${lineCount(content)} lines)`;
}

type Span = { start: number; end: number };
type Strategy = { name: string; find(content: string, pattern: string): Span[] };

function exactSpans(content: string, pattern: string): Span[] {
  const spans: Span[] = [];
  if (!pattern) return spans;
  for (let i = content.indexOf(pattern); i !== -1; i = content.indexOf(pattern, i + pattern.length)) {
    spans.push({ start: i, end: i + pattern.length });
  }
  return spans;
}

function lineSpans(normalize: (line: string) => string) {
  return (content: string, pattern: string): Span[] => {
    const want = pattern.replace(/\n+$/, "").split("\n").map(normalize);
    while (want.length && want[0] === "") want.shift();
    while (want.length && want[want.length - 1] === "") want.pop();
    if (!want.length) return [];
    const lines = content.split("\n");
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
    }
    const spans: Span[] = [];
    for (let i = 0; i + want.length <= lines.length; i++) {
      let ok = true;
      for (let j = 0; j < want.length && ok; j++) ok = normalize(lines[i + j]) === want[j];
      if (ok) {
        const last = i + want.length - 1;
        spans.push({ start: starts[i], end: starts[last] + lines[last].length });
        i = last;
      }
    }
    return spans;
  };
}

const STRATEGIES: Strategy[] = [
  { name: "exact", find: exactSpans },
  { name: "ignoring trailing whitespace", find: lineSpans((l) => l.trimEnd()) },
  { name: "ignoring indentation", find: lineSpans((l) => l.trim()) },
  { name: "ignoring whitespace differences", find: lineSpans((l) => l.trim().replace(/\s+/g, " ")) },
];

export type Match = { spans: Span[]; strategy: string };

export function findText(content: string, pattern: string): Match {
  for (const s of STRATEGIES) {
    const spans = s.find(content, pattern);
    if (spans.length) return { spans, strategy: s.name };
  }
  return { spans: [], strategy: "none" };
}

function bigrams(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
  return m;
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const x = bigrams(a);
  let shared = 0;
  for (const [k, n] of bigrams(b)) shared += Math.min(n, x.get(k) ?? 0);
  return (2 * shared) / (a.length + b.length - 2);
}

function closestLine(content: string, pattern: string): string {
  const first = pattern.split("\n").map((l) => l.trim()).find(Boolean);
  if (!first) return "";
  let best = { score: 0, line: 0, text: "" };
  content.split("\n").forEach((text, i) => {
    const score = similarity(first, text.trim());
    if (score > best.score) best = { score, line: i + 1, text };
  });
  return best.score >= 0.5 ? ` The closest line is ${best.line}: ${JSON.stringify(best.text.trim())}.` : "";
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function changeSummary(before: string, start: number, oldText: string, newText: string): string {
  const line = lineOf(before, start);
  const show = (prefix: string, text: string) =>
    text === "" ? [] : text.split("\n").slice(0, 20).map((l) => `${prefix}${l}`);
  const removed = show("-", oldText);
  const added = show("+", newText);
  return [`@@ line ${line}`, ...removed, ...added].join("\n");
}

export function replaceText(content: string, oldText: string, newText: string, replaceAll: boolean, label: string) {
  const match = findText(content, oldText);
  if (!match.spans.length) {
    if (newText && content.includes(newText)) {
      throw new ToolError(`${label}: the text to replace was not found, but the new text is already there, so the change may already be applied`);
    }
    throw new ToolError(`${label}: the text to replace was not found. Read the file again and copy the text exactly.${closestLine(content, oldText)}`);
  }
  if (match.spans.length > 1 && !replaceAll) {
    const lines = match.spans.map((s) => lineOf(content, s.start)).join(", ");
    throw new ToolError(`${label}: the text to replace appears ${match.spans.length} times (lines ${lines}). Include more surrounding lines to pick one, or set replace_all to true.`);
  }
  let result = "";
  let cursor = 0;
  for (const s of match.spans) {
    result += content.slice(cursor, s.start) + newText;
    cursor = s.end;
  }
  result += content.slice(cursor);
  const first = match.spans[0];
  return {
    content: result,
    count: match.spans.length,
    strategy: match.strategy,
    summary: changeSummary(content, first.start, content.slice(first.start, first.end), newText),
  };
}

export function editFile(p: string, oldText: string, newText: string, replaceAll = false): string {
  if (oldText === "") throw new ToolError("old_string is empty; use write to create a file");
  if (oldText === newText) throw new ToolError("old_string and new_string are the same, so there is nothing to change");
  const content = readText(p);
  requireRead(p, "edit");
  const r = replaceText(content, oldText, newText, replaceAll, p);
  writeText(p, r.content);
  const how = r.strategy === "exact" ? "" : ` (matched ${r.strategy})`;
  return `Edited ${p}: ${r.count} replacement${r.count === 1 ? "" : "s"}${how}\n${r.summary}`;
}

type Hunk = { hint?: string; lines: { op: " " | "-" | "+"; text: string }[] };
type PatchOp =
  | { kind: "add"; path: string; lines: string[] }
  | { kind: "delete"; path: string }
  | { kind: "update"; path: string; moveTo?: string; hunks: Hunk[] }
  | { kind: "move"; path: string; to: string };

const BEGIN = /^\*\*\*\s*Begin\s+Patch\s*$/;
const END = /^\*\*\*\s*End\s+Patch\s*$/;
const ADD = /^\*\*\*\s*Add\s+File:\s*(.+?)\s*$/;
const DELETE = /^\*\*\*\s*Delete\s+File:\s*(.+?)\s*$/;
const UPDATE = /^\*\*\*\s*Update\s+File:\s*(.+?)\s*$/;
const MOVE_FILE = /^\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+?)\s*$/;
const MOVE_TO = /^\*\*\*\s*Move\s+to:\s*(.+?)\s*$/;
const END_OF_FILE = /^\*\*\*\s*End\s+of\s+File\s*$/;

export function parsePatch(text: string): PatchOp[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const start = lines.findIndex((l) => BEGIN.test(l));
  const endAt = lines.findIndex((l, i) => i > start && END.test(l));
  const body = lines.slice(start + 1, endAt === -1 ? lines.length : endAt);
  const ops: PatchOp[] = [];
  let current: PatchOp | undefined;
  let hunk: Hunk | undefined;
  const flushHunk = () => {
    while (hunk?.lines.length && hunk.lines[hunk.lines.length - 1].op === " " && hunk.lines[hunk.lines.length - 1].text.trim() === "") {
      hunk.lines.pop();
    }
    if (current?.kind === "update" && hunk && hunk.lines.length) current.hunks.push(hunk);
    hunk = undefined;
  };
  const flush = () => {
    flushHunk();
    if (current) ops.push(current);
    current = undefined;
  };
  for (const line of body) {
    let m: RegExpMatchArray | null;
    if ((m = line.match(ADD))) {
      flush();
      current = { kind: "add", path: m[1], lines: [] };
    } else if ((m = line.match(DELETE))) {
      flush();
      ops.push({ kind: "delete", path: m[1] });
    } else if ((m = line.match(MOVE_FILE))) {
      flush();
      ops.push({ kind: "move", path: m[1], to: m[2] });
    } else if ((m = line.match(UPDATE))) {
      flush();
      current = { kind: "update", path: m[1], hunks: [] };
    } else if ((m = line.match(MOVE_TO)) && current?.kind === "update") {
      current.moveTo = m[1];
    } else if (END_OF_FILE.test(line)) {
      continue;
    } else if (current?.kind === "add") {
      if (line.startsWith("+")) current.lines.push(line.slice(1));
      else if (line !== "") throw new ToolError(`Add File ${current.path}: every line must start with "+"`);
    } else if (current?.kind === "update") {
      if (line.startsWith("@@")) {
        flushHunk();
        const hint = line.replace(/^@@\s*/, "").replace(/\s*@@\s*$/, "").trim();
        hunk = { hint: hint || undefined, lines: [] };
      } else if (line.startsWith("\\")) {
        continue;
      } else {
        hunk ??= { lines: [] };
        const op = line[0];
        if (op === "+" || op === "-" || op === " ") hunk.lines.push({ op, text: line.slice(1) });
        else hunk.lines.push({ op: " ", text: line });
      }
    } else if (line.trim() !== "") {
      throw new ToolError(`unexpected line outside a file section: ${JSON.stringify(line)}`);
    }
  }
  flush();
  if (!ops.length) throw new ToolError("the patch has no file sections; start one with *** Update File:, *** Add File: or *** Delete File:");
  for (const op of ops) {
    if (op.kind === "update" && !op.hunks.length && !op.moveTo) throw new ToolError(`Update File ${op.path}: no changes found`);
  }
  return ops;
}

function trimBlankEdges(lines: string[]): string[] {
  let a = 0;
  let b = lines.length;
  while (a < b && lines[a].trim() === "") a++;
  while (b > a && lines[b - 1].trim() === "") b--;
  return lines.slice(a, b);
}

function applyHunk(content: string, hunk: Hunk, label: string): string {
  const before = hunk.lines.filter((l) => l.op !== "+").map((l) => l.text);
  const after = hunk.lines.filter((l) => l.op !== "-").map((l) => l.text);
  if (!hunk.lines.some((l) => l.op !== " ")) return content;
  if (!trimBlankEdges(before).length) {
    const insert = after.join("\n");
    if (hunk.hint) {
      const match = findText(content, hunk.hint);
      if (!match.spans.length) throw new ToolError(`${label}: could not find the @@ line ${JSON.stringify(hunk.hint)}`);
      const lineEnd = content.indexOf("\n", match.spans[0].end);
      if (lineEnd === -1) return `${content}\n${insert}`;
      return `${content.slice(0, lineEnd + 1)}${insert}\n${content.slice(lineEnd + 1)}`;
    }
    return content === "" || content.endsWith("\n") ? `${content}${insert}\n` : `${content}\n${insert}\n`;
  }
  const oldText = before.join("\n");
  const newText = after.join("\n");
  const match = findText(content, oldText);
  if (match.spans.length > 1 && hunk.hint) {
    const anchor = findText(content, hunk.hint).spans[0];
    const pick = anchor && match.spans.find((s) => s.start >= anchor.start);
    if (pick) return content.slice(0, pick.start) + newText + content.slice(pick.end);
  }
  return replaceText(content, oldText, newText, false, label).content;
}

export function applyPatch(text: string): string {
  const ops = parsePatch(text);
  const files = new Map<string, string | null>();
  const current = (p: string, action: string) => {
    if (files.has(p)) return files.get(p)!;
    if (!fs.existsSync(resolve(p))) return null;
    const content = readText(p);
    if (action) requireRead(p, action);
    return content;
  };
  const done: string[] = [];
  for (const op of ops) {
    if (op.kind === "add") {
      if (current(op.path, "") !== null) throw new ToolError(`Add File ${op.path}: the file already exists; use Update File`);
      files.set(op.path, op.lines.length ? `${op.lines.join("\n")}\n` : "");
      done.push(`added ${op.path}`);
    } else if (op.kind === "delete") {
      if (current(op.path, "delete") === null) throw new ToolError(`Delete File ${op.path}: the file does not exist`);
      files.set(op.path, null);
      done.push(`deleted ${op.path}`);
    } else if (op.kind === "move") {
      const content = current(op.path, "move");
      if (content === null) throw new ToolError(`Move File ${op.path}: the file does not exist`);
      files.set(op.path, null);
      files.set(op.to, content);
      done.push(`moved ${op.path} -> ${op.to}`);
    } else {
      let content = current(op.path, "patch");
      if (content === null) throw new ToolError(`Update File ${op.path}: the file does not exist; use Add File`);
      op.hunks.forEach((h, i) => {
        content = applyHunk(content!, h, `Update File ${op.path}, change ${i + 1}`);
      });
      if (op.moveTo) {
        files.set(op.path, null);
        files.set(op.moveTo, content);
        done.push(`updated ${op.path} and moved it to ${op.moveTo}`);
      } else {
        files.set(op.path, content);
        done.push(`updated ${op.path}`);
      }
    }
  }
  for (const [p, content] of files) {
    if (content === null) fs.rmSync(resolve(p), { force: true });
  }
  for (const [p, content] of files) {
    if (content !== null) writeText(p, content);
  }
  return `Applied patch: ${done.join(", ")}`;
}

export const TOOLS: Tool[] = [
  {
    name: "bash",
    description:
      "Run a bash command in the working directory and return its combined stdout and stderr, followed by the exit code. " +
      "Each call starts a new shell, so prefix commands with `cd dir &&` when needed. Use it to run programs, tests, git and searches.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command to run" },
        timeout: { type: "number", description: `Seconds before the command is stopped (default ${DEFAULT_TIMEOUT_S}, at most ${MAX_TIMEOUT_S})` },
      },
      required: ["command"],
    },
    run: (a) => shell(str(a, "command", { allowEmpty: false })!, num(a, "timeout") ?? DEFAULT_TIMEOUT_S),
  },
  {
    name: "read",
    description:
      `Read a text file and return its lines with line numbers. Returns up to ${DEFAULT_READ_LINES} lines; use offset and limit to page through long files.`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file, absolute or relative to the working directory" },
        offset: { type: "number", description: "Line number to start from (1 is the first line)" },
        limit: { type: "number", description: "Maximum number of lines to return" },
      },
      required: ["path"],
    },
    run: (a) => readFile(str(a, "path", { allowEmpty: false })!, num(a, "offset") ?? 1, num(a, "limit") ?? DEFAULT_READ_LINES),
  },
  {
    name: "write",
    description: "Create a file, or replace a file's whole contents. Read an existing file before replacing it. Creates missing parent directories. Prefer edit or patch to change part of an existing file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        content: { type: "string", description: "The complete new contents of the file" },
      },
      required: ["path", "content"],
    },
    run: (a) => writeFile(str(a, "path", { allowEmpty: false })!, str(a, "content")!),
  },
  {
    name: "edit",
    description:
      "Replace text in a file you have read. old_string must match the file's text and appear once, unless replace_all is true. " +
      "Matching tolerates differences in indentation and trailing whitespace. Include a few surrounding lines so the match is unique.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        old_string: { type: "string", description: "The existing text to replace" },
        new_string: { type: "string", description: "The text to put in its place" },
        replace_all: { type: "boolean", description: "Replace every occurrence instead of exactly one" },
      },
      required: ["path", "old_string", "new_string"],
    },
    run: (a) =>
      editFile(str(a, "path", { allowEmpty: false })!, str(a, "old_string")!, str(a, "new_string")!, bool(a, "replace_all")),
  },
  {
    name: "patch",
    description: [
      "Apply a patch that can change, add, delete or move several files at once. Read each existing file it touches first. Use this format:",
      "*** Begin Patch",
      "*** Update File: path/to/file.py",
      "@@ def function_name",
      " unchanged context line",
      "-line to remove",
      "+line to add",
      "*** Add File: path/to/new.py",
      "+first line of the new file",
      "*** Delete File: path/to/old.py",
      "*** End Patch",
      "In an update, lines starting with a space are context, - removes a line and + adds one. The @@ line is optional and names a nearby line to locate the change. To rename a file, put *** Move to: new/path right after its Update File line.",
    ].join("\n"),
    parameters: {
      type: "object",
      properties: { patch: { type: "string", description: "The patch text, from *** Begin Patch to *** End Patch" } },
      required: ["patch"],
    },
    run: (a) => applyPatch(str(a, "patch", { allowEmpty: false })!),
  },
];

export function runTool(name: string, args: unknown): { output: string; isError: boolean } {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { output: `error: unknown tool "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}`, isError: true };
  if (args === null || typeof args !== "object" || Array.isArray(args)) {
    return { output: `error: arguments for ${name} must be a JSON object`, isError: true };
  }
  try {
    return { output: tool.run(args as Args), isError: false };
  } catch (e) {
    if (e instanceof ToolError) return { output: `error: ${e.message}`, isError: true };
    const err = e as NodeJS.ErrnoException;
    return { output: `error: ${err.code ? `${err.code} ` : ""}${err.message}`, isError: true };
  }
}
