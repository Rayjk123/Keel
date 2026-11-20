#!/usr/bin/env bash
# Prepares a fresh machine to run the Keel benchmarks, and tells you what is still missing.
set -u
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/bin:$PATH"
HARBOR_VERSION=0.26.0
MODELS="${MODELS:-ollama/qwen3-coder:30b}"
missing=0

ok() { echo "  ok       $1"; }
need() { echo "  MISSING  $1"; missing=1; }

echo "Checking tools"
want="$(tr -d 'v\n' < .nvmrc)"
have="$(node --version 2>/dev/null | tr -d 'v')"
if [ -n "$have" ] && [ "$(printf '%s\n%s\n' "$want" "$have" | sort -V | head -1)" = "$want" ]; then ok "node $have"; else echo "  optional Node $want or later, only for npm test (nvm install; nvm use)"; fi
if docker info >/dev/null 2>&1; then ok "docker"; else need "Docker, running (Docker Desktop or the docker daemon)"; fi
if command -v uv >/dev/null; then ok "uv"; else need "uv (https://docs.astral.sh/uv/getting-started/installation/)"; fi

if command -v uv >/dev/null; then
  if harbor --version 2>/dev/null | grep -q "$HARBOR_VERSION"; then ok "harbor $HARBOR_VERSION"; else
    echo "  installing harbor $HARBOR_VERSION"
    uv tool install --force "harbor==$HARBOR_VERSION" >/dev/null 2>&1 && ok "harbor $HARBOR_VERSION" || need "harbor $HARBOR_VERSION (uv tool install harbor==$HARBOR_VERSION)"
  fi
  if [ ! -x bench/.venv/bin/python ]; then uv venv bench/.venv >/dev/null 2>&1; fi
  if uv pip install --python bench/.venv/bin/python -r bench/requirements.txt >/dev/null 2>&1; then ok "python environment (bench/.venv)"; else need "python packages (uv pip install -r bench/requirements.txt)"; fi
fi

if docker info >/dev/null 2>&1; then
  gb=$(( $(docker info --format '{{.MemTotal}}') / 1073741824 ))
  if [ "$gb" -ge 12 ]; then ok "docker memory ${gb} GB"; else need "Docker memory of at least 12 GB (now ${gb} GB): raise it in Docker Desktop settings"; fi
fi

free=$(df -g . | awk 'NR==2 {print $4}')
if [ "$free" -ge 60 ]; then ok "disk ${free} GB free"; else need "at least 60 GB free disk (${free} GB now)"; fi

for model in $MODELS; do
  case "$model" in
    ollama/*)
      name="${model#ollama/}"
      if ! command -v ollama >/dev/null; then need "Ollama (https://ollama.com)"; continue; fi
      if ollama list | awk 'NR>1 {print $1}' | grep -qx "$name"; then ok "model $name"; else
        echo "  pulling $name"; ollama pull "$name" >/dev/null && ok "model $name" || need "model $name"
      fi
      ;;
  esac
done

echo
if [ "$missing" -eq 0 ]; then
  echo "Ready. Run: MODELS=\"$MODELS\" bench/baseline.sh"
  echo "For two tasks at a time with Ollama, start it with OLLAMA_NUM_PARALLEL=2 OLLAMA_CONTEXT_LENGTH=32768"
else
  echo "Fix the missing items above, then run this script again."
  exit 1
fi
