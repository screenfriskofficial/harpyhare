import { act, cleanup, renderHook } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/ipc/types";
import { createChat, type Chat, type ChatPatch, type RequestOptions } from "@/lib/chats";
import { EMPTY_LIBRARY, type ContextLibrary } from "@/lib/context-library";
import type { Pipeline, PipelineInput } from "@/lib/pipeline-types";
import {
  connectPipelineNodes,
  createPipeline,
  createPipelineNode,
  semanticPipelineFingerprint,
} from "@/lib/pipelines";
import type { PromptPreset } from "@/lib/presets";
import { deferred, required } from "@/test-utils/async";
import { pipelineInputFixture } from "@/test-utils/pipeline-fixtures";
import type { ChatsApi } from "./useChats";
import type { ClaudeStreams } from "./useClaudeStream";
import type { PipelinesApi } from "./usePipelines";
import { usePipelineStreams } from "./usePipelineStreams";

const native = vi.hoisted(() => ({
  runPipelineStep:
    vi.fn<
      (
        runId: string,
        nodeId: string,
        messages: ChatMessageDto[],
        system: string,
        model: string,
        options: RequestOptions,
      ) => Promise<string>
    >(),
  cancelPipelineRun: vi.fn<(runId: string) => Promise<void>>(),
}));

vi.mock("@/ipc/commands", () => native);
const toasts = vi.hoisted(() => ({
  notify: vi.fn<(input: { variant?: string; title?: string; message: string }) => void>(),
}));
vi.mock("@/lib/notify", () => toasts);

const OPTIONS: RequestOptions = { thinking: false, webSearch: false };
const MODEL = "selected-model";
const SYSTEM = "chat instructions";

function messages(text = "new question"): ChatMessageDto[] {
  return [
    { role: "user", text: "previous question", images: [] },
    { role: "assistant", text: "previous answer", images: [] },
    { role: "user", text, images: [{ media_type: "image/png", data: "screenshot" }] },
  ];
}

function makePrompt(id = "prepare"): Pipeline {
  let pipeline: Pipeline = { ...createPipeline("prompt", "Prepare context"), id };
  const source = required(pipeline.nodes.find((node) => node.kind === "text"));
  source.text = "source material [keywords]: [Kafka]";
  const output = required(pipeline.nodes.find((node) => node.kind === "output"));
  const model = createPipelineNode("llm", { text: "Prepare a system prompt", name: "Preparation" });
  pipeline = { ...pipeline, nodes: [...pipeline.nodes, model], edges: [] };
  pipeline = connectPipelineNodes(pipeline, { source: source.id, target: model.id });
  return connectPipelineNodes(pipeline, { source: model.id, target: output.id });
}

function makeMessage(id = "answer", postprocess = false): Pipeline {
  let pipeline: Pipeline = { ...createPipeline("message", "Answer message"), id };
  if (!postprocess) return pipeline;
  const answer = required(pipeline.nodes.find((node) => node.kind === "llm"));
  const output = required(pipeline.nodes.find((node) => node.kind === "output"));
  const polish = createPipelineNode("llm", { text: "Polish the answer", name: "Polish" });
  pipeline = {
    ...pipeline,
    nodes: [...pipeline.nodes, polish],
    edges: pipeline.edges.filter((edge) => edge.target !== output.id),
  };
  pipeline = connectPipelineNodes(pipeline, { source: answer.id, target: polish.id });
  return connectPipelineNodes(pipeline, { source: polish.id, target: output.id });
}

function setup(definitions: Pipeline[], patch: Partial<Chat> = {}) {
  const first = { ...createChat(1, "A"), ...patch };
  const second = { ...createChat(2, "B"), ...patch };
  const chatsRef = {
    current: { chats: [first, second], activeId: "A", active: first },
  } as RefObject<ChatsApi>;
  const patchChat = vi.fn((id: string, fields: ChatPatch) => {
    const chats = chatsRef.current.chats.map((chat) =>
      chat.id === id ? { ...chat, ...fields } : chat,
    );
    chatsRef.current = {
      ...chatsRef.current,
      chats,
      active: required(chats.find((chat) => chat.id === chatsRef.current.activeId)),
    };
  });
  chatsRef.current.patchChat = patchChat;
  const legacy: ClaudeStreams = {
    partial: {},
    streaming: {},
    startedAt: {},
    error: {},
    send: vi.fn<ClaudeStreams["send"]>().mockResolvedValue(),
    stop: vi.fn(),
    discard: vi.fn(),
    isStreaming: vi.fn().mockReturnValue(false),
  };
  const pipelines: PipelinesApi = {
    library: { version: 1, pipelines: definitions },
    loaded: true,
    error: null,
    put: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  const libraryRef: RefObject<ContextLibrary> = { current: EMPTY_LIBRARY };
  const presetsRef: RefObject<PromptPreset[]> = { current: [] };
  const complete = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() =>
    usePipelineStreams(legacy, pipelines, chatsRef, libraryRef, presetsRef, complete, onError),
  );
  const send = (id = "A", turns = messages(), system = SYSTEM) =>
    hook.result.current.stream.send(id, turns, system, MODEL, OPTIONS);
  const input = (turns = messages()): PipelineInput =>
    pipelineInputFixture({
      library: libraryRef.current,
      presets: presetsRef.current,
      message: turns.at(-1) ?? null,
      history: turns.slice(0, -1),
      chatContext: SYSTEM,
      model: MODEL,
      options: OPTIONS,
    });
  return {
    ...hook,
    chatsRef,
    patchChat,
    legacy,
    pipelines,
    libraryRef,
    presetsRef,
    complete,
    onError,
    send,
    input,
  };
}

beforeEach(() => {
  native.runPipelineStep.mockReset().mockResolvedValue("generated result");
  native.cancelPipelineRun.mockReset().mockResolvedValue();
  toasts.notify.mockReset();
});
afterEach(cleanup);

describe("usePipelineStreams", () => {
  it("preserves legacy streaming when no pipeline is selected", async () => {
    const harness = setup([]);
    const turns = messages();
    await act(async () => harness.send("A", turns));
    expect(harness.legacy.send).toHaveBeenCalledExactlyOnceWith("A", turns, SYSTEM, MODEL, OPTIONS);
    expect(native.runPipelineStep).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it("maps simultaneous runs to their chat snapshots even after the active chat changes", async () => {
    const pipeline = makeMessage();
    const a = deferred<string>();
    const b = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    const aTurns = messages("A question");
    const bTurns = messages("B question");
    let sendA!: Promise<void>;
    let sendB!: Promise<void>;
    act(() => {
      sendA = harness.send("A", aTurns, "A system");
      harness.chatsRef.current = {
        ...harness.chatsRef.current,
        activeId: "B",
        active: required(harness.chatsRef.current.chats[1]),
      };
      sendB = harness.send("B", bTurns, "B system");
    });
    expect(native.runPipelineStep).toHaveBeenCalledTimes(2);
    const first = required(native.runPipelineStep.mock.calls[0]);
    const second = required(native.runPipelineStep.mock.calls[1]);
    expect(first[0]).not.toBe(second[0]);
    expect(first.slice(2)).toEqual([aTurns, "A system", MODEL, OPTIONS]);
    expect(second.slice(2)).toEqual([bTurns, "B system", MODEL, OPTIONS]);
    await act(async () => {
      b.resolve("B answer");
      await sendB;
    });
    expect(harness.complete).toHaveBeenCalledExactlyOnceWith("B", "B answer");
    expect(harness.result.current.stream.isStreaming("A")).toBe(true);
    await act(async () => {
      a.resolve("A answer");
      await sendA;
    });
    expect(harness.complete.mock.calls).toEqual([
      ["B", "B answer"],
      ["A", "A answer"],
    ]);
    expect(harness.legacy.send).not.toHaveBeenCalled();
  });

  it("gates duplicate sends synchronously before React has rerendered", async () => {
    const pipeline = makeMessage();
    const answer = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(answer.promise);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    let first!: Promise<void>;
    let duplicate!: Promise<void>;
    act(() => {
      first = harness.send();
      duplicate = harness.send();
    });
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(harness.result.current.stream.isStreaming("A")).toBe(true);
    await act(async () => {
      answer.resolve("once");
      await Promise.all([first, duplicate]);
    });
    expect(harness.complete).toHaveBeenCalledExactlyOnceWith("A", "once");
  });

  it("commits only the final postprocessed text, preserving one native run identity", async () => {
    const pipeline = makeMessage("answer", true);
    native.runPipelineStep
      .mockResolvedValueOnce("draft answer")
      .mockResolvedValueOnce("polished answer");
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    await act(async () => harness.send());
    expect(native.runPipelineStep).toHaveBeenCalledTimes(2);
    const [first, second] = native.runPipelineStep.mock.calls;
    expect(second?.[0]).toBe(first?.[0]);
    expect(second?.[2]).toEqual([{ role: "user", text: "draft answer", images: [] }]);
    expect(harness.complete).toHaveBeenCalledExactlyOnceWith("A", "polished answer");
  });

  it("Stop cancels preparation before any descendant or late answer can commit", async () => {
    const prompt = makePrompt();
    const message = makeMessage();
    const pending = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(pending.promise);
    const harness = setup([prompt, message], {
      promptPipelineId: prompt.id,
      messagePipelineId: message.id,
    });
    let sending!: Promise<void>;
    act(() => {
      sending = harness.send();
    });
    const runId = required(native.runPipelineStep.mock.calls[0])[0];
    await act(async () => {
      harness.result.current.stream.stop("A");
      await sending;
    });
    expect(native.cancelPipelineRun).toHaveBeenCalledWith(runId);
    expect(harness.legacy.stop).toHaveBeenCalledWith("A");
    await act(async () => {
      pending.resolve("late prepared text");
      await Promise.resolve();
    });
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(harness.patchChat).not.toHaveBeenCalled();
    expect(harness.complete).not.toHaveBeenCalled();
    expect(harness.legacy.send).not.toHaveBeenCalled();
    expect(harness.result.current.stream.isStreaming("A")).toBe(false);
    expect(harness.result.current.stream.error["A"]).toBeNull();
  });

  it("an old cancelled run cannot clear or commit over a replacement in the same chat", async () => {
    const pipeline = makeMessage();
    const old = deferred<string>();
    const fresh = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    let oldSend!: Promise<void>;
    let freshSend!: Promise<void>;
    act(() => {
      oldSend = harness.send();
      harness.result.current.stream.stop("A");
      freshSend = harness.send();
    });
    await act(async () => {
      await oldSend;
      old.resolve("stale answer");
      await Promise.resolve();
    });
    expect(harness.result.current.stream.isStreaming("A")).toBe(true);
    expect(harness.complete).not.toHaveBeenCalled();
    await act(async () => {
      fresh.resolve("current answer");
      await freshSend;
    });
    expect(harness.complete).toHaveBeenCalledExactlyOnceWith("A", "current answer");
  });

  it.each(["cancelAll", "unmount"] as const)(
    "%s aborts running graphs and prevents late commits",
    async (action) => {
      const pipeline = makeMessage();
      const pending = deferred<string>();
      native.runPipelineStep.mockReturnValueOnce(pending.promise);
      const harness = setup([pipeline], { messagePipelineId: pipeline.id });
      let sending!: Promise<void>;
      act(() => {
        sending = harness.send();
      });
      const runId = required(native.runPipelineStep.mock.calls[0])[0];
      await act(async () => {
        if (action === "unmount") harness.unmount();
        else harness.result.current.cancelAll();
        await sending;
        pending.resolve("late");
      });
      expect(native.cancelPipelineRun).toHaveBeenCalledWith(runId);
      expect(harness.complete).not.toHaveBeenCalled();
    },
  );

  it("uses a valid prepared prompt without invoking a model and preserves legacy answer streaming", async () => {
    const pipeline = makePrompt();
    const harness = setup([pipeline], { promptPipelineId: pipeline.id });
    const turns = messages();
    harness.patchChat("A", {
      preparedPrompt: {
        pipelineId: pipeline.id,
        fingerprint: semanticPipelineFingerprint(pipeline, harness.input(turns)),
        text: "cached system",
        keywordSources: ["Kafka"],
      },
    });
    harness.patchChat.mockClear();
    await act(async () => harness.send("A", turns));
    expect(native.runPipelineStep).not.toHaveBeenCalled();
    expect(harness.patchChat).not.toHaveBeenCalled();
    expect(harness.legacy.send).toHaveBeenCalledExactlyOnceWith(
      "A",
      turns,
      "cached system",
      MODEL,
      OPTIONS,
    );
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it("regenerates stale preparation, caches it and uses it for the next send", async () => {
    const pipeline = makePrompt();
    const harness = setup([pipeline], { promptPipelineId: pipeline.id });
    const before = semanticPipelineFingerprint(pipeline, harness.input());
    harness.patchChat("A", {
      preparedPrompt: {
        pipelineId: pipeline.id,
        fingerprint: before,
        text: "old prepared text",
        keywordSources: [],
      },
    });
    required(pipeline.nodes.find((node) => node.kind === "text")).text =
      "updated material [keywords]: [Rust]";
    native.runPipelineStep.mockResolvedValueOnce("new prepared text");
    harness.patchChat.mockClear();
    await act(async () => harness.send());
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(native.runPipelineStep.mock.calls[0]?.[2][0]?.text).toBe("updated material");
    expect(harness.patchChat).toHaveBeenCalledTimes(1);
    const prepared = harness.chatsRef.current.chats.find((chat) => chat.id === "A")?.preparedPrompt;
    expect(prepared).toMatchObject({
      pipelineId: pipeline.id,
      fingerprint: semanticPipelineFingerprint(pipeline, harness.input()),
      text: "new prepared text",
    });
    expect(prepared?.keywordSources).toContain("updated material [keywords]: [Rust]");
    expect(harness.legacy.send).toHaveBeenLastCalledWith(
      "A",
      messages(),
      "new prepared text",
      MODEL,
      OPTIONS,
    );
    await act(async () => harness.send("A", messages("another question")));
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(harness.legacy.send).toHaveBeenCalledTimes(2);
  });

  it("does not save preparation under a selection changed while it was running", async () => {
    const pipeline = makePrompt();
    const pending = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(pending.promise);
    const harness = setup([pipeline], { promptPipelineId: pipeline.id });
    let sending!: Promise<void>;
    act(() => {
      sending = harness.send();
    });
    harness.patchChat("A", { promptPipelineId: "another-pipeline" });
    harness.patchChat.mockClear();
    await act(async () => {
      pending.resolve("original snapshot");
      await sending;
    });
    expect(harness.patchChat).not.toHaveBeenCalled();
    expect(harness.legacy.send).toHaveBeenLastCalledWith(
      "A",
      messages(),
      "original snapshot",
      MODEL,
      OPTIONS,
    );
  });

  it.each(["promptPipelineId", "messagePipelineId"] as const)(
    "missing %s fails visibly instead of silently sending a legacy request",
    async (field) => {
      const harness = setup([], { [field]: "missing" });
      await act(async () => harness.send());
      expect(harness.result.current.stream.error["A"]?.message).toMatch(/недоступна|unavailable/);
      // A configuration problem is told in words; the code-based toast is for the backend.
      expect(toasts.notify).toHaveBeenCalledTimes(1);
      expect(toasts.notify.mock.calls[0]?.[0].variant).toBe("error");
      expect(toasts.notify.mock.calls[0]?.[0].message).toMatch(/недоступна/);
      expect(harness.onError).not.toHaveBeenCalled();
      expect(harness.result.current.stream.isStreaming("A")).toBe(false);
      expect(native.runPipelineStep).not.toHaveBeenCalled();
      expect(harness.legacy.send).not.toHaveBeenCalled();
      expect(harness.complete).not.toHaveBeenCalled();
    },
  );

  it("waits for loaded definitions rather than sending without the selected graph", async () => {
    const pipeline = makeMessage();
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    harness.pipelines.loaded = false;
    await act(async () => harness.send());
    expect(harness.result.current.stream.error["A"]?.message).toMatch(/не загружены|not loaded/);
    expect(native.runPipelineStep).not.toHaveBeenCalled();
    expect(harness.legacy.send).not.toHaveBeenCalled();
  });

  it("preserves native error codes and never commits a failed step as an answer", async () => {
    const pipeline = makeMessage("answer", true);
    const error = { code: "rateLimited", message: "Try later" };
    native.runPipelineStep.mockRejectedValueOnce(error);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    await act(async () => harness.send());
    expect(harness.result.current.stream.error["A"]).toEqual(error);
    expect(harness.onError).toHaveBeenCalledExactlyOnceWith(error);
    expect(toasts.notify).not.toHaveBeenCalled();
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(harness.complete).not.toHaveBeenCalled();
  });

  it("masks a previous legacy error while a graph is active and after it succeeds", async () => {
    const pipeline = makeMessage();
    const pending = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(pending.promise);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    const previous = { code: "network" as const, message: "An earlier request failed" };
    harness.legacy.error = { A: previous };
    harness.rerender();
    expect(harness.result.current.stream.error["A"]).toEqual(previous);
    let sending!: Promise<void>;
    act(() => {
      sending = harness.send();
    });
    expect(harness.result.current.stream.isStreaming("A")).toBe(true);
    expect(harness.result.current.stream.error["A"]).toBeNull();
    await act(async () => {
      pending.resolve("successful answer");
      await sending;
    });
    expect(harness.result.current.stream.error["A"]).toBeNull();
    expect(harness.complete).toHaveBeenCalledExactlyOnceWith("A", "successful answer");
  });

  it("does not let a completed graph's timestamp override a later legacy stream", async () => {
    const pipeline = makeMessage();
    const pending = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(pending.promise);
    const harness = setup([pipeline], { messagePipelineId: pipeline.id });
    let graphSend!: Promise<void>;
    act(() => {
      graphSend = harness.send();
    });
    const graphStart = required(harness.result.current.stream.startedAt["A"]);
    await act(async () => {
      pending.resolve("graph answer");
      await graphSend;
    });
    harness.patchChat("A", { messagePipelineId: undefined, promptPipelineId: undefined });
    const legacyStart = graphStart + 10_000;
    vi.mocked(harness.legacy.send).mockImplementation(() => {
      harness.legacy.startedAt = { A: legacyStart };
      harness.legacy.streaming = { A: true };
      return Promise.resolve();
    });
    await act(async () => harness.send());
    harness.rerender();
    expect(harness.result.current.stream.startedAt["A"]).toBe(legacyStart);
    expect(harness.result.current.stream.streaming["A"]).toBe(true);
  });
});
