<p align="center">
  <a href="https://keeljourney.dev/">
    <img src="docs/assets/banner.svg" style="height: 10em" alt="Keel: learning by building, one port at a time" />
  </a>
</p>

<p align="center"><strong>[&nbsp;<a href="https://keeljourney.dev/">Read the Docs</a>&nbsp;]</strong></p>

<p align="center">
  <a href="https://github.com/Rayjk123/Keel/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Rayjk123/Keel/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue"></a>
  <a href=".nvmrc"><img alt="Node 22.18+" src="https://img.shields.io/badge/Node-22.18+-339933?logo=nodedotjs&logoColor=white"></a>
  <a href="agent.ts"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white"></a>
</p>

---

**Learning by building, one port at a time.**

Keel is my learning log, written in code. Each destination is something I wanted to understand properly, so I built it myself, measured how well it worked, wrote down what I learned, and then sailed on to the next one.

Every destination has its own code, its own write-up on the [docs site](https://keeljourney.dev/), and a way to run it yourself.

## The journey

| # | Destination | What I built | When |
|---|---|---|---|
| 1 | [One-file agent](https://keeljourney.dev/destinations/one-file-agent/) | A coding agent in a single TypeScript file, benchmarked on Terminal-Bench, SWE-bench and Aider Polyglot | November 2026 |

The next port isn't chosen yet. When it is, it gets its own row here and its own section on the docs site.

## Destination 1: One-file agent

The first destination was the smallest agent I could build that still does real work. It takes a task in plain English, then works on it the way a developer would: it looks around, runs commands, reads the output, and keeps going until the job is done. The whole agent is one TypeScript file, `agent.ts`, with no SDK and no dependencies.

- **Small.** Two files you can read in one sitting: the loop in `agent.ts` and the tools in `tools.ts`. Nothing hidden behind layers.
- **Real tools.** `bash`, `read`, `write`, `edit` and `patch`, called through native tool calling, with forgiving edits and Codex-style multi-file patches.
- **Zero dependencies.** It uses Node's built-in `fetch` and nothing else.
- **Works with any model.** It speaks the standard OpenAI-style chat API, so it runs on local models through Ollama, on hosted APIs, or on AWS Bedrock.
- **Benchmark-ready.** It runs on Terminal-Bench, Aider Polyglot and SWE-bench, so every change gets a score.

### Try it

You need Node 22.18 or later (an `.nvmrc` is included, so `nvm use` picks the right version) and a model to talk to. The quickest way to get one is [Ollama](https://ollama.com):

```
ollama pull qwen3-coder:30b
BASE_URL=http://localhost:11434/v1 MODEL=qwen3-coder:30b node agent.ts "create a script that prints the first 20 primes"
```

Keel works in the folder you run it from, so try it in a scratch directory first.

| Setting | Default | What it does |
|---|---|---|
| `BASE_URL` | `http://localhost:8000/v1` | The chat API to call |
| `MODEL` | required | The model name |
| `API_KEY` | `none` | Bearer token, if your API needs one |
| `ADAPTER` | `native` | `native` for tool calling, or `text` for one fenced bash block per reply |
| `MAX_STEPS` | `50` | Model replies allowed per task |
| `EFFORT` | unset | Reasoning effort, sent as `reasoning_effort`, for example `low`, `high` or `max` |

### Run it on a benchmark

Keel includes an adapter for [Harbor](https://harborframework.com), which runs each task in its own Docker container, runs the agent inside it, and scores the result with the task's official tests.

```
export PYTHONPATH=$PWD/bench

harbor run -d terminal-bench/terminal-bench@4 -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/terminal-bench-4.0
harbor run -d aider/aider-polyglot -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/aider-polyglot

DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  harbor run -d swe-bench/swe-bench-verified -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/swe-bench-verified

harbor view runs/terminal-bench-4.0
```

Supported benchmarks: Terminal-Bench 4.0 and 2.0, Aider Polyglot, SWE-bench Verified and SWE-bench Lite. For the 300-task SWE-bench Lite subset, run `python bench/swebench_lite.py --run-id my-run --limit 30` after `pip install -r bench/requirements.txt`.

Want a quick score for one or more models on a fresh machine? After `export MODELS="ollama/qwen3-coder:30b ollama/gpt-oss:20b"`, `bench/setup.sh` gets it ready and pulls those models, and `bench/baseline.sh` runs 10 hand-picked tasks from each benchmark per model, saving everything under `runs/<model>/`.

Use `-l 10` to run just the first 10 tasks for a quick check. The [Running the benchmarks page](https://keeljourney.dev/destinations/one-file-agent/benchmarks/running/) has every option, how the Docker setup fits together, and tips for running at scale.

### Go deeper

The docs site has the full write-up of this destination:

- [Getting started](https://keeljourney.dev/destinations/one-file-agent/getting-started/): settings and your first run.
- [Models](https://keeljourney.dev/destinations/one-file-agent/getting-started/models/): Ollama, a hosted API or AWS Bedrock.
- [AWS Bedrock](https://keeljourney.dev/destinations/one-file-agent/getting-started/bedrock/): use Claude and other models on Bedrock.
- [How it works](https://keeljourney.dev/destinations/one-file-agent/how-it-works/): the loop, the command format and the limits.
- [Adapters](https://keeljourney.dev/destinations/one-file-agent/how-it-works/adapters/): the message format, and how to support a new API.
- [Benchmarks](https://keeljourney.dev/destinations/one-file-agent/benchmarks/): the scoreboard for every run.
- [Running the benchmarks](https://keeljourney.dev/destinations/one-file-agent/benchmarks/running/): Terminal-Bench, Aider Polyglot, SWE-bench Verified and Lite.

## Develop

```
npm install
npm run typecheck
npm test
```

The tests run the real agent loop against a scripted fake model, so they finish in under a second and need no model or network.

## What's inside

```
agent.ts                the agent loop and its adapters
tools.ts                bash, read, write, edit and patch
test/                   tests for the loop, adapters, tools and Bedrock proxy
bench/keel_agent.py     plugs the agent into Harbor for benchmarking
bench/swebench_lite.py  runs and grades SWE-bench Lite
bench/setup.sh          readies a new machine for benchmarking
bench/baseline.sh       scores models on a hand-picked subset of each benchmark
bedrock/                optional proxy for AWS Bedrock
docs/                   the documentation site
```

## License

[MIT](LICENSE)
