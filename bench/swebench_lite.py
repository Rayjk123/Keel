import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from datasets import load_dataset

ROOT = Path(__file__).resolve().parent.parent
NODE_VERSION = (ROOT / ".nvmrc").read_text().strip()
NODE_DIR = ROOT / "bench" / ".cache" / f"node-v{NODE_VERSION}-linux-x64"
NODE_URL = f"https://nodejs.org/dist/v{NODE_VERSION}/node-v{NODE_VERSION}-linux-x64.tar.xz"
SOURCES = (ROOT / "agent.ts", ROOT / "tools.ts")
DATASET = "SWE-bench/SWE-bench_Lite"
PLATFORM = "linux/amd64"
USAGE = ("steps", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens")

PROMPT = "Fix the following issue in the repository in the current directory.\n\n{problem}"

INSIDE = """
export PATH=/opt/node/bin:$PATH
node /opt/keel/agent.ts "$TASK" > /out/keel.txt 2>&1
cd /testbed && git add -A && git diff --cached HEAD > /out/patch.diff
"""


def ensure_node(dest: Path = NODE_DIR) -> Path:
    if (dest / "bin" / "node").exists():
        return dest
    print(f"downloading Node {NODE_VERSION} for linux-x64 ...", flush=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    archive = dest.parent / f"{dest.name}.tar.xz"
    urllib.request.urlretrieve(NODE_URL, archive)
    staging = dest.parent / f"{dest.name}.partial"
    shutil.rmtree(staging, ignore_errors=True)
    with tarfile.open(archive) as tar:
        tar.extractall(staging, filter="data")
    (staging / f"node-v{NODE_VERSION}-linux-x64").rename(dest)
    shutil.rmtree(staging, ignore_errors=True)
    archive.unlink()
    return dest


def headline(error: str) -> str:
    lines = [l for l in error.splitlines() if l.strip()]
    return next((l for l in lines if "rror" in l), lines[0] if lines else "no output")


def find_swebench() -> str:
    beside_python = Path(sys.executable).parent / "swebench"
    if beside_python.exists():
        return str(beside_python)
    found = shutil.which("swebench")
    if found:
        return found
    sys.exit("swebench not found: run `pip install -r bench/requirements.txt` in the environment you use for this script")


def solve(row: dict, out_dir: Path, run_id: str, model: str, base_url: str, timeout: int) -> dict:
    instance_id = row["instance_id"]
    trial = out_dir / instance_id
    trial.mkdir(parents=True, exist_ok=True)
    (trial / "usage.json").unlink(missing_ok=True)
    name = f"keel-{run_id}-{instance_id}".replace("/", "_")
    started = time.time()
    status = "ok"
    error = ""
    try:
        run = subprocess.run(
            [
                "docker", "run", "--rm", "--name", name, "--platform", PLATFORM,
                "-v", f"{NODE_DIR}:/opt/node:ro",
                *[arg for src in SOURCES for arg in ("-v", f"{src}:/opt/keel/{src.name}:ro")],
                "-v", f"{trial}:/out",
                "-e", f"BASE_URL={base_url}", "-e", f"MODEL={model}", "-e", "USAGE_FILE=/out/usage.json",
                "-e", f"ADAPTER={os.environ.get('KEEL_ADAPTER', 'native')}",
                *(["-e", "API_KEY"] if os.environ.get("KEEL_API_KEY") else []),
                *(["-e", f"EFFORT={os.environ['KEEL_EFFORT']}"] if os.environ.get("KEEL_EFFORT") else []),
                "-e", "BASH_ENV=/root/.bashrc",
                "-e", "TASK=" + PROMPT.format(problem=row["problem_statement"]),
                "-w", "/testbed",
                row["image"], "bash", "-c", INSIDE,
            ],
            timeout=timeout,
            capture_output=True,
            text=True,
            env={**os.environ, "API_KEY": os.environ.get("KEEL_API_KEY", "")} if os.environ.get("KEEL_API_KEY") else None,
        )
        if run.returncode != 0:
            status = "docker-error"
            error = (run.stderr or run.stdout).strip()[-2000:]
            (trial / "docker-error.txt").write_text(error + "\n")
    except subprocess.TimeoutExpired:
        status = "timeout"
        subprocess.run(["docker", "kill", name], capture_output=True)
    patch_file = trial / "patch.diff"
    patch = patch_file.read_text() if patch_file.exists() else ""
    try:
        usage = json.loads((trial / "usage.json").read_text())
    except (OSError, ValueError):
        usage = {}
    return {
        "instance_id": instance_id,
        "model_name_or_path": "keel",
        "model_patch": patch,
        "status": status,
        "error": error,
        "seconds": round(time.time() - started),
        **{key: usage.get(key) for key in USAGE},
    }


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--run-id", required=True)
    p.add_argument("--model", default="qwen3-coder:30b")
    p.add_argument("--base-url", default=os.environ.get("KEEL_BASE_URL", "http://host.docker.internal:11434/v1"))
    p.add_argument("--workers", type=int, default=2)
    p.add_argument("--limit", type=int)
    p.add_argument("-i", "--instance-ids", nargs="+")
    p.add_argument("--out")
    p.add_argument("--timeout", type=int, default=1800)
    p.add_argument("--skip-eval", action="store_true")
    args = p.parse_args()

    swebench = find_swebench()
    ensure_node()
    rows = list(load_dataset(DATASET, split="test"))
    if args.instance_ids:
        rows = [r for r in rows if r["instance_id"] in set(args.instance_ids)]
    if args.limit:
        rows = rows[: args.limit]

    out_dir = (ROOT / args.out) if args.out else ROOT / "runs" / "swebench-lite" / args.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    preds_path = out_dir / "predictions.jsonl"
    done = {}
    if preds_path.exists():
        done = {json.loads(l)["instance_id"]: l for l in preds_path.read_text().splitlines() if l}
    todo = [r for r in rows if r["instance_id"] not in done]
    print(f"{len(rows)} instances, {len(done)} already done, {len(todo)} to run", flush=True)

    failed: list[str] = []
    with preds_path.open("a") as sink, ThreadPoolExecutor(args.workers) as pool:
        futures = [pool.submit(solve, r, out_dir, args.run_id, args.model, args.base_url, args.timeout) for r in todo]
        for f in futures:
            result = f.result()
            line = f"{result['instance_id']}: {result['status']} {result['seconds']}s patch={len(result['model_patch'])}B"
            if result["status"] == "docker-error":
                failed.append(result["instance_id"])
                print(f"{line}\n    {headline(result['error'])}", flush=True)
                continue
            sink.write(json.dumps(result) + "\n")
            sink.flush()
            print(line, flush=True)

    if failed:
        print(f"{len(failed)} instance(s) failed to start and were left out so a rerun retries them: {', '.join(failed)}", flush=True)
    if args.skip_eval:
        return
    command = [
        swebench,
        "eval", DATASET,
        "--predictions", str(preds_path),
        "--run-id", args.run_id,
        "--workers", str(args.workers),
        "--report-dir", str(out_dir),
    ]
    for r in rows:
        command += ["-i", r["instance_id"]]
    subprocess.run(command, cwd=out_dir, check=False, env={**os.environ, "DOCKER_DEFAULT_PLATFORM": PLATFORM})


if __name__ == "__main__":
    main()
