import glob
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"
BENCHMARKS = [
    ("terminal-bench-4.0", "Terminal-Bench 4.0"),
    ("terminal-bench-2.0", "Terminal-Bench 2.0"),
    ("aider-polyglot", "Aider Polyglot"),
    ("swebench-lite", "SWE-bench Lite"),
]
BAR = "#0d9488"


def harbor_outcomes(folder: Path) -> dict[str, bool]:
    latest: dict[str, tuple[str, bool]] = {}
    for f in glob.glob(str(folder / "*" / "result.json")) + glob.glob(str(folder / "*" / "*" / "result.json")):
        try:
            d = json.loads(Path(f).read_text())
        except (OSError, ValueError):
            continue
        name = str(d.get("task_name", "")).split("/")[-1]
        reward = ((d.get("verifier_result") or {}).get("rewards") or {}).get("reward")
        stamp = str(d.get("finished_at") or d.get("started_at") or "")
        if name and stamp and (name not in latest or stamp > latest[name][0]):
            latest[name] = (stamp, reward == 1.0)
    return {name: passed for name, (_, passed) in latest.items()}


def lite_outcomes(folder: Path, tasks: list[str]) -> dict[str, bool]:
    resolved: set[str] = set()
    found = False
    for f in glob.glob(str(folder / "*.json")):
        try:
            d = json.loads(Path(f).read_text())
        except (OSError, ValueError):
            continue
        if "resolved_ids" in d:
            found = True
            resolved |= set(d["resolved_ids"])
    return {t: t in resolved for t in tasks} if found else {}


def summarize_run(run_dir: Path) -> dict:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    scores = {}
    for key, title in BENCHMARKS:
        tasks = [t.split("/")[-1] for t in manifest["subsets"].get(key, [])]
        folder = run_dir / key
        if key == "swebench-lite":
            outcomes = lite_outcomes(folder, tasks)
        else:
            outcomes = harbor_outcomes(folder)
        results = {t: outcomes[t] for t in tasks if t in outcomes}
        scores[key] = {
            "title": title,
            "passed": sum(results.values()),
            "total": len(tasks),
            "finished": len(results),
            "tasks": {t: results.get(t) for t in tasks},
        }
    return {
        "run": manifest["run"],
        "model": manifest["model"],
        "model_name": manifest.get("model_name") or manifest["model"].split("/", 1)[-1],
        "harness": manifest.get("harness", "baseline"),
        "effort": manifest.get("effort", "default"),
        "started": manifest["started"],
        "keel_commit": manifest["keel_commit"],
        "scores": scores,
    }


def table(runs: list[dict]) -> str:
    head = "| Harness | Model | Effort | " + " | ".join(t for _, t in BENCHMARKS) + " |\n"
    head += "|---|---|---|" + "---|" * len(BENCHMARKS) + "\n"
    lines = []
    for r in runs:
        cells = []
        for key, _ in BENCHMARKS:
            s = r["scores"][key]
            cells.append(f"{s['passed']}/{s['total']}" if s["finished"] == s["total"] else f"{s['passed']}/{s['total']} ({s['finished']} done)" if s["finished"] else "pending")
        lines.append(f"| {r['harness']} | {r['model_name']} | {r['effort']} | " + " | ".join(cells) + " |")
    return head + "\n".join(lines) + "\n"


def chart(runs: list[dict]) -> str:
    rows = sorted(runs, key=lambda r: -sum(r["scores"][k]["passed"] for k, _ in BENCHMARKS))
    width, label_w, gap, top, row_h, bar_h = 760, 176, 16, 40, 24, 12
    panel_w = (width - label_w - gap * (len(BENCHMARKS) - 1)) / len(BENCHMARKS)
    bar_max = panel_w - 40
    height = top + row_h * len(rows) + 8
    css = (
        ":root{--fg:#1f2937;--grid:#e5e7eb;--bg:#ffffff}"
        "@media (prefers-color-scheme:dark){:root{--fg:#e5e7eb;--grid:#374151;--bg:#111827}}"
        "text{font-family:system-ui,sans-serif;fill:var(--fg)}"
    )
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Pass rate by benchmark for each run"><style>{css}</style>']
    for gi, (_, title) in enumerate(BENCHMARKS):
        px = label_w + gi * (panel_w + gap)
        out.append(f'<text x="{px}" y="24" font-size="12" font-weight="600">{title}</text>')
        out.append(f'<line x1="{px}" x2="{px}" y1="{top}" y2="{top + row_h * len(rows)}" stroke="var(--grid)"/>')
    for ri, r in enumerate(rows):
        y = top + ri * row_h
        out.append(f'<text x="{label_w - 12}" y="{y + 16}" font-size="12" text-anchor="end">{r["run"]}</text>')
        for gi, (key, _) in enumerate(BENCHMARKS):
            s = r["scores"][key]
            px = label_w + gi * (panel_w + gap)
            w = bar_max * s["passed"] / s["total"] if s["total"] else 0
            if w:
                by, end = y + (row_h - bar_h) / 2, px + w
                out.append(f'<path d="M{px} {by}H{end - 4}a4 4 0 0 1 4 4v{bar_h - 8}a4 4 0 0 1 -4 4H{px}Z" fill="{BAR}"/>')
            label = f"{s['passed']}/{s['total']}" if s["finished"] else "pending"
            out.append(f'<text x="{px + w + 6}" y="{y + 16}" font-size="11">{label}</text>')
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main() -> None:
    runs = sorted(
        (summarize_run(p.parent) for p in RUNS.glob("*/manifest.json")),
        key=lambda r: r["started"],
    )
    runs = [r for r in runs if any(s["finished"] for s in r["scores"].values())]
    (RUNS / "results.json").write_text(json.dumps(runs, indent=2) + "\n")
    (RUNS / "scoreboard.md").write_text(table(runs))
    charts = ROOT / "docs" / "assets" / "charts"
    charts.mkdir(parents=True, exist_ok=True)
    (charts / "scoreboard.svg").write_text(chart(runs))
    print(table(runs))


if __name__ == "__main__":
    main()
