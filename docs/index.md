<p align="center">
  <img src="assets/banner.svg" alt="Keel: learning by building, one port at a time" style="height: 10em" />
</p>

# Keel

**Learning by building, one port at a time.**

Keel is my learning log, written in code. Each destination is something I wanted to understand properly, so I built it myself, measured how well it worked, wrote down what I learned, and then sailed on to the next one.

The pages here follow that journey in order, a bit like a changelog for what I've learned. Every destination has its own code, its own write-up, and a way to run it yourself.

## The journey

### Destination 1: One-file agent
*November 2026*

**Built:** a coding agent in a single TypeScript file of about 200 lines. It has no SDK and no dependencies. It runs on local models through Ollama, hosted APIs, or AWS Bedrock, and it plugs into Terminal-Bench, SWE-bench and Aider Polyglot so you can put a score on every change.

**Learned:**

- Asking the model for one fenced `bash` block in plain text worked on every reply. Native tool calling through Ollama dropped about a third to a half of replies, because the model sometimes left out the opening tag.
- The client library wasn't the cause. A Python version that used LiteLLM sent the same request and hit the same failures.
- A harness this small can run real benchmarks. The Harbor adapter is about 60 lines.
- Other minimal agents lean on a prompt that spells out a workflow: explore, reproduce the bug, edit, verify. That's an easy place to experiment next.

[Read the full destination :material-arrow-right:](destinations/one-file-agent/index.md){ .md-button }

### Next port

Not decided yet. When I pick the next topic, it gets its own tab at the top of this site.
