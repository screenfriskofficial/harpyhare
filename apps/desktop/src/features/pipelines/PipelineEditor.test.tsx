import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Pipeline, PipelineInput } from "@/lib/pipeline-types";
import {
  createPipeline,
  createPipelineNode,
  connectPipelineNodes,
  semanticPipelineFingerprint,
} from "@/lib/pipelines";
import { pipelineInputFixture } from "@/test-utils/pipeline-fixtures";
import { chooseOption } from "@/test-utils/radix-select";
import { PipelineEditor } from "./PipelineEditor";

const INPUT: PipelineInput = pipelineInputFixture({
  library: {
    folders: [{ id: "folder", name: "Interview" }],
    docs: [
      { id: "cv", folderId: "folder", name: "CV", text: "Experience" },
      { id: "job", folderId: "folder", name: "Job", text: "Requirements" },
    ],
  },
  message: { role: "user", text: "Question", images: [] },
  chatContext: "Role",
});

function Harness({
  initial,
  changed = () => undefined,
  onRun,
  input = INPUT,
}: {
  initial: Pipeline;
  changed?: (pipeline: Pipeline) => void;
  onRun?: () => void;
  input?: PipelineInput;
}) {
  const [pipeline, setPipeline] = useState(initial);
  return (
    <PipelineEditor
      pipeline={pipeline}
      onChange={(next) => {
        setPipeline(next);
        changed(next);
      }}
      input={input}
      models={[]}
      onRun={onRun}
    />
  );
}

function selectNode(name: string) {
  const button = screen.getByText(name).closest("button");
  if (!button) throw new Error("Node button missing");
  fireEvent.click(button);
}

function switchChecked(name: string): boolean {
  return screen.getByRole("switch", { name }).getAttribute("aria-checked") === "true";
}

afterEach(cleanup);

describe("PipelineEditor", () => {
  it("uses the accessible list to edit a source and undo the resulting text change", () => {
    const initial = createPipeline("prompt");
    initial.nodes = initial.nodes.map((node) =>
      node.kind === "text"
        ? { ...node, name: "Source", text: "Before" }
        : { ...node, name: "Final" },
    );
    render(<Harness initial={initial} />);
    selectNode("Source");
    fireEvent.change(screen.getByLabelText("Текст"), { target: { value: "After" } });
    expect(screen.getByText("After")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    expect(screen.getByText("Before")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Вернуть" }));
    expect(screen.getByText("After")).not.toBeNull();
  });

  it("lets a folder use a selected file subset without copying documents", () => {
    const changed = vi.fn<(pipeline: Pipeline) => void>();
    render(<Harness initial={createPipeline("prompt")} changed={changed} />);
    fireEvent.click(screen.getByRole("button", { name: "Добавить узел" }));
    chooseOption("Источник", "Interview");
    chooseOption("Состав папки", "Выбранные материалы");
    fireEvent.click(screen.getByRole("switch", { name: "Job" }));
    const latest = changed.mock.calls.at(-1)?.[0];
    const folder = latest?.nodes.find((node) => node.kind === "folder");
    expect(folder?.sourceId).toBe("folder");
    expect(folder?.folderDocIds).toEqual(["cv"]);
    expect(folder?.text).toBe("");
  });

  it("offers the message and history nodes only to a message pipeline", () => {
    render(<Harness initial={createPipeline("prompt")} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Тип узла" }), { key: "Enter" });
    const kinds = within(screen.getByRole("listbox"));
    expect(kinds.queryByText("Сообщение")).toBeNull();
    expect(kinds.queryByText("История чата")).toBeNull();
    expect(kinds.getByText("Контекст чата")).not.toBeNull();
    cleanup();
    render(<Harness initial={createPipeline("message")} />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Тип узла" }), { key: "Enter" });
    expect(within(screen.getByRole("listbox")).getByText("История чата")).not.toBeNull();
  });

  it("creates and removes an ordered input through the connection form", () => {
    const source = createPipelineNode("text", { name: "Extra", text: "Additional" });
    const merge = createPipelineNode("llm", { name: "Assembly", enabled: false });
    let initial = createPipeline("prompt");
    initial.nodes = [...initial.nodes, source, merge];
    const output = initial.nodes.find((node) => node.kind === "output");
    if (!output) throw new Error("Output missing");
    initial = connectPipelineNodes(initial, { source: merge.id, target: output.id });
    const changed = vi.fn<(pipeline: Pipeline) => void>();
    render(<Harness initial={initial} changed={changed} />);
    selectNode("Assembly");
    chooseOption("От узла", "Extra");
    fireEvent.click(screen.getByRole("button", { name: "Соединить" }));
    expect(
      changed.mock.calls
        .at(-1)?.[0]
        .edges.some((edge) => edge.source === source.id && edge.target === merge.id),
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Убрать связь" }));
    expect(
      changed.mock.calls
        .at(-1)?.[0]
        .edges.some((edge) => edge.source === source.id && edge.target === merge.id),
    ).toBe(false);
  });

  it("shows and removes pinned materials after they move or disappear", () => {
    const folder = createPipelineNode("folder", {
      name: "Pinned folder",
      sourceId: "folder",
      folderDocIds: ["cv", "removed-doc"],
    });
    const initial = createPipeline("prompt");
    initial.nodes.push(folder);
    const input = {
      ...INPUT,
      library: {
        ...INPUT.library,
        docs: INPUT.library.docs.map((doc) => (doc.id === "cv" ? { ...doc, folderId: "" } : doc)),
      },
    };
    const changed = vi.fn<(pipeline: Pipeline) => void>();
    render(<Harness initial={initial} changed={changed} input={input} />);
    selectNode("Pinned folder");
    expect(switchChecked("CV · В другой папке")).toBe(true);
    expect(switchChecked("Источник недоступен (2)")).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Источник недоступен (2)" }));
    expect(
      changed.mock.calls.at(-1)?.[0].nodes.find((node) => node.id === folder.id)?.folderDocIds,
    ).toEqual(["cv"]);
    fireEvent.click(screen.getByRole("switch", { name: "CV · В другой папке" }));
    expect(
      changed.mock.calls.at(-1)?.[0].nodes.find((node) => node.id === folder.id)?.folderDocIds,
    ).toEqual([]);
  });

  it("edits the output separator through named choices instead of invisible whitespace", () => {
    const changed = vi.fn<(pipeline: Pipeline) => void>();
    const initial = createPipeline("prompt");
    initial.nodes = initial.nodes.map((node) =>
      node.kind === "output" ? { ...node, name: "Final" } : node,
    );
    render(<Harness initial={initial} changed={changed} />);
    selectNode("Final");
    fireEvent.click(screen.getByRole("button", { name: "Настройка" }));
    expect(screen.getByRole("combobox", { name: "Разделитель" }).textContent).toContain(
      "Пустая строка",
    );
    chooseOption("Разделитель", "Перенос строки");
    expect(
      changed.mock.calls.at(-1)?.[0].nodes.find((node) => node.kind === "output")?.separator,
    ).toBe("\n");
    chooseOption("Разделитель", "Свой");
    fireEvent.change(screen.getByLabelText(/Свой разделитель/), { target: { value: "\\n---\\n" } });
    expect(
      changed.mock.calls.at(-1)?.[0].nodes.find((node) => node.kind === "output")?.separator,
    ).toBe("\n---\n");
  });

  it("names the node in a localized issue and flags a send-only node in a prompt pipeline", () => {
    const initial = createPipeline("prompt");
    initial.nodes.push(createPipelineNode("history", { name: "Old talk" }));
    render(<Harness initial={initial} />);
    expect(screen.getByText(/«Old talk» недоступен в схеме промпта/)).not.toBeNull();
  });

  it("keeps model preview unresolved until an explicit run", () => {
    const onRun = vi.fn();
    const pipeline = createPipeline("message");
    const model = pipeline.nodes.find((node) => node.kind === "llm");
    if (!model) throw new Error("Model node missing");
    render(<Harness initial={pipeline} onRun={onRun} />);
    expect(screen.getByText(/Для точного текста нужно выполнить LLM/)).not.toBeNull();
    selectNode(model.name);
    fireEvent.click(screen.getByRole("button", { name: "Состав" }));
    expect(screen.getByText("Запрос к модели")).not.toBeNull();
    expect(screen.getByText("Role")).not.toBeNull();
    expect(screen.getByText("Question")).not.toBeNull();
    expect(screen.getByText(/Вход полностью собран/)).not.toBeNull();
    expect(onRun).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Выполнить схему" }));
    expect(onRun).toHaveBeenCalledOnce();
  });

  it("renders a run result like a HUD answer instead of raw markup", () => {
    const { container } = render(
      <PipelineEditor
        pipeline={createPipeline("prompt")}
        input={INPUT}
        models={[]}
        onChange={vi.fn()}
        result={{
          text: "**map** applies a function\n\n```python\nmap(f, xs)\n```",
          nodes: [],
          keywordSources: [],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Результат" }));
    expect(container.querySelector("strong")?.textContent).toBe("map");
    expect(container.querySelector("pre code")?.textContent).toContain("map(f, xs)");
    expect(screen.queryByText(/\*\*map\*\*/)).toBeNull();
  });

  it("shows no stale banner before the first run, only the empty result", () => {
    render(
      <PipelineEditor
        pipeline={createPipeline("prompt")}
        input={INPUT}
        models={[]}
        onChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Результат" }));
    expect(screen.queryByText(/Показан результат предыдущего запуска/)).toBeNull();
    expect(screen.getByText("Сначала выполните схему")).not.toBeNull();
  });

  it("labels a result as stale when source material changes", () => {
    const initial = createPipeline("prompt");
    initial.nodes = initial.nodes.map((node) =>
      node.kind === "text" ? { ...node, text: "Version one" } : node,
    );
    const fingerprint = semanticPipelineFingerprint(initial, INPUT);
    const changed = {
      ...initial,
      nodes: initial.nodes.map((node) =>
        node.kind === "text" ? { ...node, text: "Version two" } : node,
      ),
    };
    render(
      <PipelineEditor
        pipeline={changed}
        input={INPUT}
        models={[]}
        onChange={vi.fn()}
        result={{ text: "Version one", nodes: [], keywordSources: [] }}
        resultFingerprint={fingerprint}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Результат" }));
    expect(screen.getByText(/Показан результат предыдущего запуска/)).not.toBeNull();
    expect(screen.getByText("Version one")).not.toBeNull();
  });
});
