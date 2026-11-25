# Trial 2 source

Trial 2 runs every model with native tool calls (`bash`, `read`, `write`, `edit` and `patch`) on AWS Bedrock, at default effort and at the highest effort each model accepts. Its runs are in `runs/native-tools/`.

## Harness

`source/` is the harness, benchmark scripts, Bedrock proxy and tests at commit `c3bfe42`, which every Trial 2 run records in its manifest. Each run's `agent_ts_sha256` and `tools_ts_sha256` match `source/agent.ts` and `source/tools.ts`.

The proxy ran from this source with `MAX_TOKENS=8192` for default-effort runs and `MAX_TOKENS=32000` for higher-effort runs.

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
| Qwen3-Coder 30B | `qwen.qwen3-coder-30b-a3b-v1:0` | none |
| Qwen3 Coder 480B | `qwen.qwen3-coder-480b-a35b-v1:0` | none |
| Kimi K2.5 | `moonshotai.kimi-k2.5` | `high` |
| Grok 4.7 | `us.xai.grok-4.7` | `xhigh` |
| GLM 5 | `zai.glm-5` | `high` |
| GLM 4.7 Flash | `zai.glm-4.7-flash` | `high` |

Kimi K2.5 and GLM 5 stand in for Kimi K3.1 and GLM 5.3, which had no Bedrock quota on the account used. Qwen3-Coder isn't a reasoning model, so it has no higher-effort run.

The run manifests are in `manifests/`. Verify the archived files from this directory with `shasum -a 256 -c SHA256SUMS`.
