# Harness changes

Destination 1 is a baseline on purpose. The agent is one file with one tool, so every ability it gains afterwards can be added alone and measured alone.

The method is the same each time:

1. Pick one change from the list below.
2. Make it in `agent.ts`, and add a test.
3. Run the benchmark subsets with the same model: `HARNESS=<change> bench/baseline.sh`.
4. Run `python bench/summarize.py` and read the new bar on the [scoreboard](results.md).
5. Write down what moved, and which tasks flipped, in the table here.

## The ledger

| # | Harness | What it adds | Run | Result |
|---|---|---|---|---|
| 0 | **Baseline** | One bash tool, a fenced-block reply format, a 50-step limit | `qwen3-coder-30b` | On the [scoreboard](results.md) |
| 1 | **File-edit tool** | Edit a file by replacing exact text instead of rewriting it with shell commands | | Next up |
| 2 | **Workflow prompt** | A recommended path in the system prompt: explore, reproduce, edit, verify | | Planned |
| 3 | **Clear command output** | Show the exit code and output in a form the model can't misread | | Planned |
| 4 | **Persistent shell** | Keep the directory and environment between commands | | Planned |
| 5 | **Skills support** | Declare and load the skills that some Terminal-Bench tasks ask for | | Planned |
| 6 | **Strict completion** | Check the work before accepting the finish command | | Planned |
| 7 | **Native tool calling** | Use the model's own tool-call format where it is reliable | | Planned |
| 8 | **Trajectory output** | Write each run's steps in the standard format so Harbor can replay them | | Planned |

Each row gets a run name when it is measured, and the result column gets the change in pass rate for each benchmark.

## Why this order

- **The file-edit tool comes first** because the baseline sometimes wrote `.bak` and `.fixed` copies of files instead of changing the source. A real edit tool should turn those near-misses into passes on the coding benchmarks.
- **The workflow prompt is cheap and large.** Other small agents get a lot from telling the model how a developer works through a bug.
- **Clear output and a persistent shell** make every later change easier for the model to use.
- **Skills support** unlocks Terminal-Bench tasks that the harness can't currently start.

## Adding a new idea

Add a row, give it a number, and keep the change to one thing. If two changes land together, the scoreboard can't tell you which one did the work.
