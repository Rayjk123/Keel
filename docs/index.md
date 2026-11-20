<p align="center">
  <img src="assets/banner.svg" alt="Keel: a coding agent in one file" style="height: 10em" />
</p>

# Keel

**A coding agent in one file you can read in five minutes.**

Keel takes a task in plain English, then works on it the way a developer would: it looks around, runs commands, reads the output, and keeps going until the job is done. There is no framework and there are no dependencies. The whole agent is a single TypeScript file, `agent.ts`.

Keel is built to be understood, changed and measured. Every part of the loop is in plain view, so you can swap in a new idea, run a benchmark, and see whether it helped.

## Why Keel

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

Head to [Getting started](getting-started.md) for the full walkthrough, or [How it works](how-it-works.md) to see what happens inside the loop.
