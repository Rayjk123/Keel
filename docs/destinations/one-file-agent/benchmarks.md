# Benchmarks

Keel includes an adapter for [Harbor](https://harborframework.com) (install it with `uv tool install harbor`), which runs each task in its own Docker container, runs Keel inside it, and scores the result with the task's official tests.

## Run a benchmark

Pick a dataset from the table, then run it with Keel as the agent:

| Benchmark | Dataset (`-d`) | Tasks |
|---|---|---|
| Terminal-Bench 2.0 | `terminal-bench@2.0` | 89 |
| Terminal-Bench 4.0 | `terminal-bench/terminal-bench@4` | 66 |
| Aider Polyglot | `aider/aider-polyglot` | 225 |
| SWE-bench Verified | `swe-bench/swe-bench-verified` | 500 |

```bash
export PYTHONPATH=$PWD/bench

harbor run -d terminal-bench/terminal-bench@4 -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/terminal-bench-4.0

harbor run -d aider/aider-polyglot -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/aider-polyglot

DOCKER_DEFAULT_PLATFORM=linux/amd64 \
  harbor run -d swe-bench/swe-bench-verified -a keel_agent:KeelAgent -m ollama/qwen3-coder:30b -n 2 -o runs/swe-bench-verified

harbor view runs/terminal-bench-4.0
```

| Option | What it does |
|---|---|
| `-d` | The dataset to run |
| `-a keel_agent:KeelAgent` | Use Keel as the agent |
| `-m` | The model, written as `provider/name` |
| `-n 2` | Run two tasks at a time |
| `-l 10` | Run only the first 10 tasks, handy for a quick check |
| `-i <task-name>` | Run just the tasks you pick |
| `-o <folder>` | Save the results in this folder |

**Terminal-Bench 4.0** is version 4 of the `terminal-bench/terminal-bench` dataset. Version 5 is Terminal-Bench 4.1, and version 1 is 3.0, so you can run any of them by changing the number after `@`.

**Aider Polyglot** is 225 coding exercises in several languages. Each one asks the agent to edit files until the exercise's tests pass, which makes it a quick, direct check of how well Keel edits code.

`harbor view` opens a browser dashboard of your runs.

## SWE-bench Lite

SWE-bench Lite is a 300-task subset of SWE-bench that's quicker to run. Keel includes a small script for it, `bench/swebench_lite.py`. It runs Keel on each task inside the task's Docker image, saves the patch Keel produces, and grades the patches with the official `swebench` tool.

```bash
pip install -r bench/requirements.txt

python bench/swebench_lite.py --run-id my-run --limit 30
```

| Option | What it does |
|---|---|
| `--run-id` | Names the run. Results go to `runs/swebench-lite/<run-id>/` |
| `--limit N` | Run only the first N tasks |
| `-i <id> ...` | Run just the tasks you name |
| `--workers 2` | Run two tasks at a time |
| `--model`, `--base-url` | Which model and endpoint to use |
| `--timeout` | Seconds allowed per task (default 1800) |
| `--skip-eval` | Produce the patches but don't grade them yet |

The script downloads the Linux build of Node it needs the first time it runs. Runs are resumable: start the same command again and tasks that are already finished are skipped. A task whose container fails to start is left out and noted in the output, so rerunning retries it.

When grading finishes, `swebench` writes a report to the run folder, and the patches are in `predictions.jsonl`.

## How the Docker setup fits together

Keel runs inside each task's container, where it works on the project's code. Your model keeps running on your machine, where it can use your GPU. Containers reach it at `host.docker.internal:11434`. Set `KEEL_BASE_URL` to point somewhere else.

```
Your machine                              Docker container (one per task)
┌──────────────────────┐                  ┌──────────────────────────────┐
│ Ollama + your model  │ ◄─────────────── │ Keel, running the task's code│
└──────────────────────┘   HTTP request   └──────────────────────────────┘
```

Each task starts from a clean copy of its project, so runs can't affect each other.

## Tips

- Set Ollama's `OLLAMA_NUM_PARALLEL` to the same number as `-n`, so it can serve that many tasks at once.
- Commit your changes before each run. Keel uploads the current `agent.ts` for every task, so the commit hash tells you exactly which version produced a score.
- SWE-bench images are built for x86. On an Apple silicon Mac, set `DOCKER_DEFAULT_PLATFORM=linux/amd64` as shown above.
