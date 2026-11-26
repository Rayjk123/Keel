import collections
import glob
import json
import statistics
from datetime import datetime
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUNS = ROOT / "runs"
BENCHMARKS = [
    ("terminal-bench-4.0", "Terminal-Bench 4.0"),
    ("terminal-bench-4.1", "Terminal-Bench 4.1"),
    ("terminal-bench-2.0", "Terminal-Bench 2.0"),
    ("aider-polyglot", "Aider Polyglot"),
    ("swebench-lite", "SWE-bench Lite"),
]
REASONS = [
    "passed", "wrong-answer", "no-patch", "no-command", "malformed-tool-call", "step-limit",
    "request-timeout", "context-limit", "task-time-limit", "refused", "model-error", "unsupported", "environment", "not-run",
]
FAMILIES = ["Claude", "GPT-6", "GPT-OSS", "Qwen", "Kimi", "Grok", "GLM", "Devstral", "Other"]
MODELS = {
    "bedrock/us.anthropic.claude-haiku-5-5": ("Claude", "Claude Haiku 5.5"),
    "bedrock/us.anthropic.claude-sonnet-5-5": ("Claude", "Claude Sonnet 5.5"),
    "bedrock/us.anthropic.claude-opus-5-5": ("Claude", "Claude Opus 5.5"),
    "bedrock/us.openai.gpt-6.2-astra": ("GPT-6", "GPT-6.2 Astra"),
    "bedrock/us.openai.gpt-6.2-sol": ("GPT-6", "GPT-6.2 Sol"),
    "bedrock/us.openai.gpt-6.1-terra": ("GPT-6", "GPT-6.1 Terra"),
    "ollama/gpt-oss:20b": ("GPT-OSS", "GPT-OSS 20B"),
    "bedrock/openai.gpt-oss-20b-1:0": ("GPT-OSS", "GPT-OSS 20B"),
    "bedrock/openai.gpt-oss-120b-1:0": ("GPT-OSS", "GPT-OSS 120B"),
    "ollama/qwen3-coder:30b": ("Qwen", "Qwen3 Coder 30B"),
    "bedrock/qwen.qwen3-coder-30b-a3b-v1:0": ("Qwen", "Qwen3 Coder 30B"),
    "bedrock/qwen.qwen3-coder-480b-a35b-v1:0": ("Qwen", "Qwen3 Coder 480B"),
    "bedrock/moonshotai.kimi-k2.5": ("Kimi", "Kimi K2.5"),
    "bedrock/us.xai.grok-4.7": ("Grok", "Grok 4.7"),
    "bedrock/zai.glm-5": ("GLM", "GLM 5"),
    "bedrock/zai.glm-4.7-flash": ("GLM", "GLM 4.7 Flash"),
    "ollama/devstral:24b": ("Devstral", "Devstral 24B"),
}
NAMES = list(dict.fromkeys(name for _, name in MODELS.values()))
HOSTS = {"bedrock": "Bedrock", "ollama": "Ollama"}
HARNESSES = {"baseline": "text", "native-tools": "native"}
EFFORTS = ["minimal", "low", "medium", "default", "high", "xhigh", "max"]
CATEGORIES = [
    ("Passed", ["passed"]),
    ("Wrong answer", ["wrong-answer", "no-patch"]),
    ("Unusable reply", ["no-command", "malformed-tool-call"]),
    ("Out of steps, time or context", ["step-limit", "request-timeout", "context-limit", "task-time-limit"]),
    ("Other", ["refused", "model-error", "unsupported", "environment", "not-run"]),
]
TEAL = "#0d9488"
COLORS = [TEAL, "var(--c1)", "var(--c2)", "var(--c3)", "var(--c4)"]
CSS = (
    ":root{--fg:#1f2937;--muted:#6b7280;--grid:#e5e7eb;--bg:#ffffff;--c1:#eb6834;--c2:#6250d6;--c3:#eda100;--c4:#e87ba4}"
    "@media (prefers-color-scheme:dark){:root{--fg:#e5e7eb;--muted:#9ca3af;--grid:#374151;--bg:#1e2129;"
    "--c1:#d95926;--c2:#9085e9;--c3:#c98500;--c4:#d55181}}"
    "text{font-family:system-ui,sans-serif;font-size:14px;fill:var(--fg)}"
    ".muted{fill:var(--muted)}.bold{font-weight:600}.small{font-size:12px}.inside{fill:#ffffff;font-size:12px}"
)
W, ROW, GAP, LABEL_W = 880, 26, 12, 270
METRICS = ["steps", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "seconds"]


def agent_reason(log: Path) -> str | None:
    try:
        lines = [line for line in log.read_text(errors="replace").splitlines() if line.strip()]
    except OSError:
        return None
    last = lines[-1] if lines else ""
    tail = "\n".join(lines[-60:])
    if last.startswith("Node.js v") or last.startswith("stopped: the model request failed"):
        if "cyber_policy" in tail or "content filtering" in tail:
            return "refused"
        if "TimeoutError" in tail:
            return "request-timeout"
        if any(m in tail for m in ("error parsing tool call", "XML syntax error", "toolUse.name")):
            return "malformed-tool-call"
        if any(m in tail for m in ("maximum context length", "prompt is too long", "context_length_exceeded")):
            return "context-limit"
        return "model-error"
    if last.startswith("stopped: no command in"):
        return "no-command"
    if last.startswith("stopped: step limit reached"):
        return "step-limit"
    return None


def harbor_reason(result: dict, trial: Path) -> str:
    if ((result.get("verifier_result") or {}).get("rewards") or {}).get("reward") == 1.0:
        return "passed"
    exc = result.get("exception_info") or {}
    kind = exc.get("exception_type")
    if kind == "ValueError" and "skills" in str(exc.get("exception_message")):
        return "unsupported"
    if kind == "AgentSafetyRefusalError":
        return "refused"
    agent = agent_reason(trial / "agent" / "keel.txt")
    if agent in ("refused", "request-timeout", "malformed-tool-call", "context-limit", "model-error"):
        return agent
    if kind == "AgentTimeoutError":
        return "task-time-limit"
    if agent:
        return agent
    if kind in (None, "RewardFileNotFoundError", "VerifierTimeoutError"):
        return "wrong-answer"
    return "environment"


def harbor_latest(folder: Path) -> dict[str, tuple[dict, Path]]:
    latest: dict[str, tuple[str, dict, Path]] = {}
    for f in glob.glob(str(folder / "*" / "result.json")) + glob.glob(str(folder / "*" / "*" / "result.json")):
        try:
            d = json.loads(Path(f).read_text())
        except (OSError, ValueError):
            continue
        name = str(d.get("task_name", "")).split("/")[-1]
        stamp = str(d.get("finished_at") or d.get("started_at") or "")
        if name and stamp and (name not in latest or stamp > latest[name][0]):
            latest[name] = (stamp, d, Path(f).parent)
    return {name: (d, trial) for name, (_, d, trial) in latest.items()}


def harbor_outcomes(folder: Path) -> dict[str, tuple[bool, str]]:
    outcomes = {}
    for name, (result, trial) in harbor_latest(folder).items():
        reason = harbor_reason(result, trial)
        outcomes[name] = (reason == "passed", reason)
    return outcomes


def elapsed(timing: dict | None) -> int | None:
    try:
        return round((datetime.fromisoformat(timing["finished_at"]) - datetime.fromisoformat(timing["started_at"])).total_seconds())
    except (TypeError, KeyError, ValueError):
        return None


def harbor_metrics(result: dict) -> dict:
    agent = result.get("agent_result") or {}
    meta = agent.get("metadata") or {}
    return {
        "steps": meta.get("steps"),
        "input_tokens": agent.get("n_input_tokens"),
        "output_tokens": agent.get("n_output_tokens"),
        "cache_read_tokens": agent.get("n_cache_tokens"),
        "cache_write_tokens": meta.get("cache_write_tokens"),
        "seconds": elapsed(result.get("agent_execution")),
    }


def lite_metrics(folder: Path) -> dict[str, dict]:
    try:
        lines = (folder / "predictions.jsonl").read_text().splitlines()
    except OSError:
        return {}
    return {d["instance_id"]: {k: d.get(k) for k in METRICS} for d in map(json.loads, filter(None, lines))}


def run_metrics(scores: dict) -> dict:
    out = {}
    for k in METRICS:
        values = [m[k] for s in scores.values() for m in s["metrics"].values() if m and m.get(k) is not None]
        out[k] = {"total": sum(values) if values else None, "median": statistics.median(values) if values else None}
    return out


def lite_outcomes(folder: Path, tasks: list[str]) -> dict[str, tuple[bool, str]]:
    resolved: set[str] = set()
    empty: set[str] = set()
    unresolved: set[str] = set()
    errored: set[str] = set()
    found = False
    try:
        timed_out = {d["instance_id"] for d in map(json.loads, (folder / "predictions.jsonl").read_text().splitlines()) if d.get("status") == "timeout"}
    except OSError:
        timed_out = set()
    for f in glob.glob(str(folder / "*.json")):
        try:
            d = json.loads(Path(f).read_text())
        except (OSError, ValueError):
            continue
        if "resolved_ids" in d:
            found = True
            resolved |= set(d["resolved_ids"])
            empty |= set(d.get("empty_patch_ids", []))
            unresolved |= set(d.get("unresolved_ids", []))
            errored |= set(d.get("error_ids", []))
    if not found:
        return {}
    outcomes = {}
    for t in tasks:
        if t in resolved:
            outcomes[t] = (True, "passed")
        elif t in timed_out:
            outcomes[t] = (False, "task-time-limit")
        elif t in empty or t in unresolved:
            outcomes[t] = (False, agent_reason(folder / t / "keel.txt") or ("no-patch" if t in empty else "wrong-answer"))
        else:
            outcomes[t] = (False, "environment" if t in errored else "not-run")
    return outcomes


def summarize_run(run_dir: Path) -> dict:
    manifest = json.loads((run_dir / "manifest.json").read_text())
    scores = {}
    for key, title in BENCHMARKS:
        tasks = [t.split("/")[-1] for t in manifest["subsets"].get(key, [])]
        folder = run_dir / key
        if key == "swebench-lite":
            outcomes, metrics = lite_outcomes(folder, tasks), lite_metrics(folder)
        else:
            outcomes = harbor_outcomes(folder)
            metrics = {name: harbor_metrics(result) for name, (result, _) in harbor_latest(folder).items()}
        results = {t: outcomes[t] for t in tasks if t in outcomes}
        scores[key] = {
            "title": title,
            "passed": sum(passed for passed, _ in results.values()),
            "total": len(tasks),
            "finished": len(results),
            "tasks": {t: results[t][0] if t in results else None for t in tasks},
            "reasons": {t: results[t][1] if t in results else None for t in tasks},
            "metrics": {t: metrics.get(t) for t in tasks},
        }
    return {
        "run": manifest["run"],
        "trial": run_dir.parent.name,
        "model": manifest["model"],
        "model_name": manifest.get("model_name") or manifest["model"].split("/", 1)[-1],
        "harness": manifest.get("harness", "baseline"),
        "effort": manifest.get("effort", "default"),
        "started": manifest["started"],
        "keel_commit": manifest["keel_commit"],
        "scores": scores,
        "metrics": run_metrics(scores),
    }


def describe(run: dict) -> tuple[str, str, str]:
    family, name = MODELS.get(run["model"], ("Other", run["model_name"]))
    prefix, _, rest = run["model"].partition("/")
    return family, name, HOSTS.get(prefix, prefix) if rest else ""


def rank(values: list[str], value: str) -> int:
    return values.index(value) if value in values else len(values)


def run_key(run: dict) -> tuple:
    family, name, host = describe(run)
    harness, effort = run["harness"], run["effort"]
    return (rank(FAMILIES, family), rank(NAMES, name), name, host, rank(list(HARNESSES), harness), harness, rank(EFFORTS, effort), effort)


def total(run: dict) -> int:
    return sum(s["passed"] for s in run["scores"].values())


def size(run: dict) -> int:
    return sum(s["total"] for s in run["scores"].values())


def by_model(runs: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = {}
    for r in sorted(runs, key=run_key):
        groups.setdefault(r["model"], []).append(r)
    return groups


def labels(runs: list[dict]) -> dict[str, str]:
    hosts = collections.defaultdict(set)
    for r in runs:
        _, name, host = describe(r)
        hosts[name].add(host)
    out = {}
    for r in runs:
        _, name, host = describe(r)
        out[r["model"]] = f"{name} ({host})" if len(hosts[name]) > 1 else name
    return out


def best(runs: list[dict]) -> dict[str, dict]:
    return {m: max(rs, key=total) for m, rs in by_model(runs).items()}


def harness_pairs(runs: list[dict]) -> dict[str, tuple[dict, dict]]:
    pairs = {}
    for m, rs in by_model(runs).items():
        found = {r["harness"]: r for r in rs if r["effort"] == "default"}
        if "baseline" in found and "native-tools" in found:
            pairs[m] = (found["baseline"], found["native-tools"])
    return pairs


def effort_pairs(runs: list[dict], harness: str) -> dict[str, tuple[dict, dict]]:
    pairs = {}
    for m, rs in by_model(runs).items():
        rs = [r for r in rs if r["harness"] == harness]
        higher = [r for r in rs if r["effort"] in EFFORTS and rank(EFFORTS, r["effort"]) > rank(EFFORTS, "default")]
        default = next((r for r in rs if r["effort"] == "default"), None)
        if default and higher:
            pairs[m] = (default, higher[-1])
    return pairs


def fold(run: dict) -> collections.Counter:
    n: collections.Counter = collections.Counter()
    for s in run["scores"].values():
        for reason in s["reasons"].values():
            if reason:
                n[next((label for label, reasons in CATEGORIES if reason in reasons), CATEGORIES[-1][0])] += 1
    return n


def columns(run: dict) -> str:
    _, name, host = describe(run)
    return f"| {name} | {host} | {HARNESSES.get(run['harness'], run['harness'])} | {run['effort']} |"


def table(runs: list[dict]) -> str:
    head = "| Model | Host | Harness | Effort | " + " | ".join(t for _, t in BENCHMARKS) + " | Total |\n"
    head += "|---|---|---|---|" + "---|" * (len(BENCHMARKS) + 1) + "\n"
    lines = []
    for r in sorted(runs, key=run_key):
        cells = []
        for key, _ in BENCHMARKS:
            s = r["scores"][key]
            cells.append("—" if not s["total"] else f"{s['passed']}/{s['total']}" if s["finished"] == s["total"] else f"{s['passed']}/{s['total']} ({s['finished']} done)" if s["finished"] else "pending")
        cells.append(f"{total(r)}/{sum(s['total'] for s in r['scores'].values())}")
        lines.append(columns(r) + " " + " | ".join(cells) + " |")
    return head + "\n".join(lines) + "\n"


def failures(runs: list[dict]) -> str:
    lines = ["| Model | Host | Harness | Effort | Passed | Why the rest failed |", "|---|---|---|---|---|---|"]
    for r in sorted(runs, key=run_key):
        n = collections.Counter(reason for s in r["scores"].values() for reason in s["reasons"].values() if reason)
        rest = sorted((c for c in n if c != "passed"), key=lambda c: (-n[c], rank(REASONS, c), c))
        lines.append(columns(r) + f" {n['passed']} | " + " · ".join(f"`{c}` {n[c]}" for c in rest) + " |")
    return "\n".join(lines) + "\n"


def tokens(n: float | None) -> str:
    if n is None:
        return "—"
    return f"{n / 1e6:.1f}M" if n >= 1e6 else f"{n / 1e3:.0f}k" if n >= 1e3 else f"{n:.0f}"


def usage_table(runs: list[dict]) -> str:
    lines = [
        "| Model | Host | Harness | Effort | Steps | Input tokens | Cache read | Cache write | Output tokens | Hours | Median minutes |",
        "|---|---|---|---|---|---|---|---|---|---|---|",
    ]
    for r in sorted(runs, key=run_key):
        m = {k: (r.get("metrics") or {}).get(k) or {} for k in METRICS}
        steps, hours, median = m["steps"].get("total"), m["seconds"].get("total"), m["seconds"].get("median")
        cells = [
            "—" if steps is None else str(steps),
            *(tokens(m[k].get("total")) for k in ("input_tokens", "cache_read_tokens", "cache_write_tokens", "output_tokens")),
            "—" if hours is None else f"{hours / 3600:.1f}",
            "—" if median is None else f"{median / 60:.1f}",
        ]
        lines.append(columns(r) + " " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def svg(label: str, height: float, body: list[str]) -> str:
    head = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {height:g}" role="img" aria-label="{label}"><style>{CSS}</style>'
    return "\n".join([head, *body, "</svg>"]) + "\n"


def bar(x: float, y: float, w: float, color: str, end: bool = True, h: float = 12) -> str:
    r = min(4, w) if end else 0
    return f'<path d="M{x:g} {y:g}H{x + w - r:g}a{r:g} 4 0 0 1 {r:g} 4v{h - 8:g}a{r:g} 4 0 0 1 -{r:g} 4H{x:g}Z" fill="{color}"/>'


def dot(x: float, y: float, solid: bool) -> str:
    if solid:
        return f'<circle cx="{x:g}" cy="{y:g}" r="5" fill="{TEAL}" stroke="var(--bg)" stroke-width="2"/>'
    return f'<circle cx="{x:g}" cy="{y:g}" r="4" fill="var(--bg)" stroke="{TEAL}" stroke-width="2"/>'


def legend(items: list[tuple[str, str]]) -> list[str]:
    out, x = [], 0.0
    for kind, text in items:
        if kind in ("hollow", "solid"):
            out.append(dot(x + 6, 12, kind == "solid"))
        else:
            out.append(f'<rect x="{x:g}" y="6" width="12" height="12" rx="2" fill="{kind}"/>')
        out.append(f'<text x="{x + 18:g}" y="17">{text}</text>')
        x += 40 + 7.6 * len(text)
    return out


def plot(runs: list[dict], models: list[str], panels: list[tuple[float, float, str, str]], mark, scale: int, top: float) -> tuple[list[str], float]:
    names = labels(runs)
    body, y, last = [], top, None
    for m in models:
        family = MODELS.get(m, ("Other",))[0]
        if family != last:
            if last is not None:
                y += GAP
            body.append(f'<text x="0" y="{y + 18:g}" class="bold">{family}</text>')
            last = family
        body.append(f'<text x="{LABEL_W - 12}" y="{y + 18:g}" text-anchor="end">{escape(names[m])}</text>')
        for i, (x, w, _, _) in enumerate(panels):
            body += mark(m, i, x, w, y)
        y += ROW
    grid = []
    for x, w, title, note in panels:
        if title:
            grid.append(f'<text x="{x:g}" y="{top - 12:g}" class="bold">{title}</text>')
        if note:
            grid.append(f'<text x="{x + w + 16:g}" y="{top - 12:g}" class="muted small">{note}</text>')
        for t in range(0, scale + 1, 10):
            gx = x + w * t / scale
            grid.append(f'<line x1="{gx:g}" x2="{gx:g}" y1="{top - 4:g}" y2="{y + 4:g}" stroke="var(--grid)"/>')
            grid.append(f'<text x="{gx:g}" y="{y + 20:g}" text-anchor="middle" class="muted small">{t}</text>')
    return grid + body, y + 28


def scale_of(runs: list[dict]) -> int:
    return max(map(size, runs), default=0) or 1


def leaderboard(runs: list[dict]) -> str:
    top, scale = best(runs), scale_of(runs)

    def mark(m: str, _: int, x: float, w: float, y: float) -> list[str]:
        r = top[m]
        bw = w * total(r) / scale
        tail = escape(f"{HARNESSES.get(r['harness'], r['harness'])} · {r['effort']}")
        return [bar(x, y + 7, bw, TEAL), f'<text x="{x + bw + 8:g}" y="{y + 18:g}">{total(r)}/{size(r)} <tspan class="muted">· {tail}</tspan></text>']

    body, height = plot(runs, list(top), [(LABEL_W, 440, "", "")], mark, scale, 8)
    return svg("Best score per model, out of all its runs", height, body)


def dumbbell(x: float, w: float, y: float, a: int, b: int, scale: int, note: str) -> list[str]:
    xa, xb = x + w * a / scale, x + w * b / scale
    return [
        f'<line x1="{xa:g}" x2="{xb:g}" y1="{y + 13:g}" y2="{y + 13:g}" stroke="var(--muted)" stroke-width="2"/>',
        dot(xa, y + 13, False),
        dot(xb, y + 13, True),
        f'<text x="{x + w + 16:g}" y="{y + 18:g}">{a} → {b}{note}</text>',
    ]


def native_chart(runs: list[dict]) -> str:
    pairs, scale = harness_pairs(runs), scale_of(runs)

    def mark(m: str, _: int, x: float, w: float, y: float) -> list[str]:
        text, native = pairs[m]
        return dumbbell(x, w, y, total(text), total(native), scale, "")

    body, height = plot(runs, list(pairs), [(LABEL_W, 480, "", "text → native")], mark, scale, 56)
    items = [("hollow", "Text harness"), ("solid", "Native tools")]
    return svg(f"Tasks passed out of {scale} with the text harness and with native tools, at default effort", height, legend(items) + body)


def effort_chart(runs: list[dict]) -> str:
    panels = [effort_pairs(runs, "baseline"), effort_pairs(runs, "native-tools")]
    scale = scale_of(runs)
    models = [m for m in by_model(runs) if any(m in p for p in panels)]

    def mark(m: str, i: int, x: float, w: float, y: float) -> list[str]:
        if m not in panels[i]:
            return [f'<text x="{x + w + 16:g}" y="{y + 18:g}" class="muted">no run</text>']
        default, higher = panels[i][m]
        return dumbbell(x, w, y, total(default), total(higher), scale, f' <tspan class="muted">{escape(higher["effort"])}</tspan>')

    frame = [(LABEL_W, 180, "Text harness", "default → higher"), (LABEL_W + 300, 180, "Native tools", "default → higher")]
    body, height = plot(runs, models, frame, mark, scale, 56)
    items = [("hollow", "Default effort"), ("solid", "Highest effort, with its level after the numbers")]
    return svg(f"Tasks passed out of {scale} at default effort and at the highest effort run, per harness", height, legend(items) + body)


def failures_chart(runs: list[dict]) -> str:
    harnesses = list(HARNESSES)
    found = {(r["model"], r["harness"]): r for r in runs if r["effort"] == "default" and r["harness"] in harnesses}
    scale = scale_of(runs)
    models = [m for m in by_model(runs) if any((m, h) in found for h in harnesses)]

    def mark(m: str, i: int, x: float, w: float, y: float) -> list[str]:
        r = found.get((m, harnesses[i]))
        if not r:
            return [f'<text x="{x:g}" y="{y + 18:g}" class="muted">no default-effort run</text>']
        n, out, cx = fold(r), [], x
        drawn = [(label, color) for (label, _), color in zip(CATEGORIES, COLORS) if n[label]]
        for j, (label, color) in enumerate(drawn):
            sw = w * n[label] / scale
            last = j == len(drawn) - 1
            out.append(bar(cx, y + 7, sw if last else max(sw - 2, 0), color, last))
            if label == CATEGORIES[0][0] and sw >= 24:
                out.append(f'<text x="{cx + 5:g}" y="{y + 17.5:g}" class="inside">{n[label]}</text>')
            cx += sw
        return out

    frame = [(LABEL_W, 280, "Text harness", ""), (LABEL_W + 315, 280, "Native tools", "")]
    body, height = plot(runs, models, frame, mark, scale, 56)
    items = list(zip(COLORS, (label for label, _ in CATEGORIES)))
    return svg(f"How each model's {scale} tasks ended at default effort, per harness", height, legend(items) + body)


def main() -> None:
    runs = sorted(
        (summarize_run(p.parent) for p in RUNS.glob("*/*/manifest.json")),
        key=lambda r: (r["started"], r["run"]),
    )
    runs = [r for r in runs if any(s["finished"] for s in r["scores"].values())]
    (RUNS / "results.json").write_text(json.dumps(runs, indent=2) + "\n")
    (RUNS / "scoreboard.md").write_text(table(runs))
    (RUNS / "failures.md").write_text(failures(runs))
    (RUNS / "usage.md").write_text(usage_table(runs))
    charts = ROOT / "docs" / "assets" / "charts"
    charts.mkdir(parents=True, exist_ok=True)
    done = [r for r in runs if all(s["finished"] == s["total"] for s in r["scores"].values())]
    (charts / "leaderboard.svg").write_text(leaderboard(done))
    (charts / "native-tools.svg").write_text(native_chart(done))
    (charts / "effort.svg").write_text(effort_chart(done))
    (charts / "failures.svg").write_text(failures_chart(done))
    print(table(runs))


if __name__ == "__main__":
    main()
