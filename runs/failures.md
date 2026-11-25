| Model | Host | Harness | Effort | Passed | Why the rest failed |
|---|---|---|---|---|---|
| Claude Haiku 5.5 | Bedrock | text | default | 19 | `wrong-answer` 17 · `step-limit` 2 · `no-command` 1 · `unsupported` 1 |
| Claude Haiku 5.5 | Bedrock | text | max | 14 | `no-command` 19 · `wrong-answer` 5 · `refused` 1 · `unsupported` 1 |
| Claude Haiku 5.5 | Bedrock | native | default | 21 | `wrong-answer` 17 · `step-limit` 1 · `unsupported` 1 |
| Claude Haiku 5.5 | Bedrock | native | max | 17 | `wrong-answer` 13 · `step-limit` 5 · `no-patch` 3 · `task-time-limit` 1 · `unsupported` 1 |
| Claude Sonnet 5.5 | Bedrock | text | default | 25 | `wrong-answer` 6 · `no-command` 6 · `step-limit` 2 · `unsupported` 1 |
| Claude Sonnet 5.5 | Bedrock | text | max | 20 | `no-command` 10 · `task-time-limit` 4 · `wrong-answer` 2 · `step-limit` 2 · `request-timeout` 1 · `unsupported` 1 |
| Claude Sonnet 5.5 | Bedrock | native | default | 24 | `wrong-answer` 11 · `step-limit` 4 · `unsupported` 1 |
| Claude Sonnet 5.5 | Bedrock | native | max | 12 | `wrong-answer` 11 · `task-time-limit` 11 · `step-limit` 4 · `no-patch` 1 · `unsupported` 1 |
| Claude Opus 5.5 | Bedrock | text | default | 28 | `no-command` 5 · `wrong-answer` 3 · `step-limit` 3 · `unsupported` 1 |
| Claude Opus 5.5 | Bedrock | text | max | 21 | `no-command` 10 · `task-time-limit` 3 · `step-limit` 2 · `request-timeout` 2 · `wrong-answer` 1 · `unsupported` 1 |
| Claude Opus 5.5 | Bedrock | native | default | 27 | `wrong-answer` 8 · `step-limit` 4 · `unsupported` 1 |
| Claude Opus 5.5 | Bedrock | native | max | 16 | `wrong-answer` 9 · `step-limit` 6 · `task-time-limit` 6 · `no-patch` 1 · `model-error` 1 · `unsupported` 1 |
| GPT-6.2 Astra | Bedrock | text | default | 15 | `no-command` 16 · `wrong-answer` 8 · `unsupported` 1 |
| GPT-6.2 Astra | Bedrock | text | max | 14 | `no-command` 17 · `wrong-answer` 6 · `request-timeout` 2 · `unsupported` 1 |
| GPT-6.2 Astra | Bedrock | native | default | 28 | `wrong-answer` 10 · `step-limit` 1 · `unsupported` 1 |
| GPT-6.2 Astra | Bedrock | native | max | 31 | `wrong-answer` 4 · `step-limit` 3 · `task-time-limit` 1 · `unsupported` 1 |
| GPT-6.2 Sol | Bedrock | text | default | 1 | `no-command` 35 · `wrong-answer` 2 · `refused` 1 · `unsupported` 1 |
| GPT-6.2 Sol | Bedrock | text | max | 13 | `no-command` 23 · `wrong-answer` 2 · `refused` 1 · `unsupported` 1 |
| GPT-6.2 Sol | Bedrock | native | default | 27 | `wrong-answer` 7 · `step-limit` 4 · `refused` 1 · `unsupported` 1 |
| GPT-6.2 Sol | Bedrock | native | max | 29 | `wrong-answer` 6 · `step-limit` 3 · `task-time-limit` 1 · `unsupported` 1 |
| GPT-6.1 Terra | Bedrock | text | default | 5 | `no-command` 33 · `refused` 1 · `unsupported` 1 |
| GPT-6.1 Terra | Bedrock | text | max | 1 | `no-command` 37 · `refused` 1 · `unsupported` 1 |
| GPT-6.1 Terra | Bedrock | native | default | 23 | `wrong-answer` 12 · `step-limit` 3 · `refused` 1 · `unsupported` 1 |
| GPT-6.1 Terra | Bedrock | native | max | 29 | `step-limit` 7 · `wrong-answer` 2 · `refused` 1 · `unsupported` 1 |
| GPT-OSS 20B | Bedrock | native | default | 5 | `malformed-tool-call` 26 · `wrong-answer` 8 · `unsupported` 1 |
| GPT-OSS 20B | Bedrock | native | high | 4 | `malformed-tool-call` 28 · `wrong-answer` 2 · `step-limit` 2 · `task-time-limit` 2 · `context-limit` 1 · `unsupported` 1 |
| GPT-OSS 20B | Ollama | text | default | 2 | `no-command` 26 · `malformed-tool-call` 9 · `wrong-answer` 1 · `task-time-limit` 1 · `unsupported` 1 |
| GPT-OSS 20B | Ollama | native | default | 10 | `wrong-answer` 18 · `malformed-tool-call` 8 · `step-limit` 2 · `no-patch` 1 · `unsupported` 1 |
| GPT-OSS 120B | Bedrock | text | default | 4 | `no-command` 22 · `wrong-answer` 10 · `no-patch` 3 · `unsupported` 1 |
| GPT-OSS 120B | Bedrock | text | high | 7 | `no-command` 22 · `wrong-answer` 9 · `task-time-limit` 1 · `unsupported` 1 |
| GPT-OSS 120B | Bedrock | native | default | 13 | `wrong-answer` 15 · `step-limit` 6 · `malformed-tool-call` 3 · `context-limit` 1 · `task-time-limit` 1 · `unsupported` 1 |
| GPT-OSS 120B | Bedrock | native | high | 13 | `step-limit` 14 · `task-time-limit` 6 · `wrong-answer` 3 · `malformed-tool-call` 3 · `unsupported` 1 |
| Qwen3 Coder 30B | Bedrock | native | default | 7 | `wrong-answer` 29 · `step-limit` 2 · `no-patch` 1 · `unsupported` 1 |
| Qwen3 Coder 30B | Ollama | text | default | 5 | `wrong-answer` 23 · `no-command` 9 · `step-limit` 2 · `unsupported` 1 |
| Qwen3 Coder 30B | Ollama | native | default | 11 | `wrong-answer` 22 · `task-time-limit` 3 · `no-patch` 1 · `malformed-tool-call` 1 · `step-limit` 1 · `unsupported` 1 |
| Qwen3 Coder 480B | Bedrock | text | default | 13 | `wrong-answer` 21 · `step-limit` 3 · `no-command` 2 · `unsupported` 1 |
| Qwen3 Coder 480B | Bedrock | native | default | 14 | `wrong-answer` 21 · `step-limit` 3 · `context-limit` 1 · `unsupported` 1 |
| Kimi K2.5 | Bedrock | text | default | 18 | `no-command` 8 · `wrong-answer` 7 · `step-limit` 5 · `task-time-limit` 1 · `unsupported` 1 |
| Kimi K2.5 | Bedrock | text | high | 18 | `wrong-answer` 13 · `step-limit` 5 · `no-command` 3 · `unsupported` 1 |
| Kimi K2.5 | Bedrock | native | default | 20 | `wrong-answer` 10 · `step-limit` 9 · `unsupported` 1 |
| Kimi K2.5 | Bedrock | native | high | 15 | `wrong-answer` 14 · `step-limit` 9 · `task-time-limit` 1 · `unsupported` 1 |
| Grok 4.7 | Bedrock | text | default | 23 | `step-limit` 8 · `wrong-answer` 4 · `no-command` 3 · `task-time-limit` 1 · `unsupported` 1 |
| Grok 4.7 | Bedrock | text | xhigh | 25 | `step-limit` 8 · `wrong-answer` 2 · `no-command` 2 · `request-timeout` 1 · `task-time-limit` 1 · `unsupported` 1 |
| Grok 4.7 | Bedrock | native | default | 24 | `wrong-answer` 9 · `step-limit` 6 · `unsupported` 1 |
| Grok 4.7 | Bedrock | native | xhigh | 23 | `wrong-answer` 8 · `step-limit` 8 · `unsupported` 1 |
| GLM 5 | Bedrock | text | default | 16 | `wrong-answer` 17 · `step-limit` 5 · `request-timeout` 1 · `unsupported` 1 |
| GLM 5 | Bedrock | text | high | 18 | `wrong-answer` 13 · `step-limit` 6 · `request-timeout` 2 · `unsupported` 1 |
| GLM 5 | Bedrock | native | default | 21 | `wrong-answer` 11 · `step-limit` 7 · `unsupported` 1 |
| GLM 5 | Bedrock | native | high | 18 | `wrong-answer` 13 · `step-limit` 8 · `unsupported` 1 |
| GLM 4.7 Flash | Bedrock | text | default | 6 | `wrong-answer` 18 · `step-limit` 15 · `unsupported` 1 |
| GLM 4.7 Flash | Bedrock | text | high | 8 | `wrong-answer` 18 · `step-limit` 12 · `no-command` 1 · `unsupported` 1 |
| GLM 4.7 Flash | Bedrock | native | default | 7 | `step-limit` 20 · `wrong-answer` 11 · `malformed-tool-call` 1 · `unsupported` 1 |
| GLM 4.7 Flash | Bedrock | native | high | 7 | `step-limit` 20 · `wrong-answer` 11 · `malformed-tool-call` 1 · `unsupported` 1 |
| Devstral 24B | Ollama | text | default | 4 | `wrong-answer` 19 · `step-limit` 11 · `request-timeout` 3 · `task-time-limit` 2 · `unsupported` 1 |
| Devstral 24B | Ollama | native | default | 3 | `wrong-answer` 26 · `no-patch` 8 · `step-limit` 1 · `task-time-limit` 1 · `unsupported` 1 |
