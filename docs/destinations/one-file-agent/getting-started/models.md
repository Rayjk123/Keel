# Models

Keel talks to any server that speaks the OpenAI-style `/chat/completions` API. Pick where your model runs, then point Keel at it with `BASE_URL`, `MODEL` and, if the API needs one, `API_KEY`.

## Ollama

[Ollama](https://ollama.com) runs models on your own machine:

```bash
ollama pull qwen3-coder:30b
BASE_URL=http://localhost:11434/v1 MODEL=qwen3-coder:30b node agent.ts "your task"
```

## A hosted API

Point `BASE_URL` at any OpenAI-compatible endpoint and set `MODEL` and `API_KEY`:

```bash
BASE_URL=https://api.example.com/v1 MODEL=my-model API_KEY=sk-... \
  node agent.ts "your task"
```

## OpenRouter

[OpenRouter](https://openrouter.ai) puts hundreds of models behind one OpenAI-style API, including big open models like DeepSeek that won't fit on a laptop. Create a key, then use the model names from its site:

```bash
BASE_URL=https://openrouter.ai/api/v1 MODEL=deepseek/deepseek-v4.1-flash API_KEY=sk-or-... \
  node agent.ts "your task"
```

To benchmark through OpenRouter, give Harbor the model with an `openrouter/` prefix and pass the address and key with the `KEEL_` settings. Keel hands the key to each task's container without writing it to the run logs:

```bash
export KEEL_BASE_URL=https://openrouter.ai/api/v1
export KEEL_API_KEY=sk-or-...
MODELS=openrouter/deepseek/deepseek-v4.1-flash bench/baseline.sh
```

Open models are served by several hosts on OpenRouter, and some handle tool calls better than others. If a run shows malformed tool calls, try pinning a host in your OpenRouter settings.

## AWS Bedrock

Bedrock has its own API, so Keel reaches it through a small local proxy in `bedrock/` that signs each request with your AWS credentials. [AWS Bedrock](bedrock.md) covers setting it up and using it in benchmarks.
