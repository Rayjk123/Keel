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
COLORS = ["#0d9488", "#6366f1", "#f59e0b", "#ec4899", "#0ea5e9", "#84cc16"]


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
        "started": manifest["started"],
        "keel_commit": manifest["keel_commit"],
        "scores": scores,
    }


def table(runs: list[dict]) -> str:
    head = "| Harness | Model | " + " | ".join(t for _, t in BENCHMARKS) + " |\n"
    head += "|---|---|" + "---|" * len(BENCHMARKS) + "\n"
    lines = []
    for r in runs:
        cells = []
        for key, _ in BENCHMARKS:
            s = r["scores"][key]
            cells.append(f"{s['passed']}/{s['total']}" if s["finished"] == s["total"] else f"{s['passed']}/{s['total']} ({s['finished']} done)" if s["finished"] else "pending")
        lines.append(f"| {r['harness']} | {r['model_name']} | " + " | ".join(cells) + " |")
    return head + "\n".join(lines) + "\n"


def chart(runs: list[dict]) -> str:
    width, height, left, top, plot_h = 760, 380, 56, 56, 240
    group_w = (width - left - 20) / len(BENCHMARKS)
    bar_w = min(36, (group_w - 24) / max(len(runs), 1))
    css = (
        ":root{--fg:#1f2937;--grid:#e5e7eb;--bg:#ffffff}"
        "@media (prefers-color-scheme:dark){:root{--fg:#e5e7eb;--grid:#374151;--bg:#111827}}"
        "text{font-family:system-ui,sans-serif;fill:var(--fg)}"
    )
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" role="img" aria-label="Pass rate by benchmark for each run"><style>{css}</style>']
    for pct in (0, 25, 50, 75, 100):
        y = top + plot_h - plot_h * pct / 100
        out.append(f'<line x1="{left}" x2="{width - 20}" y1="{y}" y2="{y}" stroke="var(--grid)"/>')
        out.append(f'<text x="{left - 8}" y="{y + 4}" font-size="11" text-anchor="end">{pct}%</text>')
    for gi, (key, title) in enumerate(BENCHMARKS):
        gx = left + gi * group_w + group_w / 2
        out.append(f'<text x="{gx}" y="{top + plot_h + 22}" font-size="12" text-anchor="middle">{title}</text>')
        start = gx - bar_w * len(runs) / 2
        for ri, r in enumerate(runs):
            s = r["scores"][key]
            if not s["total"] or not s["finished"]:
                continue
            frac = s["passed"] / s["total"]
            h = max(plot_h * frac, 2)
            x = start + ri * bar_w
            out.append(f'<rect x="{x + 2}" y="{top + plot_h - h}" width="{bar_w - 4}" height="{h}" rx="3" fill="{COLORS[ri % len(COLORS)]}"/>')
            out.append(f'<text x="{x + bar_w / 2}" y="{top + plot_h - h - 6}" font-size="11" text-anchor="middle">{s["passed"]}/{s["total"]}</text>')
    lx = left
    for ri, r in enumerate(runs):
        out.append(f'<rect x="{lx}" y="{height - 32}" width="12" height="12" rx="2" fill="{COLORS[ri % len(COLORS)]}"/>')
        out.append(f'<text x="{lx + 18}" y="{height - 22}" font-size="12">{r["run"]}</text>')
        lx += 36 + 7.2 * len(r["run"])
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
