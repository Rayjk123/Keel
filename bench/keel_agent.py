import os
import shlex
from pathlib import Path
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.agents.installed.node_install import nvm_node_install_snippet
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

AGENT_SOURCE = Path(__file__).resolve().parent.parent / "agent.ts"
REMOTE_AGENT_PATH = "/tmp/keel/agent.ts"
DEFAULT_BASE_URL = "http://host.docker.internal:11434/v1"
LOAD_NVM = '. "$HOME/.nvm/nvm.sh"'


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
        await environment.upload_file(AGENT_SOURCE, REMOTE_AGENT_PATH)

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        pass

    @override
    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment, context: AgentContext) -> None:
        if not self.model_name:
            raise ValueError("pass a model, e.g. -m ollama/qwen3-coder:30b")
        env = {
            "BASE_URL": os.environ.get("KEEL_BASE_URL", DEFAULT_BASE_URL),
            "MODEL": self.model_name.split("/", 1)[-1],
        }
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
