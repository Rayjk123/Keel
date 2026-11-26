# AWS Bedrock

The `bedrock/` folder holds a small local proxy that lets Keel talk to Claude and other models on AWS Bedrock. It accepts Keel's OpenAI-style requests and forwards them to Bedrock using the AWS SDK and your normal AWS credentials. Your keys stay on your machine.

## Set it up

```bash
cd bedrock && npm install
AWS_REGION=us-east-2 node proxy.mjs
```

The proxy listens on `http://127.0.0.1:8787/v1`.

Set `EFFORT` on Keel to choose a reasoning effort. The proxy passes it to Claude as `output_config.effort`, to GPT-6 and Grok models as `reasoning.effort`, and to GPT-OSS, Kimi and GLM models as `reasoning_effort`, and rejects it for other models. Check which levels a model accepts: Grok 4.7 stops at `xhigh`, and GPT-OSS, Kimi and GLM at `high`. If a reply is cut off at its output limit, Keel tells the model and runs none of it.

The proxy asks each model for its largest reply:

| Models | Output limit |
|---|---|
| Claude (`anthropic.`), GPT-6 and GPT-OSS (`openai.`) | 128,000 tokens |
| Grok (`xai.`) | 524,288 tokens |
| Qwen3 Coder 30B, Kimi K2.5 | 262,144 tokens, less the request |
| Qwen3 Coder 480B | 131,072 tokens, less the request |
| GLM (`zai.glm`) | 202,752 tokens, less the request |
| Any other model | Bedrock's default |

Qwen, Kimi and GLM share one context window between the request and the reply, so the proxy subtracts an estimate of the request, half its length in characters, from the window. Set `MAX_TOKENS` to use one limit for every model instead, and a request's own `max_tokens` wins over both.

The proxy returns a reply's reasoning blocks in order as `reasoning_details`: thinking as `reasoning.text` with its `signature`, and encrypted reasoning as `reasoning.encrypted` with the bytes in base64 `data`. Any thinking text is also in `reasoning`. When Keel sends a reply back, the proxy puts its blocks first in that assistant turn, before the text and tool calls, in the order Bedrock returned them. Blocks that came between tool calls move to the front too, which Bedrock accepts. Thinking with neither text nor a signature isn't sent back. Claude returns a signature with empty text and GPT-6 models return encrypted reasoning, so you can't read their thinking, but it is still replayed. Each log line counts the reasoning blocks in the reply (`reasoning=`) and in the history sent (`replayed=`).

When a request asks for a stream, as Keel's do, the proxy uses Bedrock's `ConverseStream` and passes each piece on as it arrives, as OpenAI-style server-sent events. It sends a `: keepalive` comment every 15 seconds, so a model thinking where you can't see it never leaves the connection silent: Bedrock sends nothing, not even its response headers, until a Claude model has finished thinking, which at `max` effort can take more than 5 minutes. The AWS SDK gives up on a silent HTTP/2 stream after 5 minutes and quietly retries, so the proxy raises its `requestTimeout` and `sessionTimeout` to 30 minutes, or `STALL_MS`. If Bedrock sends nothing for that long, the proxy gives up on the request with a `TimeoutError`, and Keel retries it. A reply whose hidden thinking runs longer than that on every attempt ends the task as `request-timeout`. An error after streaming starts arrives as a final `data: {"error": {"message": ..., "code": ...}}` event. A conversation that overflows the model's context window gets code 400, so Keel stops instead of retrying; other Bedrock errors get 500 and are retried. Requests without `stream: true` get one JSON reply.

The usage the proxy reports counts all input in `prompt_tokens`, cache reads and writes included, and splits out Bedrock's `cacheReadInputTokens` and `cacheWriteInputTokens` as `prompt_tokens_details.cached_tokens` and `prompt_tokens_details.cache_write_tokens`. The log line shows Bedrock's own numbers: `in=` is the input that wasn't read from or written to the cache, then `out=`, `cache_read=` and `cache_write=`. GPT-6 models cache on their own and report most of their input as cache tokens. The proxy adds no cache points, so Claude models report none.

## Run Keel through it

In another terminal:

```bash
BASE_URL=http://127.0.0.1:8787/v1 \
MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0 \
  node agent.ts "your task"
```

Use any model or inference profile ID your AWS account can access.

## Use it in benchmarks

Containers reach the proxy on your machine, so point them at it:

```bash
export KEEL_BASE_URL=http://host.docker.internal:8787/v1
```

On Linux with Docker Engine, containers can't resolve `host.docker.internal` or reach `127.0.0.1` on your machine. Start the proxy on the Docker bridge address instead, usually `172.17.0.1` (`ip -4 addr show docker0` shows yours):

```bash
AWS_REGION=us-east-2 PROXY_HOST=172.17.0.1 node proxy.mjs
```

In the terminal where you run the benchmarks:

```bash
export KEEL_BASE_URL=http://172.17.0.1:8787/v1
```

The proxy has no authentication and signs every request with your AWS credentials. On the bridge address, every container on your machine can use it, and so can other machines on your network unless a firewall blocks them. Never set `PROXY_HOST` to `0.0.0.0`, and stop the proxy when the run ends.

Then run the benchmarks as described in [Running the benchmarks](../benchmarks/running.md), with a `bedrock/` prefix on the model ID, for example `MODELS=bedrock/us.anthropic.claude-haiku-4-5-20251001-v1:0 bench/baseline.sh`.

## Removing it

The proxy is self-contained. To remove it, delete the `bedrock/` folder, its tests in `test/proxy.test.ts`, and `allowJs` in `tsconfig.json`. Nothing else depends on it.
