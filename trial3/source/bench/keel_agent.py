import json
import os
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

ROOT = Path(__file__).resolve().parent.parent
SOURCES = ("agent.ts", "tools.ts")
REMOTE_DIR = "/tmp/keel"
REMOTE_AGENT_PATH = f"{REMOTE_DIR}/agent.ts"
DEFAULT_BASE_URL = "http://host.docker.internal:11434/v1"
LOAD_NVM = '. "$HOME/.nvm/nvm.sh"'
USAGE_FILE = "usage.json"


class KeelAgent(BaseInstalledAgent):
    @staticmethod
    @override
    def name() -> str:
        return "keel"

    @override
    def get_version_command(self) -> str | None:
        return f"{LOAD_NVM}; node --version"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.ensure_system_dependencies(environment, ("curl",))
        await self.exec_as_agent(environment, command=f"set -euo pipefail; {nvm_node_install_snippet()}")

    @override
    async def configure(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(environment, command="mkdir -p /tmp/keel && chmod 777 /tmp/keel")
        for name in SOURCES:
            await environment.upload_file(ROOT / name, f"{REMOTE_DIR}/{name}")

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        try:
            usage = json.loads((self.logs_dir / USAGE_FILE).read_text())
        except (OSError, ValueError):
            return
        context.n_input_tokens = usage.get("input_tokens")
        context.n_cache_tokens = usage.get("cache_read_tokens")
        context.n_output_tokens = usage.get("output_tokens")
        context.metadata = {"steps": usage.get("steps"), "cache_write_tokens": usage.get("cache_write_tokens")}

    @override
    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not self.model_name:
            raise ValueError("pass a model, e.g. -m ollama/qwen3-coder:30b")
        env = {
            "BASE_URL": os.environ.get("KEEL_BASE_URL", DEFAULT_BASE_URL),
            "MODEL": self.model_name.split("/", 1)[-1],
            "ADAPTER": os.environ.get("KEEL_ADAPTER", "native"),
            "USAGE_FILE": f"/logs/agent/{USAGE_FILE}",
        }
        if os.environ.get("KEEL_API_KEY"):
            env["API_KEY"] = os.environ["KEEL_API_KEY"]
        if os.environ.get("KEEL_MAX_STEPS"):
            env["MAX_STEPS"] = os.environ["KEEL_MAX_STEPS"]
        if os.environ.get("KEEL_EFFORT"):
            env["EFFORT"] = os.environ["KEEL_EFFORT"]
        await self.exec_as_agent(
            environment,
            command=(
                f"{LOAD_NVM}; "
                f"node {REMOTE_AGENT_PATH} {shlex.quote(instruction)} "
                "2>&1 | tee /logs/agent/keel.txt"
            ),
            env=env,
        )
