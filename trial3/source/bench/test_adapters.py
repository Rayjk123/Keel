import asyncio
import json
import subprocess
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock

USAGE = {"steps": 3, "input_tokens": 900, "output_tokens": 40, "cache_read_tokens": 600, "cache_write_tokens": 200}


class FakeAgent:
    async def exec_as_agent(self, environment, command, env=None):
        self.calls.append((command, env))


def stub(name: str, **attrs) -> types.ModuleType:
    module = types.ModuleType(name)
    module.__dict__.update(attrs)
    return module


HARBOR = {
    "harbor": stub("harbor"),
    "harbor.agents": stub("harbor.agents"),
    "harbor.agents.installed": stub("harbor.agents.installed"),
    "harbor.agents.installed.base": stub("harbor.agents.installed.base", BaseInstalledAgent=FakeAgent, with_prompt_template=lambda f: f),
    "harbor.agents.installed.node_install": stub("harbor.agents.installed.node_install", nvm_node_install_snippet=lambda: ""),
    "harbor.environments": stub("harbor.environments"),
    "harbor.environments.base": stub("harbor.environments.base", BaseEnvironment=object),
    "harbor.models": stub("harbor.models"),
    "harbor.models.agent": stub("harbor.models.agent"),
    "harbor.models.agent.context": stub("harbor.models.agent.context", AgentContext=types.SimpleNamespace),
}

with mock.patch.dict(sys.modules, HARBOR):
    sys.modules.pop("keel_agent", None)
    import keel_agent

with mock.patch.dict(sys.modules, {"datasets": stub("datasets", load_dataset=None)}):
    sys.modules.pop("swebench_lite", None)
    import swebench_lite


class KeelAgentUsage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.agent = keel_agent.KeelAgent()
        self.agent.logs_dir = Path(self.tmp.name)
        self.agent.model_name = "bedrock/us.anthropic.claude-haiku-5-5"
        self.agent.calls = []
        self.context = types.SimpleNamespace(n_input_tokens=None, n_cache_tokens=None, n_output_tokens=None, metadata=None)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_keel_writes_usage_to_the_logs_folder(self) -> None:
        asyncio.run(self.agent.run("task", None, self.context))
        command, env = self.agent.calls[0]
        self.assertEqual(env["USAGE_FILE"], "/logs/agent/usage.json")
        self.assertIn("tee /logs/agent/keel.txt", command)

    def test_usage_fills_the_agent_result(self) -> None:
        (self.agent.logs_dir / "usage.json").write_text(json.dumps(USAGE))
        self.agent.populate_context_post_run(self.context)
        self.assertEqual(vars(self.context), {
            "n_input_tokens": 900,
            "n_cache_tokens": 600,
            "n_output_tokens": 40,
            "metadata": {"steps": 3, "cache_write_tokens": 200},
        })

    def test_no_usage_file_leaves_the_agent_result_empty(self) -> None:
        self.agent.populate_context_post_run(self.context)
        (self.agent.logs_dir / "usage.json").write_text("{trunc")
        self.agent.populate_context_post_run(self.context)
        self.assertEqual(set(vars(self.context).values()), {None})


class SwebenchUsage(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def solve(self, usage: dict | None) -> tuple[dict, list[str]]:
        seen: list[str] = []

        def docker(args, **_):
            seen.extend(args)
            mount = Path(next(a for a in args if a.endswith(":/out")).rsplit(":", 1)[0])
            if usage is not None:
                (mount / "usage.json").write_text(json.dumps(usage))
            return subprocess.CompletedProcess(args, 0, "", "")

        row = {"instance_id": "repo__x-1", "problem_statement": "bug", "image": "img"}
        with mock.patch.object(swebench_lite.subprocess, "run", docker):
            return swebench_lite.solve(row, self.out, "r", "m", "http://h/v1", 60), seen

    def test_records_usage_next_to_the_time(self) -> None:
        result, args = self.solve(USAGE)
        self.assertIn("USAGE_FILE=/out/usage.json", args)
        self.assertEqual({k: result[k] for k in (*USAGE, "status")}, {**USAGE, "status": "ok"})
        self.assertIsInstance(result["seconds"], int)

    def test_a_stale_usage_file_is_not_reused(self) -> None:
        (self.out / "repo__x-1").mkdir()
        (self.out / "repo__x-1" / "usage.json").write_text(json.dumps(USAGE))
        result, _ = self.solve(None)
        self.assertEqual({k: result[k] for k in USAGE}, dict.fromkeys(USAGE))


if __name__ == "__main__":
    unittest.main()
