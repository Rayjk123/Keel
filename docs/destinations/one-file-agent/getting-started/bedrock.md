# AWS Bedrock

The `bedrock/` folder holds a small local proxy that lets Keel talk to Claude and other models on AWS Bedrock. It accepts Keel's OpenAI-style requests and forwards them to Bedrock using the AWS SDK and your normal AWS credentials. Your keys stay on your machine.

## Set it up

```bash
cd bedrock && npm install
AWS_REGION=us-east-2 node proxy.mjs
```

The proxy listens on `http://127.0.0.1:8787/v1`.

Set `EFFORT` on Keel to choose a reasoning effort. The proxy passes it to Claude as `output_config.effort`, to GPT-6 and Grok models as `reasoning.effort`, and to GPT-OSS, Kimi and GLM models as `reasoning_effort`, and rejects it for other models. Check which levels a model accepts: Grok 4.7 stops at `xhigh`, and GPT-OSS, Kimi and GLM at `high`. The proxy leaves the output limit to Bedrock, which uses the model's maximum. Set `MAX_TOKENS` to cap every reply. If a reply is cut off at the limit, Keel tells the model and runs none of it.

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
