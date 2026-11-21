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

## AWS Bedrock

Bedrock has its own API, so Keel reaches it through a small local proxy in `bedrock/` that signs each request with your AWS credentials. [AWS Bedrock](bedrock.md) covers setting it up and using it in benchmarks.
