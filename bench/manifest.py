import hashlib
import json
import os
import platform
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SUBSETS = ["terminal-bench-4.0", "terminal-bench-2.0", "aider-polyglot", "swebench-lite"]


def out(*cmd: str) -> str:
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=20).stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        return ""


def main() -> None:
    run, model = sys.argv[1], sys.argv[2]
    manifest = {
        "run": run,
        "started": datetime.now().astimezone().isoformat(timespec="seconds"),
        "model": model,
        "model_name": model.split("/", 1)[-1],
        "harness": os.environ.get("HARNESS", "baseline"),
        "keel_commit": out("git", "-C", str(ROOT), "rev-parse", "HEAD"),
        "agent_ts_sha256": hashlib.sha256((ROOT / "agent.ts").read_bytes()).hexdigest(),
        "workers": int(os.environ.get("WORKERS", "2")),
        "machine": {
            "os": platform.platform(),
            "cpus": os.cpu_count(),
            "docker": out("docker", "version", "--format", "{{.Server.Version}}"),
            "harbor": out("harbor", "--version"),
            "ollama": out("ollama", "--version"),
        },
        "subsets": {
            name: (ROOT / "bench" / "subsets" / f"{name}.txt").read_text().split() for name in SUBSETS
        },
    }
    target = ROOT / "runs" / run
    target.mkdir(parents=True, exist_ok=True)
    (target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
