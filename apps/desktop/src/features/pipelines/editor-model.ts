import { t } from "@/i18n";
import type { ContextLibrary } from "@/lib/context-library";
import type { Pipeline, PipelineInput, PipelineNode, PipelinePort } from "@/lib/pipeline-types";
import { DEFAULT_SEPARATOR } from "@/lib/pipelines";

export const NODE_WIDTH = 188;
const COLUMN_GAP = 76;
const ROW_GAP = 164;
/** Height of one input-port row on a card; the target handle of the port sits on its row. */
export const PORT_ROW_PX = 16;
/** Vertical distance between neighbouring port rows. */
export const PORT_STEP_PX = 22;
export const CANVAS_ZOOM = { min: 0.25, max: 1.6 } as const;
/** «Fit» keeps a margin around the cards and never zooms past 1:1. */
export const FIT_VIEW_OPTIONS = { padding: 0.2, maxZoom: 1 } as const;
/** Radix cannot carry an empty item value: the root folder (`sourceId: ""`) travels under this sentinel. */
export const ROOT_FOLDER_VALUE = "root";

export function inputPorts(node: PipelineNode): PipelinePort[] {
  if (node.kind === "llm") return ["input", "system", "history"];
  return node.kind === "output" ? ["input"] : [];
}

export const SEPARATOR_PRESET_IDS = ["paragraph", "line", "space"] as const;
export type SeparatorPresetId = (typeof SEPARATOR_PRESET_IDS)[number];

/**
 * The separators worth a name. A raw text field showed `\n\n` as two blank
 * lines — indistinguishable from an empty field, and one backspace away from
 * gluing every input together. There is no «nothing» on purpose: blocks of a
 * prompt never want to touch, and an empty value is repaired on load.
 */
export const SEPARATOR_PRESETS: Record<SeparatorPresetId, string> = {
  paragraph: DEFAULT_SEPARATOR,
  line: "\n",
  space: " ",
};

export function isSeparatorPresetId(value: string): value is SeparatorPresetId {
  return SEPARATOR_PRESET_IDS.some((id) => id === value);
}

export function separatorPreset(separator: string): SeparatorPresetId | null {
  return SEPARATOR_PRESET_IDS.find((id) => SEPARATOR_PRESETS[id] === separator) ?? null;
}

/** A custom separator is typed with visible escapes: `\n` for a line break, `\t` for a tab. */
export function escapeSeparator(separator: string): string {
  return separator.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\t/g, "\\t");
}

export function unescapeSeparator(text: string): string {
  return text.replace(/\\(n|t|\\)/g, (_match, code: string) =>
    code === "n" ? "\n" : code === "t" ? "\t" : "\\",
  );
}

/**
 * Where a new card goes: below everything in the source column, never on top
 * of an existing card. A slot computed from the node count landed on cards
 * that «Arrange» had already placed there.
 */
export function nextNodePosition(pipeline: Pipeline): PipelineNode["position"] {
  const lowest = Math.max(-ROW_GAP, ...pipeline.nodes.map((node) => node.position.y));
  return { x: 0, y: lowest + ROW_GAP };
}

/**
 * React Flow hides a node until it has measured it, and it forgets the
 * measurement of any node object handed to it without one (`measured` is
 * read off the object, not kept). The canvas rebuilds its node objects from
 * the pipeline on every selection or result change, so each sync carries the
 * sizes the previous objects already had — otherwise every click blanked the
 * cards until a re-measure that did not always come.
 */
export function keepMeasurements<T extends { id: string; measured?: unknown }>(
  previous: readonly T[],
  next: readonly T[],
): T[] {
  const measured = new Map(previous.map((node) => [node.id, node.measured]));
  return next.map((node) => {
    const known = measured.get(node.id);
    return known === undefined ? node : { ...node, measured: known };
  });
}

/** A stable DAG layout makes large pipelines recoverable without changing execution order. */
export function arrangePipeline(pipeline: Pipeline): Pipeline {
  const depths = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    const known = depths.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const incoming = pipeline.edges.filter((edge) => edge.target === id);
    const depth = incoming.reduce((max, edge) => Math.max(max, depthOf(edge.source) + 1), 0);
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  };
  const rows = new Map<number, number>();
  return {
    ...pipeline,
    nodes: pipeline.nodes.map((node) => {
      const depth = depthOf(node.id);
      const row = rows.get(depth) ?? 0;
      rows.set(depth, row + 1);
      return { ...node, position: { x: depth * (NODE_WIDTH + COLUMN_GAP), y: row * ROW_GAP } };
    }),
  };
}

/** The one-line summary under a card's title: what the node points at and how much of it there is. */
export function nodeSummary(node: PipelineNode, input: PipelineInput): string {
  switch (node.kind) {
    case "document":
      return (
        input.library.docs.find((doc) => doc.id === node.sourceId)?.name ??
        t("pipelines.editor.missing")
      );
    case "preset":
      return (
        input.presets.find((preset) => preset.id === node.sourceId)?.name ??
        t("pipelines.editor.missing")
      );
    case "folder": {
      const name =
        node.sourceId === ""
          ? t("pipelines.editor.root")
          : (input.library.folders.find((folder) => folder.id === node.sourceId)?.name ??
            t("pipelines.editor.missing"));
      const count = input.library.docs.filter((doc) =>
        node.folderDocIds === undefined
          ? doc.folderId === node.sourceId
          : node.folderDocIds.includes(doc.id),
      ).length;
      return `${name} · ${t("pipelines.editor.materials")}: ${count}`;
    }
    case "message": {
      const text = input.message?.text ?? "";
      const images = input.message?.images.length ?? 0;
      return images ? `${text} · ${t("pipelines.editor.images")}: ${images}` : text;
    }
    case "history":
      return `${t("pipelines.editor.messages")}: ${input.history.length}`;
    case "llm":
      return node.model || t("pipelines.editor.chatModel");
    case "text":
    case "chatContext":
    case "output":
      return node.text || t(`pipelines.nodeTypes.${node.kind}`);
  }
}

/** A row of a source select. */
export interface SourceChoice {
  id: string;
  name: string;
}

export interface SourceChoices {
  choices: SourceChoice[];
  /** The node's source as a select value (the root folder under its sentinel). */
  value: string;
  /** Whether that value is among the choices; a deleted source is shown as a disabled row. */
  found: boolean;
}

/** What a document, preset or folder node can point at, and where it points now. */
export function sourceChoices(node: PipelineNode, input: PipelineInput): SourceChoices {
  const choices: SourceChoice[] =
    node.kind === "document"
      ? input.library.docs
      : node.kind === "preset"
        ? input.presets
        : node.kind === "folder"
          ? [{ id: ROOT_FOLDER_VALUE, name: t("pipelines.editor.root") }, ...input.library.folders]
          : [];
  const value = node.kind === "folder" && node.sourceId === "" ? ROOT_FOLDER_VALUE : node.sourceId;
  return { choices, value, found: choices.some((choice) => choice.id === value) };
}

/**
 * The members a folder node offers to pin. A pinned reference follows the
 * document when it moves, and a missing document stays listed, so every
 * selected input can still be removed.
 */
export function folderMemberOptions(node: PipelineNode, library: ContextLibrary): SourceChoice[] {
  const inFolder = library.docs.filter((doc) => doc.folderId === node.sourceId);
  const inFolderIds = new Set(inFolder.map((doc) => doc.id));
  const byId = new Map(library.docs.map((doc) => [doc.id, doc]));
  return [
    ...inFolder.map((doc) => ({ id: doc.id, name: doc.name })),
    ...(node.folderDocIds ?? [])
      .filter((id) => !inFolderIds.has(id))
      .map((id, index) => {
        const doc = byId.get(id);
        return {
          id,
          name: doc
            ? `${doc.name} · ${t("pipelines.editor.movedMaterial")}`
            : `${t("pipelines.editor.missing")} (${index + 1})`,
        };
      }),
  ];
}
