# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Native tool calling, now the default: Keel sends its tools in the request and reads structured `tool_calls`, with several calls allowed per reply. `ADAPTER=text` keeps the original fenced-block mode.
- Five tools in `tools.ts`: `bash` (with an optional timeout), `read` (numbered lines with paging), `write`, `edit` (exact replace with forgiving whitespace matching) and `patch` (Codex-style multi-file patches that apply all at once).
- `write`, `edit` and `patch` only change files the model has read, and refuse a file that changed since it was read.
- Clear tool errors, including the closest matching line when an edit misses and a note when a change looks already applied.
- Retries when the model server fails, and a clean stop instead of a crash when it keeps failing.
- Tool calling through the Bedrock proxy, with the translation in `bedrock/convert.ts`.
- `KEEL_API_KEY` passes an API key to benchmark runs, so Keel can be benchmarked through OpenRouter and other hosted APIs. Harbor keeps the key out of its logs.
- `KEEL_ADAPTER` and `KEEL_MAX_STEPS` for benchmark runs. Runs record their adapter, and `bench/baseline.sh` labels native runs `native-tools`.
- Tests for both adapters, every tool, the patch format and the Bedrock translation.

### Changed
- In native mode a task ends when the model replies without a tool call and confirms once, instead of running a completion command.
- Long command output keeps its start and its end.
- The docs now live at https://keeljourney.dev.
- Reframed the project as a learning journey with the tagline "Learning by building, one port at a time". The one-file agent is Destination 1.
- Docs are organized by destination: a journey home page, then a section per destination.
- `bench/baseline.sh` needs `MODELS`, and `bench/setup.sh` pulls only the Ollama models it lists.

### Added
- MIT license.
- GitHub Actions workflow that type-checks and tests every push and pull request.
- `npm run typecheck`, powered by TypeScript.
- `.nvmrc` pinning Node 22.18.0.
- Package metadata: description, repository, keywords and license.
- Documentation site built with MkDocs Material and published to GitHub Pages.
- `bench/swebench_lite.py`: runs Keel on SWE-bench Lite and grades the patches, with resumable runs and automatic Node download.
- Benchmark instructions for Terminal-Bench 4.0 and Aider Polyglot through Harbor.
- Logo and banner, and a README header with badges.
- `PROXY_HOST` for the Bedrock proxy, so benchmark containers on Linux can reach it.

### Fixed
- Keel no longer fails with `other side closed` when a command outlasts the model server's keep-alive timeout, as with the Bedrock proxy or vLLM.
- `bench/setup.sh` and `bench/baseline.sh` work on Linux, and `bench/swebench_lite.py` uses `KEEL_BASE_URL` like the Harbor runs.

## [0.1.0] - 2026-11-20

### Added
- `agent.ts`: a single-file coding agent that works through a bash tool over any OpenAI-compatible chat API.
- Text adapter that reads one fenced `bash` block per reply, so it works the same on every model and server.
- Canonical `Part` and `Message` types with an `Adapter` interface for supporting new APIs.
- Completion signalled by a command that prints `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`.
- Test suite that runs the real loop against a scripted fake model server.
- Harbor adapter (`bench/keel_agent.py`) for Terminal-Bench and SWE-bench.
- Optional AWS Bedrock proxy (`bedrock/`).
