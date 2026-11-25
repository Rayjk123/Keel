import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { converseInput, effortFields } from "../bedrock/proxy.mjs";

const request = (model: string, extra: object = {}) =>
  converseInput({ model, messages: [{ role: "user", content: "hi" }], ...extra });

describe("effortFields", () => {
  test("sends Claude models output_config.effort, with or without a profile prefix", () => {
    for (const model of ["us.anthropic.claude-opus-5-5", "global.anthropic.claude-sonnet-5-5", "anthropic.claude-haiku-5-5"]) {
      assert.deepEqual(effortFields(model, "max"), { output_config: { effort: "max" } });
    }
  });

  test("sends OpenAI models reasoning.effort", () => {
    assert.deepEqual(effortFields("us.openai.gpt-6.2-sol", "high"), { reasoning: { effort: "high" } });
  });

  test("sends Grok reasoning.effort", () => {
    assert.deepEqual(effortFields("us.xai.grok-4.7", "max"), { reasoning: { effort: "max" } });
  });

  test("sends GPT-OSS, Kimi and GLM a top-level reasoning_effort", () => {
    for (const model of ["openai.gpt-oss-120b-1:0", "moonshotai.kimi-k2.5", "zai.glm-5"]) {
      assert.deepEqual(effortFields(model, "high"), { reasoning_effort: "high" });
    }
  });

  test("rejects models it can't map", () => {
    assert.throws(() => effortFields("qwen.qwen3-coder-480b-a35b-v1:0", "high"), { name: "UnsupportedEffort" });
    assert.throws(() => effortFields("us.meta.llama4-maverick-17b-instruct-v1:0", "max"), { name: "UnsupportedEffort" });
  });
});

describe("converseInput", () => {
  test("adds no model-specific fields without reasoning_effort", () => {
    assert.equal(request("us.anthropic.claude-opus-5-5").additionalModelRequestFields, undefined);
  });

  test("puts reasoning_effort in the model's own field", () => {
    assert.deepEqual(request("us.anthropic.claude-opus-5-5", { reasoning_effort: "max" }).additionalModelRequestFields, {
      output_config: { effort: "max" },
    });
    assert.deepEqual(request("us.openai.gpt-6.2-sol", { reasoning_effort: "max" }).additionalModelRequestFields, {
      reasoning: { effort: "max" },
    });
  });

  test("rejects reasoning_effort for a model it can't map", () => {
    assert.throws(() => request("us.meta.llama4-maverick-17b-instruct-v1:0", { reasoning_effort: "max" }), {
      name: "UnsupportedEffort",
    });
  });
});
