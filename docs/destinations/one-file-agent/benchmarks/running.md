# Running the benchmarks

Run the benchmarks yourself, from a quick baseline on a fresh machine to a full benchmark. Scores land on the [Benchmarks](index.md) page.

## Quick baseline on any machine

A few commands set up a fresh computer and score a model on a hand-picked set of 10 tasks from each benchmark:

```
git clone https://github.com/Rayjk123/Keel && cd Keel
export MODELS="ollama/qwen3-coder:30b ollama/gpt-oss:20b"
bench/setup.sh
bench/baseline.sh
```

`bench/setup.sh` checks for Docker, installs Harbor and the Python packages, and pulls any Ollama models you list. It tells you what is still missing. On Linux with Docker Engine, first point the containers at your model, as [How the Docker setup fits together](#how-the-docker-setup-fits-together) explains. `bench/baseline.sh` then runs Terminal-Bench 4.0, Terminal-Bench 2.0, Aider Polyglot and SWE-bench Lite for each model in turn.

Runs use native tool calling and are labelled `native-tools`. To rerun the original text mode for comparison, set `KEEL_ADAPTER=text`, and the run is labelled `baseline`. `KEEL_MAX_STEPS` changes the 50-reply limit.

Each model gets its own folder, `runs/<trial>/<run>/`, with a `manifest.json` that records the commit, the machine and the exact tasks, next to the results for every benchmark. That makes models easy to compare side by side. The trial is `native-tools` by default and `text-and-bash` with `KEEL_ADAPTER=text`; set `TRIAL` to start a new one. Set `EFFORT`, for example `EFFORT=max`, to run at a given reasoning effort: the manifest and the scoreboard record it, and the folder gets an `-<effort>` suffix unless you set `RUN`.

At the end of a run, `bench/baseline.sh` runs `bench/summarize.py`, which reads every folder under `runs/` and rewrites `runs/results.json` (every task's outcome and the reason it failed), `runs/scoreboard.md`, `runs/failures.md` and the charts on the [Benchmarks](index.md) page. Commit them with the run, and the docs site picks them up on the next build.

The task lists live in `bench/subsets/`. Add a name to a list to grow a benchmark.

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

Keel runs inside each task's container, where it works on the project's code. Your model keeps running on your machine, where it can use your GPU. Containers reach it at `host.docker.internal:11434`. Set `KEEL_BASE_URL` to point somewhere else, and `KEEL_API_KEY` if that API needs a key, as [OpenRouter](../getting-started/models.md#openrouter) does. On Linux with Docker Engine, containers can't reach `host.docker.internal`. Serve the model on the Docker bridge address instead, usually `172.17.0.1` (`ip -4 addr show docker0` shows yours): for Ollama, export `OLLAMA_HOST=172.17.0.1` in the shells where you start Ollama and run `bench/setup.sh`, and set `KEEL_BASE_URL=http://172.17.0.1:11434/v1`.

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
