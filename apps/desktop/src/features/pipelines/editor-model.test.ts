import { describe, expect, it } from "vitest";
import { createPipeline, createPipelineNode } from "@/lib/pipelines";
import { pipelineInputFixture } from "@/test-utils/pipeline-fixtures";
import {
  escapeSeparator,
  folderMemberOptions,
  isSeparatorPresetId,
  keepMeasurements,
  nextNodePosition,
  nodeSummary,
  ROOT_FOLDER_VALUE,
  SEPARATOR_PRESETS,
  separatorPreset,
  sourceChoices,
  unescapeSeparator,
} from "./editor-model";

const LIBRARY_INPUT = pipelineInputFixture({
  library: {
    folders: [{ id: "folder", name: "Interview" }],
    docs: [
      { id: "cv", folderId: "folder", name: "CV", text: "Experience" },
      { id: "job", folderId: "folder", name: "Job", text: "Requirements" },
      { id: "loose", folderId: "", name: "Loose", text: "Note" },
    ],
  },
  presets: [{ id: "coach", name: "Coach", text: "Be concise." }],
  message: {
    role: "user",
    text: "Question",
    images: [{ media_type: "image/png", data: "AAAA" }],
  },
  history: [
    { role: "user", text: "Hello", images: [] },
    { role: "assistant", text: "Hi", images: [] },
  ],
});

describe("keepMeasurements", () => {
  it("carries the measured size of a node onto its rebuilt object and leaves unknown nodes alone", () => {
    const previous = [
      { id: "a", measured: { width: 188, height: 120 }, selected: false },
      { id: "b", measured: undefined, selected: false },
    ];
    const next = [
      { id: "a", selected: true },
      { id: "b", selected: false },
      { id: "c", selected: false },
    ];
    expect(keepMeasurements(previous, next)).toEqual([
      { id: "a", selected: true, measured: { width: 188, height: 120 } },
      { id: "b", selected: false },
      { id: "c", selected: false },
    ]);
  });
});

describe("separator presets", () => {
  it("names every preset and reports anything else as custom", () => {
    expect(separatorPreset(SEPARATOR_PRESETS.paragraph)).toBe("paragraph");
    expect(separatorPreset("")).toBeNull();
    expect(separatorPreset("\n---\n")).toBeNull();
    expect(isSeparatorPresetId("line")).toBe(true);
    expect(isSeparatorPresetId("custom")).toBe(false);
  });

  it("round-trips a custom separator through visible escapes", () => {
    expect(escapeSeparator("\n---\n")).toBe("\\n---\\n");
    expect(unescapeSeparator("\\n---\\n")).toBe("\n---\n");
    expect(unescapeSeparator(escapeSeparator("a\\b\tc\n"))).toBe("a\\b\tc\n");
    expect(unescapeSeparator("trailing\\")).toBe("trailing\\");
  });
});

describe("nextNodePosition", () => {
  it("starts at the origin for an empty pipeline and goes below the lowest card afterwards", () => {
    expect(nextNodePosition({ ...createPipeline("prompt"), nodes: [] })).toEqual({ x: 0, y: 0 });
    const pipeline = createPipeline("prompt");
    pipeline.nodes.push(createPipelineNode("text", { position: { x: 300, y: 900 } }));
    const position = nextNodePosition(pipeline);
    expect(position.x).toBe(0);
    expect(position.y).toBeGreaterThan(900);
    expect(pipeline.nodes.some((node) => node.position.y === position.y)).toBe(false);
  });
});

describe("nodeSummary", () => {
  it("names the source, counts folder members, images and history, and falls back for a missing source", () => {
    const folder = createPipelineNode("folder", { sourceId: "folder" });
    expect(nodeSummary(folder, LIBRARY_INPUT)).toBe("Interview · Материалы: 2");
    expect(nodeSummary({ ...folder, folderDocIds: ["cv"] }, LIBRARY_INPUT)).toBe(
      "Interview · Материалы: 1",
    );
    expect(nodeSummary(createPipelineNode("folder"), LIBRARY_INPUT)).toBe(
      "Без папки · Материалы: 1",
    );
    expect(nodeSummary(createPipelineNode("document", { sourceId: "cv" }), LIBRARY_INPUT)).toBe(
      "CV",
    );
    expect(nodeSummary(createPipelineNode("document", { sourceId: "gone" }), LIBRARY_INPUT)).toBe(
      "Источник недоступен",
    );
    expect(nodeSummary(createPipelineNode("preset", { sourceId: "coach" }), LIBRARY_INPUT)).toBe(
      "Coach",
    );
    expect(nodeSummary(createPipelineNode("message"), LIBRARY_INPUT)).toBe(
      "Question · Изображения: 1",
    );
    expect(nodeSummary(createPipelineNode("history"), LIBRARY_INPUT)).toBe("Сообщения: 2");
    expect(nodeSummary(createPipelineNode("llm"), LIBRARY_INPUT)).toBe("Модель чата");
    expect(nodeSummary(createPipelineNode("llm", { model: "gpt" }), LIBRARY_INPUT)).toBe("gpt");
    expect(nodeSummary(createPipelineNode("text", { text: "Hi" }), LIBRARY_INPUT)).toBe("Hi");
    expect(nodeSummary(createPipelineNode("output"), LIBRARY_INPUT)).toBe("Итог");
  });
});

describe("source choices", () => {
  it("offers documents, presets or folders with the root under its sentinel and flags a deleted source", () => {
    const document = sourceChoices(
      createPipelineNode("document", { sourceId: "cv" }),
      LIBRARY_INPUT,
    );
    expect(document.choices.map((choice) => choice.id)).toEqual(["cv", "job", "loose"]);
    expect(document).toMatchObject({ value: "cv", found: true });
    expect(
      sourceChoices(createPipelineNode("preset", { sourceId: "gone" }), LIBRARY_INPUT),
    ).toMatchObject({ value: "gone", found: false });
    const folder = sourceChoices(createPipelineNode("folder"), LIBRARY_INPUT);
    expect(folder.choices.map((choice) => choice.id)).toEqual([ROOT_FOLDER_VALUE, "folder"]);
    expect(folder).toMatchObject({ value: ROOT_FOLDER_VALUE, found: true });
    expect(sourceChoices(createPipelineNode("text"), LIBRARY_INPUT).choices).toEqual([]);
  });

  it("lists folder members first, then pinned documents that moved or disappeared", () => {
    const pinned = createPipelineNode("folder", {
      sourceId: "folder",
      folderDocIds: ["cv", "loose", "gone"],
    });
    expect(folderMemberOptions(pinned, LIBRARY_INPUT.library)).toEqual([
      { id: "cv", name: "CV" },
      { id: "job", name: "Job" },
      { id: "loose", name: "Loose · В другой папке" },
      { id: "gone", name: "Источник недоступен (2)" },
    ]);
    expect(
      folderMemberOptions(
        createPipelineNode("folder", { sourceId: "empty" }),
        LIBRARY_INPUT.library,
      ),
    ).toEqual([]);
  });
});
