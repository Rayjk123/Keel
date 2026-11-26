# How it works

Keel is a loop with four steps.

```mermaid
flowchart LR
    A[Ask the model] --> B[Run its tools]
    B --> C[Show it the results]
    C --> A
```

1. **Ask.** Send the task, the conversation so far and the list of tools to the model.
2. **Act.** The model replies with one or more tool calls: run a command, read a file, edit it. Keel runs each one.
3. **Observe.** Each result goes back to the model, matched to the call that asked for it.
4. **Repeat** until the model replies without calling a tool, which means it is finished.

## The tools

Keel gives the model five tools, the same small set that Pi, Codex and Hermes build on. They live in `tools.ts`.

| Tool | What it does |
|---|---|
| `bash` | Runs a command and returns its output followed by the exit code. Takes an optional `timeout` in seconds. |
| `read` | Returns a file's lines with line numbers, 2,000 lines at a time, with `offset` and `limit` for paging. |
| `write` | Creates a file, or replaces a whole file, making any missing folders. |
| `edit` | Replaces one exact piece of text with another. The text must appear once, unless `replace_all` is set. |
| `patch` | Applies a patch that changes, adds, deletes or moves several files at once. |

### Forgiving edits

Models often get whitespace slightly wrong when they quote code back. When the exact text isn't found, `edit` tries looser matches in order: ignoring trailing whitespace, then indentation, then runs of spaces. It reports which one it used.

When nothing matches, the error points to the closest line in the file. If the new text is already there, it says the change may already be applied. Both help the model recover on its next turn.

### Read before you change

`write`, `edit` and `patch` only change a file the model has read, and only if it hasn't changed since, for example because a command rewrote it. Otherwise the model gets an error asking it to read the file first, and nothing is touched. That stops a model from overwriting code it never looked at, or editing from an out-of-date picture of a file.

Files the model created or changed itself count as read, so several edits in a row need only one read. Creating new files is always allowed. Claude Code uses the same rule.

### The patch format

`patch` uses the format Codex models are trained on:

```
*** Begin Patch
*** Update File: src/app.py
@@ def total
 def total(a, b):
-    return a - b
+    return a + b
*** Add File: src/util.py
+def helper():
+    return 1
*** Delete File: src/old.py
*** End Patch
```

Lines starting with a space are context, `-` removes a line and `+` adds one. The optional `@@` line names a nearby line, which picks the right spot when the same code appears twice. `*** Move to:` after an `Update File` line renames the file.

A patch applies all at once: if any part fails, no file changes.

## Native tool calling

Keel sends the tools in the request's `tools` field, and the model answers with structured `tool_calls`. This is how Claude Code, Codex and most modern agents talk to models. Models are trained on it, they can call several tools in one reply, and a tool call can't get lost in formatting.

The original text mode is still there. Set `ADAPTER=text` and Keel asks for one fenced `bash` block per reply instead, exactly as in the first version. It's useful for models or servers whose tool calling is unreliable, and for comparing the two on the [scoreboard](../benchmarks/index.md).

## What the model sees

A `bash` result is the command's output, with stdout and stderr together, followed by the exit code:

```
total 8
drwxr-xr-x  2 user  staff  64 Nov 20 09:00 .
[exit code: 0]
```

Output longer than 10,000 characters keeps its first 2,000 and last 8,000 characters, with a note of how much was left out. That way the model sees both how a command started and how it ended.

A tool that fails returns a message starting with `error:`, such as a missing file or an edit that didn't match. The run carries on, so the model can fix its call.

## The model's reasoning

When the server returns a model's reasoning with a reply, Keel keeps it and sends it back unchanged with that reply on every later turn, so the model builds on its earlier thinking instead of starting again. Keel reads the text from `message.reasoning`, the field Ollama and OpenRouter use, and keeps `message.reasoning_details` as an opaque list. It only looks inside to join a streamed entry's pieces, which share an `index`. Both modes do this, and in text mode a `bash` block inside the reasoning is never run. A reply Keel leaves out of the history, because it was cut off or, in text mode, had no command, leaves its reasoning out too.

## Streaming

Keel asks for a streamed reply (`stream: true`, with `stream_options.include_usage`) and joins the pieces into one message: the text, the tool calls by their `index`, the reasoning, the finish reason and the usage. A server that answers with plain JSON instead works too. A reply can take as long as it needs while it keeps arriving, but if the server sends nothing at all for 5 minutes, Keel gives up on that request and retries it. A server can keep a quiet connection open with SSE comments such as `: keepalive`.

An error the server sends inside the stream, as `data: {"error": {"message": ..., "code": ...}}`, fails the request like an HTTP error with that code: a client error such as 400 stops the run, and anything else is retried. So is a stream that ends before its finish reason.

## Usage

Set `USAGE_FILE` to a path, and Keel writes the task's running totals there as JSON after every reply: `steps` (model replies), `input_tokens`, `output_tokens`, `cache_read_tokens` and `cache_write_tokens`. They add up each reply's `usage`: input is `prompt_tokens`, which includes cached tokens, cache reads are `prompt_tokens_details.cached_tokens`, cache writes are `prompt_tokens_details.cache_write_tokens`, and output is `completion_tokens`, reasoning included. Failed attempts don't count. The benchmark scripts set it, so every task records what it used.

## Finishing a task

The model finishes by replying without a tool call. Keel then asks once to confirm: if the task is done, the model replies again with a short summary, and that summary is the final answer. If it isn't, the model just carries on calling tools.

The check catches models that describe their next step in words and forget to call the tool.

A reply cut off at the output limit doesn't count as finishing. Keel runs none of it and tells the model to reply again more briefly. Format tokens that leak into a tool name, such as `bash<|channel|>analysis`, are dropped, so the call still reaches the `bash` tool.

## Limits

| Limit | Value |
|---|---|
| Model replies per task | 200, or `MAX_STEPS` |
| Time per command | 120 seconds, up to 600 when the model asks |
| Output kept per command | 10,000 characters |
| Lines per read | 2,000 |
| Retries when the model server fails | 3, with a growing pause |
| Silence before a request is retried | 5 minutes, or `IDLE_TIMEOUT_MS` |

If the server still fails after the retries, Keel stops the run cleanly and reports the error, so a benchmark records a result for the task.
