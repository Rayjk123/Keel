# Destination 1: One-file agent

**A coding agent in one file you can read in five minutes.**

The first destination was the smallest agent I could build that still does real work. It takes a task in plain English, then works on it the way a developer would: it looks around, runs commands, reads the output, and keeps going until the job is done. The whole agent is a single TypeScript file, `agent.ts`, with no framework and no dependencies.

I built it to understand how coding agents work from the inside, and to have something simple I could benchmark and then improve one change at a time.

## What I built

<div class="grid cards" markdown>

-   **Tiny**

    One file, about 200 lines. Nothing hidden behind layers.

-   **Zero dependencies**

    It uses Node's built-in `fetch` and nothing else.

-   **Works with any model**

    It speaks the standard OpenAI-style chat API, so it runs on local models through Ollama, on hosted APIs, or on AWS Bedrock.

-   **Benchmark-ready**

    Run it on Terminal-Bench, Aider Polyglot and SWE-bench with one command and get real scores.

</div>

## Try it

```bash
ollama pull qwen3-coder:30b
BASE_URL=http://localhost:11434/v1 MODEL=qwen3-coder:30b \
  node agent.ts "create a script that prints the first 20 primes"
```

## What I learned

- **Plain text beat tool calling.** Asking for one fenced `bash` block per reply worked on every reply I tried. With native tool calling through Ollama, roughly a third to a half of replies came back as plain text, because the model sometimes left out the opening tag.
- **It wasn't the client library.** I built a Python version on LiteLLM to check. It sent the same request and hit the same failures, so the cause was the model and server, not my code.
- **A small harness can run real benchmarks.** Docker runs the task, Keel runs inside it, and the benchmark's own tests give the score. The Harbor adapter is about 60 lines.
- **The prompt matters as much as the loop.** Other minimal agents, like mini-swe-agent, give the model a recommended workflow: explore, reproduce the bug, edit the source, verify. That is a natural thing to try next.

## Explore this destination

- [Getting started](getting-started/index.md): run Keel for the first time, and its settings.
- [Models](getting-started/models.md): Ollama, a hosted API or AWS Bedrock.
- [AWS Bedrock](getting-started/bedrock.md): use Claude and other models on Bedrock.
- [How it works](how-it-works/index.md): the loop, the command format and the limits.
- [Adapters](how-it-works/adapters.md): the message format, and how to support a new API.
- [Benchmarks](benchmarks/index.md): the scoreboard, with charts of the best score per model and what changes it.
- [Running the benchmarks](benchmarks/running.md): run Terminal-Bench, Aider Polyglot and SWE-bench.
