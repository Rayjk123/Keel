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
python3 -m unittest discover -s bench -p "test_*.py"
```

The tests run the real agent loop against a scripted fake model, so they finish in under a second and need no model or network. They cover both adapters, finishing a task, step limits, retries, every tool and its error messages, the patch format, and the Bedrock translation. The Python tests check how `bench/summarize.py` decides why each benchmark task failed.

The type check and the TypeScript tests also run on every push and pull request through GitHub Actions.

## Project layout

```
agent.ts                the loop and the two adapters
tools.ts                bash, read, write, edit and patch
test/                   tests for the loop, adapters, tools and Bedrock proxy
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
