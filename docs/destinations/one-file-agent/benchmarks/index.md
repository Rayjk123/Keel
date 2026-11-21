# Benchmarks

Keel is scored on Terminal-Bench 4.0, Terminal-Bench 2.0, Aider Polyglot and SWE-bench Lite, with the same 10 hand-picked tasks from each every time. Keel includes an adapter for [Harbor](https://harborframework.com) (install it with `uv tool install harbor`), which runs each task in its own Docker container, runs Keel inside it, and scores the result with the task's official tests.

Every change to the harness gets a score. The chart has one bar per run, grouped by benchmark, so you can watch the success rate move as Keel gains new abilities. To run the benchmarks yourself or add a run, see [Running the benchmarks](running.md).

![Pass rate by benchmark for each run](../../../assets/charts/scoreboard.svg)

## Scoreboard

--8<-- "runs/scoreboard.md"

Each cell is tasks passed out of tasks attempted. Every run uses the same 10 hand-picked tasks per benchmark (the lists are in `bench/subsets/`), so a bar going up means the harness got better, not that the questions got easier.

## How a run is scored

- **Pass means the official tests passed.** Terminal-Bench and Aider Polyglot run each task's own tests in its container. SWE-bench Lite is graded by the SWE-bench harness.
- **Errors count as failures.** If a task can't start or can't be graded, it scores zero, because the harness is what has to cope with it.
- **Same tasks every time.** The task lists are fixed, so runs are comparable. Growing a list starts a new series.
- **Everything is recorded.** Each run lives in `runs/<run>/` with a `manifest.json` holding the commit, the hash of `agent.ts`, the machine and the exact tasks, next to every trial's logs.

## Models and harness changes

Every run records two separate labels in its manifest: the **harness** (`baseline`, `edit-tool`, and so on) and the **model**. That keeps the two questions apart, and a leaderboard can sort or filter by either:

| Question | Hold fixed | Change | Example |
|---|---|---|---|
| Which model is best in this harness? | Harness | Model | `HARNESS=baseline`, a different model |
| Which harness change helps? | Model | Harness | the same model, `HARNESS=edit-tool` |

The folder name combines them, `runs/<model>/` for the baseline and `runs/<model>-<harness>/` after that.
