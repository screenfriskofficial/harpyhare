import { describe, expect, it } from "vitest";
import type { PreparedPrompt } from "./chats";
import { EMPTY_LIBRARY } from "./context-library";
import { chatKeyterms } from "./keywords";
import {
  chatPipelines,
  currentPreparedPrompt,
  pipelineKeytermSources,
  promptPipelineContext,
} from "./pipeline-keyterms";
import { createPipeline, updatePipelineNode } from "./pipelines";

const GO_PRESET = {
  id: "go",
  name: "Go",
  text: "Ты — Go-разработчик.\n[keywords]: [goroutine, channel]",
};
const OPTIONS = { thinking: false, webSearch: false };

function promptPipelineWith(text: string) {
  const pipeline = createPipeline("prompt", "Подготовка");
  const source = pipeline.nodes.find((node) => node.kind === "text");
  if (!source) throw new Error("text node missing");
  return updatePipelineNode(pipeline, source.id, { text });
}

function goContext() {
  return promptPipelineContext(
    EMPTY_LIBRARY,
    [GO_PRESET],
    { presetId: "go", context: "" },
    "m",
    OPTIONS,
  );
}

describe("promptPipelineContext", () => {
  it("собирает контекст без сообщения и истории, словарю отдаёт сырые источники", () => {
    const { context, sources } = goContext();
    expect(sources).toEqual([GO_PRESET.text]);
    expect(context.message).toBeNull();
    expect(context.history).toEqual([]);
    expect(context.chatContext).not.toContain("[keywords]");
    expect(context.chatContextKeywordSources).toEqual(sources);
    expect(context.model).toBe("m");
  });
});

describe("chatPipelines", () => {
  it("находит схемы по id чата, а висячую ссылку считает отсутствием схемы", () => {
    const prompt = promptPipelineWith("x");
    const message = createPipeline("message");
    expect(
      chatPipelines([prompt, message], { promptPipelineId: prompt.id, messagePipelineId: "gone" }),
    ).toEqual({ promptPipeline: prompt, messagePipeline: undefined });
    expect(chatPipelines([prompt, message], {})).toEqual({
      promptPipeline: undefined,
      messagePipeline: undefined,
    });
  });
});

describe("currentPreparedPrompt", () => {
  it("снимок действителен только для той же схемы и того же fingerprint", () => {
    const pipeline = promptPipelineWith("x");
    const prepared: PreparedPrompt = {
      pipelineId: pipeline.id,
      fingerprint: "f",
      text: "t",
      keywordSources: [],
    };
    expect(currentPreparedPrompt(prepared, pipeline, "f")).toBe(prepared);
    expect(currentPreparedPrompt(prepared, pipeline, "g")).toBeNull();
    expect(currentPreparedPrompt(prepared, undefined, "f")).toBeNull();
    expect(currentPreparedPrompt({ ...prepared, pipelineId: "other" }, pipeline, "f")).toBeNull();
    expect(currentPreparedPrompt(undefined, pipeline, "f")).toBeNull();
  });
});

describe("pipelineKeytermSources", () => {
  it("без схем словарь берётся из пресета и контекста чата", () => {
    const sources = pipelineKeytermSources({
      ...goContext(),
      promptPipeline: undefined,
      messagePipeline: undefined,
      prepared: null,
    });
    expect(chatKeyterms(sources)).toEqual(["goroutine", "channel"]);
  });

  it("схема промпта подменяет источники чата тем, что соберёт сама", () => {
    const sources = pipelineKeytermSources({
      ...goContext(),
      promptPipeline: promptPipelineWith("[keywords]: [Kafka]"),
      messagePipeline: undefined,
      prepared: null,
    });
    expect(chatKeyterms(sources)).toEqual(["Kafka"]);
  });

  it("готовый снимок побеждает пересчёт, а схема ответа читает его как контекст чата", () => {
    const promptPipeline = promptPipelineWith("[keywords]: [Kafka]");
    const prepared: PreparedPrompt = {
      pipelineId: promptPipeline.id,
      fingerprint: "f",
      text: "готовый промпт",
      keywordSources: ["[keywords]: [Rust]"],
    };
    const base = { ...goContext(), promptPipeline, prepared };
    expect(chatKeyterms(pipelineKeytermSources({ ...base, messagePipeline: undefined }))).toEqual([
      "Rust",
    ]);
    const messagePipeline = createPipeline("message", "Ответ");
    expect(chatKeyterms(pipelineKeytermSources({ ...base, messagePipeline }))).toEqual(["Rust"]);
  });
});
