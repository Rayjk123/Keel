# Getting started

## What you need

- **Node 22.18 or later.** Keel runs the TypeScript file directly, with no build step. The repository includes an `.nvmrc`, so `nvm use` picks the right version.
- **A model to talk to.** Any server that speaks the OpenAI-style `/chat/completions` API works. The quickest option is [Ollama](https://ollama.com), which runs models on your own machine. [Models](models.md) covers Ollama, hosted APIs and AWS Bedrock.

## Run Keel

Pull a model, clone the repository, move into the folder where you want Keel to work, and run it:

```bash
ollama pull qwen3-coder:30b
git clone https://github.com/Rayjk123/Keel.git
mkdir scratch && cd scratch

BASE_URL=http://localhost:11434/v1 MODEL=qwen3-coder:30b \
  node ../Keel/agent.ts "create a script that prints the first 20 primes"
```

Keel works in the folder you run it from and runs real commands there, so a scratch directory is a good place to start.

As it works, Keel prints each command it runs, prefixed with `$`. When the model is finished, it prints a short summary of what it did.

## Settings

Keel is configured with environment variables.

| Setting | Default | What it does |
|---|---|---|
| `BASE_URL` | `http://localhost:8000/v1` | The chat API to call |
| `MODEL` | required | The model name |
| `API_KEY` | `none` | Bearer token, if your API needs one |
