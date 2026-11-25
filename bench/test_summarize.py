import json
import tempfile
import unittest
from pathlib import Path

from summarize import agent_reason, failures, harbor_outcomes, harbor_reason, lite_outcomes

CRASH = "TypeError: fetch failed\n    at node:internal/deps/undici\n  [cause]: {}\n\nNode.js v22.23.5\n"


class Case(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def write(self, rel: str, text: str) -> Path:
        path = self.root / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path


class AgentReason(Case):
    def reason(self, text: str) -> str | None:
        return agent_reason(self.write("keel.txt", text))

    def test_missing_log(self) -> None:
        self.assertIsNone(agent_reason(self.root / "absent.txt"))

    def test_stops(self) -> None:
        self.assertEqual(self.reason("$ ls\nstopped: no command in 3 consecutive replies\n"), "no-command")
        self.assertEqual(self.reason("$ ls\nstopped: step limit reached\n"), "step-limit")

    def test_crashes(self) -> None:
        self.assertEqual(self.reason("Error: 500 cyber_policy\n" + CRASH), "refused")
        self.assertEqual(self.reason("Output blocked by content filtering policy\n" + CRASH), "refused")
        self.assertEqual(self.reason("[cause]: HeadersTimeoutError\n" + CRASH), "request-timeout")
        self.assertEqual(self.reason("error parsing tool call\n" + CRASH), "malformed-tool-call")
        self.assertEqual(self.reason("Error: 500 internal\n" + CRASH), "model-error")

    def test_native_model_failures(self) -> None:
        failed = "stopped: the model request failed: 500 "
        self.assertEqual(self.reason(failed + '{"error":"error parsing tool call: raw=..."}\n'), "malformed-tool-call")
        self.assertEqual(self.reason(failed + "XML syntax error on line 1\n"), "malformed-tool-call")
        self.assertEqual(self.reason(failed + "TimeoutError: aborted\n"), "request-timeout")
        self.assertEqual(self.reason(failed + "Value at 'messages.4.member.content.1.member.toolUse.name' failed\n"), "malformed-tool-call")
        self.assertEqual(self.reason(failed + "This model's maximum context length is 131072 tokens\n"), "context-limit")
        self.assertEqual(self.reason(failed + "overloaded\n"), "model-error")

    def test_finished_run_ignores_error_words_in_output(self) -> None:
        self.assertIsNone(self.reason("$ grep TimeoutError app.log\ncyber_policy mentioned\nFixed the retry loop.\n"))


class HarborReason(Case):
    def trial(self, log: str | None = None) -> Path:
        trial = self.root / "task__abc"
        trial.mkdir(exist_ok=True)
        if log is not None:
            self.write("task__abc/agent/keel.txt", log)
        return trial

    def result(self, reward: float | None = None, kind: str | None = None, message: str = "") -> dict:
        exc = {"exception_type": kind, "exception_message": message} if kind else None
        return {"verifier_result": {"rewards": {"reward": reward}} if reward is not None else None, "exception_info": exc}

    def test_reward_wins(self) -> None:
        self.assertEqual(harbor_reason(self.result(1.0, "NonZeroAgentExitCodeError"), self.trial(CRASH)), "passed")

    def test_exceptions(self) -> None:
        trial = self.trial("Done.\n")
        self.assertEqual(harbor_reason(self.result(None, "ValueError", "Agent 'keel' does not support skills"), trial), "unsupported")
        self.assertEqual(harbor_reason(self.result(0.0, "AgentSafetyRefusalError"), trial), "refused")
        self.assertEqual(harbor_reason(self.result(0.0, "AgentTimeoutError"), trial), "task-time-limit")
        self.assertEqual(harbor_reason(self.result(None, "RewardFileNotFoundError"), trial), "wrong-answer")
        self.assertEqual(harbor_reason(self.result(None, "VerifierTimeoutError"), trial), "wrong-answer")
        self.assertEqual(harbor_reason(self.result(None, "RuntimeError", "Docker compose command failed"), trial), "environment")
        self.assertEqual(harbor_reason(self.result(None, "ValueError", "bad task config"), trial), "environment")

    def test_context_limit_is_a_model_failure(self) -> None:
        trial = self.trial("stopped: the model request failed: 400 prompt is too long\n")
        self.assertEqual(harbor_reason(self.result(0.0, "AgentTimeoutError"), trial), "context-limit")

    def test_model_failure_beats_task_timeout(self) -> None:
        trial = self.trial("[cause]: HeadersTimeoutError\n" + CRASH)
        self.assertEqual(harbor_reason(self.result(0.0, "AgentTimeoutError"), trial), "request-timeout")

    def test_task_timeout_beats_agent_stop(self) -> None:
        trial = self.trial("stopped: no command in 3 consecutive replies\n")
        self.assertEqual(harbor_reason(self.result(0.0, "AgentTimeoutError"), trial), "task-time-limit")

    def test_agent_stops(self) -> None:
        self.assertEqual(harbor_reason(self.result(0.0), self.trial("stopped: no command in 3 consecutive replies\n")), "no-command")
        self.assertEqual(harbor_reason(self.result(0.0), self.trial("Implemented it.\n")), "wrong-answer")

    def test_latest_result_per_task_wins(self) -> None:
        old = {**self.result(0.0), "task_name": "org/task", "finished_at": "2026-11-22T01:00:00"}
        new = {**self.result(1.0), "task_name": "org/task", "finished_at": "2026-11-22T02:00:00"}
        for first, second in ((old, new), (new, old)):
            with self.subTest(newest_listed_first=first is new), tempfile.TemporaryDirectory() as tmp:
                for folder, result in (("task__a", first), ("task__b", second)):
                    path = Path(tmp) / "job" / folder / "result.json"
                    path.parent.mkdir(parents=True)
                    path.write_text(json.dumps(result))
                self.assertEqual(harbor_outcomes(Path(tmp)), {"task": (True, "passed")})

    def test_result_one_level_deep_and_started_at_fallback(self) -> None:
        self.write("task__x/result.json", json.dumps({**self.result(1.0), "task_name": "org/early", "started_at": "2026-11-22T01:00:00"}))
        self.write("task__y/result.json", json.dumps({**self.result(1.0), "task_name": "org/undated"}))
        self.assertEqual(harbor_outcomes(self.root), {"early": (True, "passed")})


class LiteOutcomes(Case):
    TASKS = ["a", "b", "c", "d", "e", "f", "g", "h"]

    def test_reasons(self) -> None:
        self.write("keel.first.json", json.dumps({"resolved_ids": ["a"], "unresolved_ids": ["c", "f"], "empty_patch_ids": ["b"]}))
        self.write("keel.retry.json", json.dumps({"resolved_ids": [], "unresolved_ids": ["h"], "empty_patch_ids": ["d"], "error_ids": ["e"]}))
        self.write("predictions.jsonl", "".join(json.dumps({"instance_id": i, "status": "timeout"}) + "\n" for i in ("a", "f")))
        self.write("d/keel.txt", "stopped: no command in 3 consecutive replies\n")
        self.write("c/keel.txt", "Changed the parser.\n")
        self.write("h/keel.txt", "$ pytest\nstopped: step limit reached\n")
        self.assertEqual(lite_outcomes(self.root, self.TASKS), {
            "a": (True, "passed"),
            "b": (False, "no-patch"),
            "c": (False, "wrong-answer"),
            "d": (False, "no-command"),
            "e": (False, "environment"),
            "f": (False, "task-time-limit"),
            "g": (False, "not-run"),
            "h": (False, "step-limit"),
        })

    def test_no_report_yet(self) -> None:
        self.assertEqual(lite_outcomes(self.root, self.TASKS), {})


class Failures(unittest.TestCase):
    def test_row_lists_failures_most_common_first(self) -> None:
        reasons = {"t1": "passed", "t2": "refused", "t3": "no-command", "t4": "no-command", "t5": "wrong-answer", "t6": None}
        run = {"run": "m", "scores": {"x": {"reasons": reasons}}}
        self.assertEqual(failures([run]).splitlines()[2], "| m | 1 | `no-command` 2 · `wrong-answer` 1 · `refused` 1 |")


if __name__ == "__main__":
    unittest.main()
