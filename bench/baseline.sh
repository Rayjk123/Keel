#!/usr/bin/env bash
# Runs the baseline benchmarks in order: Terminal-Bench 4.0, Aider Polyglot, then a SWE-bench Lite sample.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
export PYTHONPATH="$PWD/bench"
MODEL="${MODEL:-ollama/qwen3-coder:30b}"
WORKERS="${WORKERS:-2}"
LITE_LIMIT="${LITE_LIMIT:-30}"
BENCH_PYTHON="${BENCH_PYTHON:-python3}"
RUN="${RUN:-baseline}"
MIN_FREE_GB="${MIN_FREE_GB:-15}"

free_gb() { df -g / | awk 'NR==2 {print $4}'; }

tidy_images() {
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | rg '^(alexgshaw/|harborframework/terminal-bench|swebench/)' | awk '{print $2}' | sort -u | xargs docker rmi >/dev/null 2>&1
}

guard() {
  while sleep 60; do
    [ "$(free_gb)" -lt "$MIN_FREE_GB" ] && tidy_images
    if [ "$(free_gb)" -lt "$MIN_FREE_GB" ]; then
      echo "stopping: under ${MIN_FREE_GB} GB free" >&2
      pkill -P $$ -f 'harbor|swebench_lite' ; kill $$
    fi
  done
}
guard &
GUARD=$!
trap 'kill $GUARD 2>/dev/null' EXIT

harbor run -d terminal-bench/terminal-bench@4 -a keel_agent:KeelAgent -m "$MODEL" -n "$WORKERS" -o runs/terminal-bench-4.0 --job-name "$RUN"
harbor run -d aider/aider-polyglot -a keel_agent:KeelAgent -m "$MODEL" -n "$WORKERS" -o runs/aider-polyglot --job-name "$RUN"
"$BENCH_PYTHON" bench/swebench_lite.py --run-id "$RUN" --limit "$LITE_LIMIT" --workers "$WORKERS" --model "${MODEL#*/}"
