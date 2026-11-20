#!/usr/bin/env bash
# Runs the benchmark subsets for each model in MODELS: Terminal-Bench 4.0, Terminal-Bench 2.0, Aider Polyglot, then SWE-bench Lite.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
export PYTHONPATH="$PWD/bench"
MODELS="${MODELS:-ollama/qwen3-coder:30b}"
WORKERS="${WORKERS:-2}"
MIN_FREE_GB="${MIN_FREE_GB:-15}"
if [ -z "${BENCH_PYTHON:-}" ]; then
  if [ -x bench/.venv/bin/python ]; then BENCH_PYTHON=bench/.venv/bin/python; else BENCH_PYTHON=python3; fi
fi
export WORKERS

free_gb() { df -g / | awk 'NR==2 {print $4}'; }

tidy_images() {
  docker images --format '{{.Repository}}:{{.Tag}} {{.ID}}' | grep -E '^(alexgshaw/|harborframework/terminal-bench|swebench/)' | awk '{print $2}' | sort -u | xargs docker rmi >/dev/null 2>&1
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

pick() { sed 's/^/-i /' "bench/subsets/$1.txt" | tr '\n' ' '; }

for MODEL in $MODELS; do
  RUN="${RUN:-$(echo "${MODEL#*/}" | tr -c 'A-Za-z0-9.\n' '-' | sed 's/-*$//')}"
  mkdir -p "runs/$RUN"
  "$BENCH_PYTHON" bench/manifest.py "$RUN" "$MODEL"
  echo "=== $MODEL ($RUN)"

  harbor run -d terminal-bench/terminal-bench@4 -a keel_agent:KeelAgent -m "$MODEL" -n "$WORKERS" $(pick terminal-bench-4.0) -o "runs/$RUN/terminal-bench-4.0" --job-name "$RUN"
  harbor run -d terminal-bench@2.0 -a keel_agent:KeelAgent -m "$MODEL" -n "$WORKERS" $(pick terminal-bench-2.0) -o "runs/$RUN/terminal-bench-2.0" --job-name "$RUN"
  harbor run -d aider/aider-polyglot -a keel_agent:KeelAgent -m "$MODEL" -n "$WORKERS" $(pick aider-polyglot) -o "runs/$RUN/aider-polyglot" --job-name "$RUN"
  "$BENCH_PYTHON" bench/swebench_lite.py --run-id "$RUN" --out "runs/$RUN/swebench-lite" --workers "$WORKERS" --model "${MODEL#*/}" -i $(cat bench/subsets/swebench-lite.txt)
  unset RUN
done
