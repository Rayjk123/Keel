# Benchmarks

Keel is scored on Terminal-Bench 4.0, Terminal-Bench 2.0, Aider Polyglot and SWE-bench Lite, with the same 10 hand-picked tasks from each every time. Keel includes an adapter for [Harbor](https://harborframework.com) (install it with `uv tool install harbor`), which runs each task in its own Docker container, runs Keel inside it, and scores the result with the task's official tests.

Every change to the harness gets a score. The chart has one row per run, best overall first, and one column per benchmark, so you can watch the success rate move as Keel gains new abilities. To run the benchmarks yourself or add a run, see [Running the benchmarks](running.md).

![Pass rate by benchmark for each run](../../../assets/charts/scoreboard.svg)

## Scoreboard

--8<-- "runs/scoreboard.md"

Each cell is tasks passed out of tasks attempted. Every run uses the same 10 hand-picked tasks per benchmark (the lists are in `bench/subsets/`), so a bar going up means the harness got better, not that the questions got easier.

## What native tools changed

Moving from one bash block per reply to real tool calls with `bash`, `read`, `write`, `edit` and `patch`:

| Model | Baseline | Native tools |
|---|---|---|
| qwen3-coder:30b | 5/40 | 11/40 |
| gpt-oss:20b | 2/40 | 10/40 |
| devstral:24b | 4/40 | 3/40 |

Qwen more than doubled and GPT-OSS went from 2 to 10, with the biggest gains on SWE-bench Lite and Aider Polyglot, where precise edits matter most. Devstral went the other way: it often announces its next step ("I'll search for the class") and stops without calling a tool, so on SWE-bench Lite it left 9 of 10 tasks untouched. That points at the next harness change: deciding when the model is really finished.

On Bedrock, at default effort:

| Model | Baseline | Native tools |
|---|---|---|
| Claude Haiku 5.5 | 19/40 | 21/40 |
| Claude Sonnet 5.5 | 25/40 | 24/40 |
| Claude Opus 5.5 | 28/40 | 27/40 |
| GPT-6.2 Astra | 15/40 | 28/40 |
| GPT-6.2 Sol | 1/40 | 27/40 |
| GPT-6.1 Terra | 5/40 | 23/40 |
| GPT-OSS 120B | 4/40 | 13/40 |
| Qwen3 Coder 480B | 13/40 | 14/40 |
| Kimi K2.5 | 18/40 | 20/40 |
| Grok 4.7 | 23/40 | 24/40 |
| GLM 5 | 16/40 | 21/40 |
| GLM 4.7 Flash | 6/40 | 7/40 |

The GPT-6 models gain the most, because they no longer have to fit a turn into one bash block: GPT-6.2 Sol goes from 1 to 27. Most other models move by a task or two. GPT-OSS 20B did worse on Bedrock than on Ollama, 5 against 10 with native tools, because 26 of its tasks ended with format tokens leaking into a tool name, such as `bash<|channel|>analysis`, which Bedrock refuses.

## Why tasks fail

Every task gets one reason, taken from the trial's own records: Harbor's result and exception, Keel's last log line, and SWE-bench's grading report. Each row adds up to the 40 tasks.

--8<-- "runs/failures.md"

| Reason | What happened |
|---|---|
| `wrong-answer` | Keel finished, but the task's tests failed or the patch didn't fix the issue |
| `no-patch` | SWE-bench Lite: Keel finished without changing the code |
| `no-command` | three replies in a row without exactly one command, so Keel stopped |
| `malformed-tool-call` | the model's tool call couldn't be parsed or used, such as a tool name with stray format tokens |
| `step-limit` | Keel used all 50 steps |
| `request-timeout` | a model reply didn't start within Node's 5-minute limit, or took longer than Keel's 10-minute one |
| `context-limit` | the conversation outgrew the model's context window |
| `task-time-limit` | the task's own time budget ran out |
| `refused` | a model or Bedrock safety filter declined the request |
| `model-error` | another failed model request |
| `unsupported` | the task needs something Keel lacks, such as skills |
| `environment` | the task couldn't start or couldn't be graded |
| `not-run` | the task never ran |

Four patterns stand out:

- **One command per reply is the biggest cause of failure in the text harness.** GPT-6.2 Sol and GPT-6.1 Terra often chain several commands into one reply, which counts as no command: Terra stopped that way on 33 of its 40 tasks.
- **In the text harness, max effort hurt Claude by running out of output.** At max effort, Claude often spent the whole 32,000-token output limit thinking, so the reply was cut off before its command: 78 of 297 Haiku replies, 47 of 574 Sonnet replies and 23 of 543 Opus replies, according to `runs/text-and-bash/bedrock-proxy-max-effort.log`. Keel doesn't check why a reply ended, so a cut-off reply looks like one without a command, which is the likely reason `no-command` rose from 1 to 19 for Haiku.
- **With native tools, max effort still hurt Claude, now mostly through time.** Claude Sonnet 5.5 dropped from 24 to 12 and Opus from 27 to 16, largely on tasks that ran out of their time budget (11 for Sonnet, 6 for Opus). The GPT-6 models went the other way: Astra rose from 28 to 31 and Terra from 23 to 29.
- **In the text harness, GPT-6.2 Astra was steady.** It passed 15 tasks at default effort and 14 at max. The swings between benchmarks are within the noise of 10-task samples, and 2 of its max-effort failures were request timeouts.

## How a run is scored

- **Pass means the official tests passed.** Terminal-Bench and Aider Polyglot run each task's own tests in its container. SWE-bench Lite is graded by the SWE-bench harness.
- **Errors count as failures.** If a task can't start or can't be graded, it scores zero, because the harness is what has to cope with it.
- **Same tasks every time.** The task lists are fixed, so runs are comparable. Growing a list starts a new series.
- **Everything is recorded.** Each run lives in `runs/<trial>/<run>/` with a `manifest.json` holding the commit, the hashes of `agent.ts` and `tools.ts`, the machine and the exact tasks, next to every trial's logs.

## Models, effort and harness changes

Every run records three separate labels in its manifest: the **harness** (`baseline` for the original text mode, `native-tools` for tool calling, and so on), the **model**, and the reasoning **effort** (`default` unless you set `EFFORT`). That keeps the questions apart, and a leaderboard can sort or filter by any of them:

| Question | Hold fixed | Change | Example |
|---|---|---|---|
| Which model is best in this harness? | Harness | Model | `HARNESS=baseline`, a different model |
| Which harness change helps? | Model | Harness | the same model, `HARNESS=native-tools` |
| What does more reasoning buy? | Model and harness | Effort | the same model, `EFFORT=max` |

The run folder's name combines them: the model, with `-<harness>` and `-<effort>` added when those are set, unless you name it with `RUN`. It sits inside a trial folder: `text-and-bash` for the text harness and `native-tools` for native tool calls.
