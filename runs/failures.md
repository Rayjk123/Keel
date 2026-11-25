| Run | Passed | Why the rest failed |
|---|---|---|
| qwen3-coder-30b | 5 | `wrong-answer` 23 · `no-command` 9 · `step-limit` 2 · `unsupported` 1 |
| gpt-oss-20b | 2 | `no-command` 26 · `malformed-tool-call` 9 · `wrong-answer` 1 · `task-time-limit` 1 · `unsupported` 1 |
| devstral-24b | 4 | `wrong-answer` 19 · `step-limit` 11 · `request-timeout` 3 · `task-time-limit` 2 · `unsupported` 1 |
| claude-haiku-5.5 | 19 | `wrong-answer` 17 · `step-limit` 2 · `no-command` 1 · `unsupported` 1 |
| claude-opus-5.5 | 28 | `no-command` 5 · `wrong-answer` 3 · `step-limit` 3 · `unsupported` 1 |
| claude-sonnet-5.5 | 25 | `wrong-answer` 6 · `no-command` 6 · `step-limit` 2 · `unsupported` 1 |
| qwen3-coder-30b-native-tools | 11 | `wrong-answer` 22 · `task-time-limit` 3 · `no-patch` 1 · `malformed-tool-call` 1 · `step-limit` 1 · `unsupported` 1 |
| gpt-oss-20b-native-tools | 10 | `wrong-answer` 18 · `malformed-tool-call` 8 · `step-limit` 2 · `no-patch` 1 · `unsupported` 1 |
| devstral-24b-native-tools | 3 | `wrong-answer` 26 · `no-patch` 8 · `step-limit` 1 · `task-time-limit` 1 · `unsupported` 1 |
| gpt-6.1-terra | 5 | `no-command` 33 · `refused` 1 · `unsupported` 1 |
| gpt-6.2-astra | 15 | `no-command` 16 · `wrong-answer` 8 · `unsupported` 1 |
| gpt-6.2-sol | 1 | `no-command` 35 · `wrong-answer` 2 · `refused` 1 · `unsupported` 1 |
| claude-haiku-5.5-max | 14 | `no-command` 19 · `wrong-answer` 5 · `refused` 1 · `unsupported` 1 |
| claude-opus-5.5-max | 21 | `no-command` 10 · `task-time-limit` 3 · `step-limit` 2 · `request-timeout` 2 · `wrong-answer` 1 · `unsupported` 1 |
| claude-sonnet-5.5-max | 20 | `no-command` 10 · `task-time-limit` 4 · `wrong-answer` 2 · `step-limit` 2 · `request-timeout` 1 · `unsupported` 1 |
| gpt-6.1-terra-max | 1 | `no-command` 37 · `refused` 1 · `unsupported` 1 |
| gpt-6.2-astra-max | 14 | `no-command` 17 · `wrong-answer` 6 · `request-timeout` 2 · `unsupported` 1 |
| gpt-6.2-sol-max | 13 | `no-command` 23 · `wrong-answer` 2 · `refused` 1 · `unsupported` 1 |
| gpt-oss-120b | 4 | `no-command` 22 · `wrong-answer` 10 · `no-patch` 3 · `unsupported` 1 |
| qwen3-coder-480b | 13 | `wrong-answer` 21 · `step-limit` 3 · `no-command` 2 · `unsupported` 1 |
| kimi-k2.5 | 18 | `no-command` 8 · `wrong-answer` 7 · `step-limit` 5 · `task-time-limit` 1 · `unsupported` 1 |
| grok-4.7 | 23 | `step-limit` 8 · `wrong-answer` 4 · `no-command` 3 · `task-time-limit` 1 · `unsupported` 1 |
| glm-5 | 16 | `wrong-answer` 17 · `step-limit` 5 · `request-timeout` 1 · `unsupported` 1 |
| glm-4.7-flash | 6 | `wrong-answer` 18 · `step-limit` 15 · `unsupported` 1 |
| claude-haiku-5.5-native-tools | 21 | `wrong-answer` 17 · `step-limit` 1 · `unsupported` 1 |
| claude-sonnet-5.5-native-tools | 24 | `wrong-answer` 11 · `step-limit` 4 · `unsupported` 1 |
| claude-opus-5.5-native-tools | 27 | `wrong-answer` 8 · `step-limit` 4 · `unsupported` 1 |
| gpt-6.2-astra-native-tools | 28 | `wrong-answer` 10 · `step-limit` 1 · `unsupported` 1 |
| gpt-6.2-sol-native-tools | 27 | `wrong-answer` 7 · `step-limit` 4 · `refused` 1 · `unsupported` 1 |
| gpt-6.1-terra-native-tools | 15 | `wrong-answer` 10 · `step-limit` 3 · `refused` 1 · `unsupported` 1 |
| gpt-oss-20b-bedrock-native-tools | 5 | `malformed-tool-call` 26 · `wrong-answer` 8 · `unsupported` 1 |
| gpt-oss-120b-native-tools | 13 | `wrong-answer` 15 · `step-limit` 6 · `malformed-tool-call` 3 · `context-limit` 1 · `task-time-limit` 1 · `unsupported` 1 |
| qwen3-coder-30b-bedrock-native-tools | 7 | `wrong-answer` 29 · `step-limit` 2 · `no-patch` 1 · `unsupported` 1 |
| qwen3-coder-480b-native-tools | 14 | `wrong-answer` 21 · `step-limit` 3 · `context-limit` 1 · `unsupported` 1 |
| kimi-k2.5-native-tools | 20 | `wrong-answer` 10 · `step-limit` 9 · `unsupported` 1 |
| grok-4.7-native-tools | 24 | `wrong-answer` 9 · `step-limit` 6 · `unsupported` 1 |
| glm-5-native-tools | 21 | `wrong-answer` 11 · `step-limit` 7 · `unsupported` 1 |
| glm-4.7-flash-native-tools | 7 | `step-limit` 20 · `wrong-answer` 11 · `malformed-tool-call` 1 · `unsupported` 1 |
| gpt-oss-120b-high | 7 | `no-command` 22 · `wrong-answer` 9 · `task-time-limit` 1 · `unsupported` 1 |
| kimi-k2.5-high | 18 | `wrong-answer` 13 · `step-limit` 5 · `no-command` 3 · `unsupported` 1 |
| glm-4.7-flash-high | 8 | `wrong-answer` 18 · `step-limit` 12 · `no-command` 1 · `unsupported` 1 |
