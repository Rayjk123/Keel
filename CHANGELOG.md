# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed
- Reframed the project as a learning journey with the tagline "Learning by building, one port at a time". The one-file agent is Destination 1.
- Docs are organized by destination: a journey home page, then a section per destination.

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

## [0.1.0] - 2026-11-20

### Added
- `agent.ts`: a single-file coding agent that works through a bash tool over any OpenAI-compatible chat API.
- Text adapter that reads one fenced `bash` block per reply, so it works the same on every model and server.
- Canonical `Part` and `Message` types with an `Adapter` interface for supporting new APIs.
- Completion signalled by a command that prints `COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT`.
- Test suite that runs the real loop against a scripted fake model server.
- Harbor adapter (`bench/keel_agent.py`) for Terminal-Bench and SWE-bench.
- Optional AWS Bedrock proxy (`bedrock/`).
