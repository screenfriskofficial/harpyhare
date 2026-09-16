import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatMessageDto } from "@/ipc/types";
import type { RequestOptions } from "@/lib/chats";
import type { Pipeline, PipelineInput } from "@/lib/pipeline-types";
import { connectPipelineNodes, createPipeline, createPipelineNode } from "@/lib/pipelines";
import type { PipelinesApi } from "@/hooks/usePipelines";
import { deferred, required } from "@/test-utils/async";
import { pipelineInputFixture } from "@/test-utils/pipeline-fixtures";
import { chooseOption } from "@/test-utils/radix-select";
import { PipelineWorkspace } from "./PipelineWorkspace";

type EditorProps = Parameters<
  typeof import("@/features/pipelines/PipelineEditor").PipelineEditor
>[0];
type WorkspaceProps = Parameters<typeof PipelineWorkspace>[0];

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
vi.mock("@/features/pipelines/PipelineEditor", () => ({
  PipelineEditor: ({
    input,
    busy,
    result,
    resultFingerprint,
    error,
    onRun,
    onCancel,
  }: EditorProps) => (
    <div>
      <div data-testid="run-fingerprint">{resultFingerprint ?? "none"}</div>
      <div data-testid="preview-system">{input.chatContext}</div>
      <div data-testid="preview-pending">{String(input.chatContextPending ?? false)}</div>
      <div data-testid="preview-keywords">
        {JSON.stringify(input.chatContextKeywordSources ?? [])}
      </div>
      <div data-testid="preview-message">{input.message?.text ?? ""}</div>
      <div data-testid="run-result">{result?.text ?? ""}</div>
      <div data-testid="run-error">{error ?? ""}</div>
      <button type="button" disabled={busy === true || !onRun} onClick={onRun}>
        Run test pipeline
      </button>
      <button type="button" disabled={!busy} onClick={onCancel}>
        Cancel test pipeline
      </button>
    </div>
  ),
}));

/** The launcher's input: a library and presets, no chat and no message. */
function makeInput(text = "candidate context [keywords]: [Rust]"): PipelineInput {
  return pipelineInputFixture({
    library: { folders: [], docs: [{ id: "cv", name: "CV", text, folderId: "" }] },
    model: "chosen-model",
  });
}

function makePrompt(useModel = true): Pipeline {
  const document = createPipelineNode("document", { id: "cv-source", sourceId: "cv" });
  const output = createPipelineNode("output", { id: "prepared-output" });
  const model = createPipelineNode("llm", {
    id: "prepare-model",
    text: "Prepare interview instructions",
  });
  let pipeline: Pipeline = {
    id: "prepare",
    name: "Prepare CV",
    kind: "prompt",
    nodes: useModel ? [document, model, output] : [document, output],
    edges: [],
  };
  pipeline = connectPipelineNodes(pipeline, {
    source: document.id,
    target: useModel ? model.id : output.id,
  });
  return useModel
    ? connectPipelineNodes(pipeline, { source: model.id, target: output.id })
    : pipeline;
}

function setup(options: { staticPrompt?: boolean; input?: PipelineInput; sample?: string } = {}) {
  const prompt = makePrompt(!options.staticPrompt);
  const message: Pipeline = { ...createPipeline("message", "Answer and transform"), id: "answer" };
  const api: PipelinesApi = {
    // The message pipeline comes first so that it is the one selected on open.
    library: { version: 1, pipelines: [message, prompt] },
    loaded: true,
    error: null,
    put: vi.fn(),
    remove: vi.fn(),
    reload: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined),
  };
  const props: WorkspaceProps = { api, input: options.input ?? makeInput(), models: [] };
  const view = render(<PipelineWorkspace {...props} />);
  // The launcher has no chat, so a message pipeline needs a typed sample to run at all.
  fireEvent.change(screen.getByLabelText(/Сообщение для проверки/), {
    target: { value: options.sample ?? "test question" },
  });
  const updateInput = (input: PipelineInput) => {
    props.input = input;
    view.rerender(<PipelineWorkspace {...props} />);
  };
  const prepareWith = (name = prompt.name) => {
    chooseOption("Контекст чата для проверки", name);
  };
  return { ...view, props, prompt, message, updateInput, prepareWith };
}

function runButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: "Run test pipeline" });
}

async function waitForResult(text: string): Promise<void> {
  await waitFor(() => {
    expect(screen.getByTestId("run-result").textContent).toBe(text);
    expect(runButton().disabled).toBe(false);
  });
}

beforeEach(() => {
  native.runPipelineStep.mockReset().mockResolvedValue("answer");
  native.cancelPipelineRun.mockReset().mockResolvedValue();
});
afterEach(cleanup);

describe("PipelineWorkspace test runs", () => {
  it("runs a message pipeline against an empty chat context when no preparation is chosen", async () => {
    setup();
    expect(screen.getByTestId("preview-system").textContent).toBe("");
    expect(screen.getByTestId("preview-pending").textContent).toBe("false");
    expect(screen.getByTestId("preview-message").textContent).toBe("test question");
    fireEvent.click(runButton());
    await waitForResult("answer");
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    const call = required(native.runPipelineStep.mock.calls[0]);
    expect(call[3]).toBe("");
    expect(call[2].at(-1)?.text).toBe("test question");
  });

  it("prepares the chosen prompt before the message run and applies the exact prepared text", async () => {
    const preparation = deferred<string>();
    native.runPipelineStep
      .mockReturnValueOnce(preparation.promise)
      .mockResolvedValueOnce("final answer");
    const harness = setup();
    harness.prepareWith();
    expect(screen.getByTestId("preview-pending").textContent).toBe("true");
    expect(screen.getByText(/сначала выполнится «Prepare CV»/)).not.toBeNull();
    fireEvent.click(runButton());
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    const first = required(native.runPipelineStep.mock.calls[0]);
    expect(first[1]).toBe("prepare-model");
    expect(first[2][0]?.text).toContain("candidate context");
    expect(first[3]).toBe("Prepare interview instructions");
    expect(screen.getByText("Подготовка системного промпта…")).toBeTruthy();
    await act(async () => {
      preparation.resolve("prepared system");
      await preparation.promise;
    });
    await waitForResult("final answer");
    expect(native.runPipelineStep).toHaveBeenCalledTimes(2);
    expect(native.runPipelineStep.mock.calls[1]?.[3]).toBe("prepared system");
    expect(screen.getByTestId("preview-system").textContent).toBe("prepared system");
    expect(screen.getByTestId("preview-keywords").textContent).toContain(
      "candidate context [keywords]: [Rust]",
    );
    expect(screen.getByText(/«Prepare CV», подготовлен/)).not.toBeNull();
  });

  it("reuses preparation completed on this screen for subsequent message runs", async () => {
    native.runPipelineStep
      .mockResolvedValueOnce("prepared once")
      .mockResolvedValueOnce("first answer")
      .mockResolvedValueOnce("second answer");
    const harness = setup();
    harness.prepareWith();
    fireEvent.click(runButton());
    await waitForResult("first answer");
    fireEvent.click(runButton());
    await waitForResult("second answer");
    expect(native.runPipelineStep).toHaveBeenCalledTimes(3);
    expect(
      native.runPipelineStep.mock.calls.filter((call) => call[1] === "prepare-model"),
    ).toHaveLength(1);
    expect(native.runPipelineStep.mock.calls[2]?.[3]).toBe("prepared once");
  });

  it("resolves a static prompt for preview and run without a preparation model call", async () => {
    const harness = setup({ staticPrompt: true });
    harness.prepareWith();
    const compiled = screen.getByTestId("preview-system").textContent ?? "";
    expect(compiled).toContain("candidate context");
    expect(compiled).not.toContain("[keywords]");
    expect(native.runPipelineStep).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    await waitForResult("answer");
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(native.runPipelineStep.mock.calls[0]?.[3]).toBe(compiled);
  });

  it("invalidates the local preparation when its source changes", async () => {
    native.runPipelineStep
      .mockResolvedValueOnce("updated system")
      .mockResolvedValueOnce("updated answer")
      .mockResolvedValueOnce("latest system")
      .mockResolvedValueOnce("latest answer");
    const harness = setup({ input: makeInput("updated source") });
    harness.prepareWith();
    fireEvent.click(runButton());
    await waitForResult("updated answer");
    expect(native.runPipelineStep.mock.calls[0]?.[2][0]?.text).toContain("updated source");
    expect(native.runPipelineStep.mock.calls[1]?.[3]).toBe("updated system");
    harness.updateInput(makeInput("latest source"));
    expect(screen.getByTestId("preview-system").textContent).toBe("");
    fireEvent.click(runButton());
    await waitForResult("latest answer");
    expect(native.runPipelineStep).toHaveBeenCalledTimes(4);
    expect(native.runPipelineStep.mock.calls[2]?.[2][0]?.text).toContain("latest source");
    expect(native.runPipelineStep.mock.calls[3]?.[3]).toBe("latest system");
  });

  it("cancels preparation without starting the message model or accepting a late result", async () => {
    const preparation = deferred<string>();
    native.runPipelineStep.mockReturnValueOnce(preparation.promise);
    const harness = setup();
    harness.prepareWith();
    fireEvent.click(runButton());
    const runId = required(native.runPipelineStep.mock.calls[0])[0];
    fireEvent.click(screen.getByRole("button", { name: "Cancel test pipeline" }));
    await waitFor(() => {
      expect(runButton().disabled).toBe(false);
    });
    expect(native.cancelPipelineRun).toHaveBeenCalledWith(runId);
    await act(async () => {
      preparation.resolve("late preparation");
      await Promise.resolve();
    });
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("run-result").textContent).toBe("");
    expect(screen.getByTestId("preview-system").textContent).toBe("");
  });

  it("surfaces preparation errors without sending an unprepared message request", async () => {
    native.runPipelineStep.mockRejectedValueOnce({
      code: "rateLimited",
      message: "Preparation rate limited",
    });
    const harness = setup();
    harness.prepareWith();
    fireEvent.click(runButton());
    await waitFor(() => {
      expect(screen.getByTestId("run-error").textContent).toBe("Preparation rate limited");
    });
    expect(native.runPipelineStep).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("run-result").textContent).toBe("");
  });

  it("marks the empty test message as required until something is typed", async () => {
    setup({ sample: "" });
    const field = screen.getByLabelText<HTMLInputElement>(/Сообщение для проверки/);
    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("true");
    });
    expect(screen.getByRole("alert").textContent).toContain("Введите пример вопроса");
    fireEvent.change(field, { target: { value: "what is map in python" } });
    await waitFor(() => {
      expect(field.getAttribute("aria-invalid")).toBe("false");
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reports no run before the first test run and the run's fingerprint after it", async () => {
    setup();
    expect(screen.getByTestId("run-fingerprint").textContent).toBe("none");
    fireEvent.click(runButton());
    await waitForResult("answer");
    expect(screen.getByTestId("run-fingerprint").textContent).not.toBe("none");
  });

  it("creates pipelines with localized names and switches to the new one", () => {
    const harness = setup();
    fireEvent.click(screen.getByRole("button", { name: "Промпт" }));
    const created = required(vi.mocked(harness.props.api.put).mock.calls[0])[0];
    expect(created.kind).toBe("prompt");
    expect(created.name).toBe("Подготовка промпта");
    expect(created.nodes.map((node) => node.name)).toEqual(["Текст", "Итог"]);
  });
});
