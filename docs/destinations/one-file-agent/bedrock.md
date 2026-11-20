# AWS Bedrock

The `bedrock/` folder holds a small local proxy that lets Keel talk to Claude and other models on AWS Bedrock. It accepts Keel's OpenAI-style requests and forwards them to Bedrock using the AWS SDK and your normal AWS credentials. Your keys stay on your machine.

## Set it up

```bash
cd bedrock && npm install
AWS_REGION=us-east-2 node proxy.mjs
```

The proxy listens on `http://127.0.0.1:8787/v1`.

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

Then run Harbor as described in [Benchmarks](benchmarks.md).

## Removing it

The proxy is self-contained. Delete the `bedrock/` folder to remove it. Nothing else depends on it.
