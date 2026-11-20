# Development

## Set up

```bash
git clone https://github.com/Rayjk123/Keel.git
cd Keel
nvm use
npm install
```

`npm install` only fetches TypeScript for the type check. Keel itself has no dependencies.

## Test and type-check

```bash
npm run typecheck
npm test
```

The tests run the real agent loop against a scripted fake model, so they finish in under a second and need no model or network. They cover finishing a task, step limits, bad replies, history, reply parsing and command execution.

Both commands also run on every push and pull request through GitHub Actions.

## Project layout

```
agent.ts                the whole agent
test/                   tests for the loop, adapter and command runner
bench/keel_agent.py     plugs Keel into Harbor for benchmarking
bench/swebench_lite.py  runs and grades SWE-bench Lite
bedrock/                optional proxy for AWS Bedrock
docs/                   this documentation site
```

## Preview the docs

```bash
pip install -r requirements-docs.txt
mkdocs serve
```

Then open `http://127.0.0.1:8000`.

## License

Keel is released under the [MIT License](https://github.com/Rayjk123/Keel/blob/main/LICENSE).
