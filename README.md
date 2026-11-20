<p align="center">
  <a href="https://rayjk123.github.io/Keel/">
    <img src="docs/assets/banner.svg" style="height: 10em" alt="Keel: a coding agent in one file" />
  </a>
</p>

<p align="center"><strong>[&nbsp;<a href="https://rayjk123.github.io/Keel/">Read the Docs</a>&nbsp;]</strong></p>

<p align="center">
  <a href="https://github.com/Rayjk123/Keel/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/Rayjk123/Keel/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-blue"></a>
  <a href=".nvmrc"><img alt="Node 22.18+" src="https://img.shields.io/badge/Node-22.18+-339933?logo=nodedotjs&logoColor=white"></a>
  <a href="agent.ts"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white"></a>
  <img alt="Zero dependencies" src="https://img.shields.io/badge/dependencies-0-brightgreen">
</p>

---

**A coding agent in one file you can read in five minutes.**

Keel takes a task in plain English, then works on it the way a developer would: it looks around, runs commands, reads the output, and keeps going until the job is done. There is no framework and there are no dependencies. The whole agent is a single TypeScript file, `agent.ts`.

Keel is built to be understood, changed and measured. Every part of the loop is in plain view, so you can swap in a new idea, run a benchmark, and see whether it helped.

```
$ node agent.ts "find the bug in parser.py and fix it"
$ ls
$ cat parser.py
$ python -m pytest
$ sed -i 's/<=/</' parser.py
$ python -m pytest
Fixed the off-by-one in the loop bound; all tests pass.
```

## Why Keel

- **Tiny.** One file, about 200 lines. Nothing hidden behind layers.
- **Zero dependencies.** It uses Node's built-in `fetch` and nothing else.
- **Works with any model.** It speaks the standard OpenAI-style chat API, so it runs on local models through Ollama, on hosted APIs, or on AWS Bedrock.
- **Benchmark-ready.** Run it on Terminal-Bench, Aider Polyglot and SWE-bench with one command and get real scores.
- **Easy to extend.** A small adapter layer separates your model's message format from the agent loop.

## Get started

You need Node 22.18 or later (an `.nvmrc` is included, so `nvm use` picks the right version), and a model to talk to. The quickest way to get one is [Ollama](https://ollama.com):

```
ollama pull qwen3-coder:30b
```

Then run Keel in any directory:

```
BASE_URL=http://localhost:11434/v1 MODEL=qwen3-coder:30b node agent.ts "create a script that prints the first 20 primes"
```

Keel works in the folder you run it from, so try it in a scratch directory first.

| Setting | Default | What it does |
|---|---|---|
| `BASE_URL` | `http://localhost:8000/v1` | The chat API to call |
| `MODEL` | required | The model name |
| `API_KEY` | `none` | Bearer token, if your API needs one |

## How it works

Keel is a loop with four steps:

1. **Ask.** Send the task and the conversation so far to the model.
2. **Act.** The model replies with its reasoning and one bash command in a fenced code block. Keel runs it.
3. **Observe.** The command's exit code and output go back to the model.
4. **Repeat** until the model says it is finished.

The model ends the run by printing a special line, `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`, from a command that succeeds. Whatever follows it becomes the final answer.

Keel asks the model to write its command as plain text instead of using a tool-calling API. This works the same way across models and servers, so you don't have to worry about which ones support tool calls.

### The message format

Inside, Keel keeps conversations in one simple format: messages made of parts (text, tool calls, tool results, reasoning). An **adapter** translates between that format and whatever your model's API expects. To support a new API, you write one small adapter and the rest of Keel stays the same.

## Run it on a benchmark

Keel includes an adapter for [Harbor](https://harborframework.com), which runs each task in its own Docker container and scores the result with the task's official tests.

```
export PYTHONPATH=$PWD/bench

harbor run -d terminal-bench/terminal-bench@4 -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/terminal-bench-4.0
harbor run -d aider/aider-polyglot -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/aider-polyglot
harbor run -d terminal-bench@2.0 -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/terminal-bench-2.0

DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  harbor run -d swe-bench/swe-bench-verified -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/swe-bench-verified

harbor view runs/terminal-bench-4.0
```

Supported benchmarks: Terminal-Bench 4.0 and 2.0, Aider Polyglot, SWE-bench Verified and SWE-bench Lite.

- `-n 2` runs two tasks at a time. Set Ollama's `OLLAMA_NUM_PARALLEL` to the same number to let it serve both at once.
- `-i <task-name>` runs just the tasks you pick, and `-l 10` runs the first 10, which is handy for quick checks.
- Containers reach Ollama on your machine at `host.docker.internal:11434`. Set `KEEL_BASE_URL` to point somewhere else.
- `harbor view` opens a browser dashboard of your runs.

For the 300-task SWE-bench Lite subset, there's a small runner that grades with the official `swebench` tool:

```
pip install -r bench/requirements.txt
python bench/swebench_lite.py --run-id my-run --limit 30
```

Commit your changes before each run. Keel uploads the current `agent.ts` for every task, so the commit hash tells you exactly which version produced a score.

## Use AWS Bedrock

The `bedrock/` folder holds a small local proxy that lets Keel talk to Claude and other models on AWS Bedrock using your normal AWS credentials. Your keys stay on your machine.

```
cd bedrock && npm install
AWS_REGION=us-east-2 node proxy.mjs
BASE_URL=http://127.0.0.1:8787/v1 MODEL=us.anthropic.claude-haiku-4-5-20251001-v1:0 node ../agent.ts "your task"
```

Delete the folder any time to remove it. Nothing else depends on it.

## Test it

```
npm install
npm run typecheck
npm test
```

`npm install` only fetches TypeScript for the type check. Keel itself has no dependencies.

The tests run the real agent loop against a scripted fake model, so they finish in under a second and need no model or network. They cover finishing a task, step limits, bad replies, history, reply parsing and command execution.

## What's inside

```
agent.ts                the whole agent
test/                   tests for the loop, adapter and command runner
bench/keel_agent.py     plugs Keel into Harbor for benchmarking
bench/swebench_lite.py  runs and grades SWE-bench Lite
bedrock/                optional proxy for AWS Bedrock
docs/                   the documentation site
```

## License

[MIT](LICENSE)
