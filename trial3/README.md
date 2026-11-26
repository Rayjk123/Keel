# Trial 3: the fixed harness, with reasoning replay and streaming

Trial 3 is the baseline for measuring harness capabilities. It reruns every Bedrock model from Trials 1 and 2 in both harnesses on one commit, after fixing harness bugs that made the earlier scores measure Keel's limits more than the models. Later trials each change one thing against it.

Its runs are in `runs/trial-3-text-and-bash/` (text harness) and `runs/trial-3-native-tools/` (native tools). Each run is one model, one harness and one reasoning effort, scored on the same 10 tasks from each of Terminal-Bench 4.0, Terminal-Bench 4.1, Terminal-Bench 2.0, Aider Polyglot and SWE-bench Lite, out of 50.

## Harness

Every run uses `main` at commit `bd99a4e`, which its manifest records. The text-harness runs set `KEEL_ADAPTER=text`; the native runs use the default. `source/` is a snapshot of that commit's harness, Bedrock proxy, benchmark scripts and tests, and each run's `agent_ts_sha256` and `tools_ts_sha256` match `source/agent.ts` and `source/tools.ts`. The proxy runs from the same source with no `MAX_TOKENS`.

## What changed from Trials 1 and 2

Trial 3 bundles these changes, so its scores can't be split between them. The bug fixes are what make it a fair baseline; reasoning replay and streaming were added so every later trial starts from them.

| Change | Trials 1 and 2 | Trial 3 |
|---|---|---|
| Output limit | 8192 tokens, or 32,000 at higher effort | Each model's maximum: 128,000 for Claude, GPT-6 and GPT-OSS, 524,288 for Grok, and the context window less the request for Qwen, Kimi and GLM |
| A reply cut off at the output limit | Text: counted as a reply without a command. Native: taken as the model finishing | Not run. Keel tells the model it was cut off and to reply more briefly |
| Model replies per task | 50 | 200 |
| Format tokens in a tool name, such as `bash<\|channel\|>analysis` | Replayed as is, so Bedrock rejected the rest of the task | Cut at the first `<`, quote or space, and replayed with only the characters Bedrock accepts |
| A reply cut off by the context window | Taken as a normal reply | A `context-limit` failure |
| Reasoning | Dropped after each reply | Sent back unchanged with its reply on every later turn |
| Streaming | None: a reply that hadn't started within 5 minutes failed | Keel and the proxy stream every reply. A reply fails only after 5 minutes with no data reaching Keel, or 30 minutes with nothing from Bedrock |
| Harness commit | Four commits for the text runs, `c3bfe42` for the native runs | One commit for both |
| Terminal-Bench 4.1 | Not run | Run next to 4.0 on the same 10 tasks |

Trial 3 also records what each task used: model calls, input tokens, output tokens, cache reads and cache writes, and wall time. Cost is reported in tokens.

## Known limits

- Keel never trims old tool output or replayed reasoning, so long tasks grow toward each model's context window. Claude's replayed thinking counts as input.
- Bedrock sends nothing while Claude thinks with hidden reasoning. A single reply that thinks for more than 30 minutes fails as `request-timeout`.
- The proxy adds no prompt-cache points, so Claude reports no cache tokens, while GPT-6 and Grok report most of their input as cache reads.
- For Qwen, Kimi and GLM, whose context window is shared between the request and the reply, the proxy estimates the request at one token per 2 characters. That overstates it, so long tasks get less output room than the window allows and can end in a loop of cut-off replies. Context management is left to Trial 4.
- A Bedrock stream that sends nothing for 30 minutes is retried up to 3 more times, so one step can take about 2 hours. Bedrock client errors, such as a content-filter refusal, are also retried before the task stops.
- Each configuration runs once, except the three in the noise study below.

## Noise study

Three configurations run three times each, so later comparisons can be checked against measured run-to-run noise: Claude Sonnet 5.5 native at default effort, GPT-6.2 Astra native at max and GLM 5 native at default. The repeats are named with `-r2` and `-r3`.

## Models

| Model | Bedrock ID | Higher effort |
|---|---|---|
| Claude Haiku 5.5 | `us.anthropic.claude-haiku-5-5` | `max` |
| Claude Sonnet 5.5 | `us.anthropic.claude-sonnet-5-5` | `max` |
| Claude Opus 5.5 | `us.anthropic.claude-opus-5-5` | `max` |
| GPT-6.2 Astra | `us.openai.gpt-6.2-astra` | `max` |
| GPT-6.2 Sol | `us.openai.gpt-6.2-sol` | `max` |
| GPT-6.1 Terra | `us.openai.gpt-6.1-terra` | `max` |
| GPT-OSS 20B | `openai.gpt-oss-20b-1:0` | `high` |
| GPT-OSS 120B | `openai.gpt-oss-120b-1:0` | `high` |
| Qwen3 Coder 30B | `qwen.qwen3-coder-30b-a3b-v1:0` | none |
| Qwen3 Coder 480B | `qwen.qwen3-coder-480b-a35b-v1:0` | none |
| Kimi K2.5 | `moonshotai.kimi-k2.5` | `high` |
| Grok 4.7 | `us.xai.grok-4.7` | `xhigh` |
| GLM 5 | `zai.glm-5` | `high` |
| GLM 4.7 Flash | `zai.glm-4.7-flash` | `high` |

Each model runs at default effort and at the highest effort it accepts, in both harnesses. Qwen3 Coder isn't a reasoning model, so it has no higher-effort run. Kimi K2.5 and GLM 5 stand in for Kimi K3.1 and GLM 5.3, which had no Bedrock quota on the account used.

## Files

The run manifests are in `manifests/`. Verify the archived files from this directory with `shasum -a 256 -c SHA256SUMS`.
