import { describe, expect, it, vi } from "vitest";
import type {
  Pipeline,
  PipelineInput,
  PipelineNode,
  PipelineNodeKind,
  PipelineNodeResult,
} from "./pipeline-types";
import {
  canConnectPipelineNodes,
  connectPipelineNodes,
  createPipeline,
  createPipelineNode,
  deserializePipelineLibrary,
  executePipeline,
  findPipeline,
  incomingEdges,
  movePipelineEdge,
  movePipelineNodes,
  PipelineError,
  pipelineInput,
  pipelinesOfKind,
  previewPipeline,
  removePipeline,
  removePipelineEdge,
  removePipelineItems,
  removePipelineNode,
  semanticPipelineFingerprint,
  serializePipelineLibrary,
  updatePipelineNode,
  upsertPipeline,
  validatePipeline,
  withPreparedContext,
} from "./pipelines";
import { pipelineInputFixture } from "@/test-utils/pipeline-fixtures";

function input(): PipelineInput {
  return pipelineInputFixture({
    library: {
      folders: [{ id: "folder", name: "Interview" }],
      docs: [
        {
          id: "resume",
          name: "Resume",
          text: "Engineer. [keywords]: [TypeScript]",
          folderId: "folder",
        },
        { id: "role", name: "Role", text: "Frontend engineer", folderId: "folder" },
      ],
    },
    presets: [{ id: "preset", name: "Coach", text: "Be concise." }],
    message: { role: "user", text: "Explain the architecture", images: [] },
    history: [
      { role: "user", text: "Hello", images: [] },
      { role: "assistant", text: "Hi", images: [] },
    ],
    chatContext: "You are an engineering coach.",
  });
}

function node(id: string, kind: PipelineNodeKind, patch: Partial<PipelineNode> = {}): PipelineNode {
  return createPipelineNode(kind, { id, name: id, ...patch });
}

function pipeline(
  nodes: PipelineNode[],
  connections: [string, string, ("input" | "system" | "history")?][] = [],
): Pipeline {
  // A message pipeline accepts every node kind; the prompt-only rule has its own test.
  let graph: Pipeline = { id: "pipeline", name: "Test", kind: "message", nodes, edges: [] };
  for (const [source, target, targetPort] of connections) {
    graph = connectPipelineNodes(graph, {
      source,
      target,
      targetPort,
      id: `edge-${graph.edges.length}`,
    });
  }
  return graph;
}

/** The codes a `PipelineError` carries; anything else thrown fails the assertion. */
function issueCodes(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    if (error instanceof PipelineError) return error.issues.map((issue) => issue.code);
    throw error;
  }
  throw new Error("Expected a PipelineError");
}

async function rejectedCodes(promise: Promise<unknown>): Promise<string[]> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof PipelineError) return error.issues.map((issue) => issue.code);
    throw error;
  }
  throw new Error("Expected a PipelineError");
}

function executionOptions(
  callModel = vi
    .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
    .mockResolvedValue("model answer"),
) {
  return { signal: new AbortController().signal, callModel };
}

describe("pipeline editing and disk format", () => {
  it("reads an empty separator left by the old free-text field as the default blank line", () => {
    const graph = createPipeline("prompt");
    graph.nodes = graph.nodes.map((item) => ({ ...item, separator: "" }));
    const restored = deserializePipelineLibrary(
      serializePipelineLibrary({ version: 1, pipelines: [graph] }),
    );
    expect(restored?.pipelines[0]?.nodes.every((item) => item.separator === "\n\n")).toBe(true);
  });

  it("flags message and history nodes in a prompt pipeline instead of loading a message at send time", () => {
    const graph = {
      ...pipeline([node("message", "message"), node("out", "output")], [["message", "out"]]),
      kind: "prompt" as const,
    };
    expect(validatePipeline(graph, input()).map((issue) => issue.code)).toContain("kind-mismatch");
    expect(previewPipeline(graph, input()).issues.map((issue) => issue.code)).toContain(
      "kind-mismatch",
    );
    // The file still loads: the editor shows the issue instead of the library being refused.
    const restored = deserializePipelineLibrary(
      serializePipelineLibrary({ version: 1, pipelines: [graph] }),
    );
    expect(restored?.pipelines[0]?.id).toBe(graph.id);
    expect(validatePipeline({ ...graph, kind: "message" }, input())).toEqual([]);
  });

  it("creates an explicit prompt draft and a complete message template", () => {
    const prompt = createPipeline("prompt");
    expect(validatePipeline(prompt, input()).map((issue) => issue.code)).toEqual(["empty-text"]);
    const draft = prompt.nodes.find((item) => item.kind === "text");
    expect(draft).toBeDefined();
    const ready = updatePipelineNode(prompt, draft?.id ?? "", { text: "System instruction" });
    expect(previewPipeline(ready, input())).toMatchObject({
      text: "System instruction",
      complete: true,
    });
    expect(validatePipeline(createPipeline("message"), input())).toEqual([]);
    expect(prompt.nodes.find((item) => item.kind === "text")?.text).toBe("");
  });

  it("updates and removes graph/library entries without mutating prior revisions", () => {
    const graph = pipeline(
      [node("source", "text", { text: "A" }), node("out", "output")],
      [["source", "out"]],
    );
    const library = upsertPipeline({ version: 1, pipelines: [] }, graph);
    if (graph.nodes[0]) graph.nodes[0].position.x = 80;
    expect(library.pipelines[0]?.nodes[0]?.position.x).toBe(0);
    expect(removePipeline(library, "pipeline").pipelines).toEqual([]);
    const changed = upsertPipeline(library, { ...graph, name: "Renamed" });
    expect(changed.pipelines).toHaveLength(1);
    expect(library.pipelines[0]?.name).toBe("Test");
    expect(removePipelineEdge(graph, "edge-0").edges).toEqual([]);
    const removed = removePipelineNode(graph, "source");
    expect(removed.nodes.map((item) => item.id)).toEqual(["out"]);
    expect(removed.edges).toEqual([]);
    expect(graph.edges).toHaveLength(1);
  });

  it("round trips versioned data, distinguishes missing storage from corrupt/unsupported data", () => {
    const library = { version: 1 as const, pipelines: [createPipeline("message")] };
    expect(deserializePipelineLibrary(serializePipelineLibrary(library))).toEqual(library);
    expect(deserializePipelineLibrary(" ")).toEqual({ version: 1, pipelines: [] });
    for (const bad of [
      "garbage",
      "null",
      "[]",
      '{"version":2,"pipelines":[]}',
      '{"version":1}',
      '{"version":1,"pipelines":[null]}',
    ]) {
      expect(deserializePipelineLibrary(bad)).toBeNull();
    }
    expect(
      deserializePipelineLibrary(
        JSON.stringify({ ...library, pipelines: [...library.pipelines, ...library.pipelines] }),
      ),
    ).toBeNull();
    const broken = structuredClone(library);
    const edge = broken.pipelines[0]?.edges[0];
    if (edge) edge.source = "missing";
    expect(deserializePipelineLibrary(JSON.stringify(broken))).toBeNull();
    expect(
      deserializePipelineLibrary(JSON.stringify({ version: 1, pipelines: [pipeline([])] })),
    ).not.toBeNull();
  });

  it("rejects malformed nodes, unknown kinds, unsafe coordinates and invalid connection order", () => {
    const graph = createPipeline("message");
    const serialized = (replacement: unknown) =>
      JSON.stringify({
        version: 1,
        pipelines: [{ ...graph, nodes: [replacement, ...graph.nodes.slice(1)] }],
      });
    for (const patch of [
      { kind: "script" },
      { enabled: "yes" },
      { folderDocIds: ["d", "d"] },
      { position: { x: null, y: 0 } },
    ]) {
      expect(deserializePipelineLibrary(serialized({ ...graph.nodes[0], ...patch }))).toBeNull();
    }
    expect(
      deserializePipelineLibrary(
        JSON.stringify({
          version: 1,
          pipelines: [{ ...graph, edges: graph.edges.map((edge) => ({ ...edge, order: -1 })) }],
        }),
      ),
    ).toBeNull();
  });

  it("guards cycles, invalid ports, duplicate connections and history types", () => {
    const graph = pipeline(
      [
        node("text", "text", { text: "a" }),
        node("first", "llm", { enabled: false }),
        node("second", "llm"),
        node("history", "history"),
        node("out", "output"),
      ],
      [
        ["text", "first"],
        ["first", "second"],
        ["second", "out"],
      ],
    );
    expect(canConnectPipelineNodes(graph, { source: "second", target: "first" })).toBe("cycle");
    expect(canConnectPipelineNodes(graph, { source: "text", target: "first" })).toBe(
      "duplicate-edge",
    );
    expect(
      canConnectPipelineNodes(graph, { source: "text", target: "out", targetPort: "system" }),
    ).toBe("invalid-port");
    expect(canConnectPipelineNodes(graph, { source: "out", target: "second" })).toBe(
      "invalid-source",
    );
    expect(canConnectPipelineNodes(graph, { source: "history", target: "second" })).toBe(
      "invalid-source",
    );
    expect(
      canConnectPipelineNodes(graph, { source: "text", target: "second", targetPort: "history" }),
    ).toBe("invalid-source");
    expect(
      canConnectPipelineNodes(graph, {
        source: "history",
        target: "second",
        targetPort: "history",
      }),
    ).toBeNull();
    expect(
      issueCodes(() => connectPipelineNodes(graph, { source: "second", target: "first" })),
    ).toEqual(["cycle"]);
  });
});

describe("pipeline deterministic compilation", () => {
  it("follows explicit edge order, preserving nested separators and deduplicating raw documents", () => {
    let graph = pipeline(
      [
        node("doc", "document", { sourceId: "resume" }),
        node("folder", "folder", { sourceId: "folder", separator: " | " }),
        node("pre", "text", { text: "PRE" }),
        node("merge", "llm", { enabled: false, separator: " :: " }),
        node("out", "output", { separator: " / " }),
      ],
      [
        ["doc", "merge"],
        ["folder", "merge"],
        ["merge", "out"],
        ["pre", "out"],
      ],
    );
    graph = {
      ...graph,
      edges: graph.edges
        .map((edge) =>
          edge.source === "pre"
            ? { ...edge, order: 0 }
            : edge.source === "merge"
              ? { ...edge, order: 1 }
              : edge,
        )
        .reverse(),
    };
    const preview = previewPipeline(graph, input());
    expect(preview.complete).toBe(true);
    expect(preview.text.startsWith("PRE / ")).toBe(true);
    expect(preview.text.match(/Engineer\./g)).toHaveLength(1);
    expect(preview.text).toContain(" :: ");
    expect(preview.text).toContain("Frontend engineer");
    expect(preview.text).not.toContain("keywords");
    expect(preview.keywordSources.join(" ")).toContain("TypeScript");
    const rearranged = {
      ...graph,
      nodes: [...graph.nodes].reverse().map((item) => ({ ...item, position: { x: 500, y: 900 } })),
    };
    expect(previewPipeline(rearranged, input()).text).toBe(preview.text);
  });

  it("resolves live folder membership on each run while pinned lists keep explicit order", () => {
    const live = pipeline(
      [node("folder", "folder", { sourceId: "folder" }), node("out", "output")],
      [["folder", "out"]],
    );
    const pinned = updatePipelineNode(live, "folder", { folderDocIds: ["role", "resume"] });
    const data = input();
    data.library.docs.push({ id: "new", name: "New", text: "New information", folderId: "folder" });
    expect(previewPipeline(live, data).text).toContain("New information");
    const preview = previewPipeline(pinned, data);
    expect(preview.text).not.toContain("New information");
    expect(preview.text.indexOf("Frontend")).toBeLessThan(preview.text.indexOf("Engineer."));
    const moved = data.library.docs.find((doc) => doc.id === "resume");
    if (moved) moved.folderId = "";
    expect(previewPipeline(live, data).text).not.toContain("Engineer.");
    expect(previewPipeline(pinned, data).text).toContain("Engineer.");
  });

  it("reports missing reachable sources and ignores unconnected incomplete nodes", () => {
    const graph = pipeline(
      [
        node("doc", "document", { sourceId: "gone" }),
        node("out", "output"),
        node("unused", "preset"),
      ],
      [["doc", "out"]],
    );
    expect(validatePipeline(graph, input()).map((issue) => issue.code)).toEqual([
      "missing-document",
    ]);
    const fixed = updatePipelineNode(graph, "doc", { sourceId: "resume" });
    expect(validatePipeline(fixed, input())).toEqual([]);
    const preview = previewPipeline(fixed, input());
    expect(preview.nodes.find((item) => item.nodeId === "unused")?.status).toBe("skipped");
    expect(
      validatePipeline(
        updatePipelineNode(fixed, "doc", { kind: "folder", sourceId: "gone" }),
        input(),
      )[0]?.code,
    ).toBe("missing-folder");
    expect(
      validatePipeline(
        updatePipelineNode(fixed, "doc", { kind: "preset", sourceId: "gone" }),
        input(),
      )[0]?.code,
    ).toBe("missing-preset");
  });

  it("static preview declares unresolved model steps without fabricating output", () => {
    const graph = createPipeline("message");
    const preview = previewPipeline(graph, input());
    expect(preview.complete).toBe(false);
    expect(preview.text).toBe("");
    expect(preview.unresolvedNodeIds).toEqual(
      graph.nodes.filter((item) => item.kind === "llm").map((item) => item.id),
    );
    expect(
      preview.nodes.find(
        (item) => item.nodeId === graph.nodes.find((item) => item.kind === "output")?.id,
      )?.status,
    ).toBe("waiting");
  });
});

describe("pipeline model execution", () => {
  it("keeps a pending preparation visibly unresolved and blocks paid execution until it is ready", async () => {
    const graph = createPipeline("message");
    const data = {
      ...input(),
      chatContext: "Old context that must not be reused",
      chatContextPending: true,
    };
    const preview = previewPipeline(graph, data);
    expect(preview.issues).toEqual([]);
    expect(preview.complete).toBe(false);
    expect(preview.nodes.find((item) => item.request)?.requestComplete).toBe(false);
    expect(preview.nodes.find((item) => item.request)?.request?.system).toBe("");
    const contextId = graph.nodes.find((item) => item.kind === "chatContext")?.id;
    expect(preview.unresolvedNodeIds).toContain(contextId);
    const options = executionOptions();
    expect(await rejectedCodes(executePipeline(graph, data, options))).toEqual(["context-pending"]);
    expect(options.callModel).not.toHaveBeenCalled();
    const prepared = { ...data, chatContext: "Prepared instruction", chatContextPending: false };
    expect(
      previewPipeline(graph, prepared).nodes.find((item) => item.request)?.requestComplete,
    ).toBe(true);
    await executePipeline(graph, prepared, options);
    expect(options.callModel.mock.calls[0]?.[0].system).toBe("Prepared instruction");
    const disconnected = pipeline(
      [
        node("source", "text", { text: "Independent" }),
        node("out", "output"),
        node("context", "chatContext"),
      ],
      [["source", "out"]],
    );
    await expect(executePipeline(disconnected, data, executionOptions())).resolves.toMatchObject({
      text: "Independent",
    });
  });

  it("previews the exact ordered request and exposes it during and after execution", async () => {
    const data = input();
    data.message = {
      role: "user",
      text: "Current question",
      images: [{ media_type: "image/png", data: "current-image" }],
    };
    data.history = [
      {
        role: "user",
        text: "Earlier question",
        images: [{ media_type: "image/png", data: "earlier-image" }],
      },
      { role: "assistant", text: "Earlier answer", images: [] },
    ];
    const graph = pipeline(
      [
        node("preset", "preset", { sourceId: "preset" }),
        node("rules", "text", { text: "Use bullet points. [keywords]: [Rust]" }),
        node("material", "text", { text: "Supporting facts" }),
        node("message", "message"),
        node("history", "history"),
        node("merge", "llm", { enabled: false, separator: "\n---\n" }),
        node("llm", "llm", {
          text: "Return a short answer.",
          model: "selected-model",
          thinking: true,
        }),
        node("out", "output"),
      ],
      [
        ["rules", "llm", "system"],
        ["preset", "llm", "system"],
        ["material", "merge"],
        ["message", "merge"],
        ["merge", "llm"],
        ["history", "llm", "history"],
        ["llm", "out"],
      ],
    );
    const preview = previewPipeline(graph, data);
    const expectedRequest = {
      nodeId: "llm",
      model: "selected-model",
      options: { thinking: true, webSearch: false },
      system: "Use bullet points.\n\nBe concise.\n\nReturn a short answer.",
      messages: [
        ...data.history,
        { ...data.message, text: "Supporting facts\n---\nCurrent question" },
      ],
    };
    expect(preview.nodes.find((item) => item.nodeId === "llm")).toMatchObject({
      status: "waiting",
      text: "",
      requestComplete: true,
      request: expectedRequest,
    });
    expect(preview.complete).toBe(false);
    expect(preview.text).toBe("");
    const updates: PipelineNodeResult[] = [];
    const options = executionOptions();
    const result = await executePipeline(graph, data, {
      ...options,
      onNode: (update) => {
        updates.push(structuredClone(update));
        // An inspector receives its own snapshot, not the transport's live object.
        if (update.request) update.request.system = "Callback mutation";
      },
    });
    expect(options.callModel).toHaveBeenCalledWith(expectedRequest);
    expect(updates).toContainEqual(
      expect.objectContaining({
        nodeId: "llm",
        status: "running",
        request: expectedRequest,
        requestComplete: true,
      }),
    );
    expect(result.nodes.find((item) => item.nodeId === "llm")).toMatchObject({
      status: "complete",
      request: expectedRequest,
      requestComplete: true,
    });
  });

  it("labels a downstream request partial until its model ancestor resolves without inventing user material", async () => {
    const graph = pipeline(
      [
        node("source", "text", { text: "Original material" }),
        node("first", "llm"),
        node("system", "text", { text: "Known system instruction" }),
        node("second", "llm"),
        node("out", "output"),
      ],
      [
        ["source", "first"],
        ["first", "second"],
        ["system", "second", "system"],
        ["second", "out"],
      ],
    );
    const preview = previewPipeline(graph, input());
    expect(preview.issues).toEqual([]);
    expect(preview.nodes.find((item) => item.nodeId === "first")?.requestComplete).toBe(true);
    expect(preview.nodes.find((item) => item.nodeId === "second")).toMatchObject({
      requestComplete: false,
      text: "",
      request: {
        system: "Known system instruction",
        messages: [{ role: "user", text: "", images: [] }],
      },
    });
    const callModel = vi
      .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
      .mockResolvedValueOnce("Real first result")
      .mockRejectedValueOnce(new Error("Second model failed"));
    const onNode = vi.fn();
    await expect(
      executePipeline(graph, input(), { ...executionOptions(callModel), onNode }),
    ).rejects.toThrow("Second model failed");
    expect(onNode).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "second",
        status: "error",
        requestComplete: true,
        request: {
          nodeId: "second",
          system: "Known system instruction",
          model: "test-model",
          options: { thinking: false, webSearch: false },
          messages: [{ role: "user", text: "Real first result", images: [] }],
        },
      }),
    );
  });

  it("executes shared ancestors once while retaining distinct model rewrites of the same document", async () => {
    const graph = pipeline(
      [
        node("doc", "document", { sourceId: "resume" }),
        node("shared", "llm"),
        node("a", "llm", { text: "First" }),
        node("b", "llm", { text: "Second" }),
        node("out", "output"),
        node("unused", "llm"),
      ],
      [
        ["doc", "shared"],
        ["shared", "a"],
        ["shared", "b"],
        ["a", "out"],
        ["b", "out"],
      ],
    );
    const callModel = vi
      .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
      .mockImplementation(async ({ nodeId }) => Promise.resolve(`result-${nodeId}`));
    const result = await executePipeline(graph, input(), executionOptions(callModel));
    expect(callModel.mock.calls.map(([request]) => request.nodeId)).toEqual(["shared", "a", "b"]);
    expect(result.text).toBe("result-a\n\nresult-b");
    expect(result.nodes.find((item) => item.nodeId === "unused")?.status).toBe("skipped");
    expect(result.keywordSources.filter((text) => text.includes("TypeScript"))).toHaveLength(1);
  });

  it("bypasses a disabled model using input only and never executes its system-only dependency", async () => {
    const graph = pipeline(
      [
        node("source", "text", { text: "Original" }),
        node("expensive", "llm"),
        node("bypass", "llm", { enabled: false, text: "Must not appear" }),
        node("out", "output"),
      ],
      [
        ["source", "expensive"],
        ["source", "bypass"],
        ["expensive", "bypass", "system"],
        ["bypass", "out"],
      ],
    );
    const options = executionOptions();
    const result = await executePipeline(graph, input(), options);
    expect(options.callModel).not.toHaveBeenCalled();
    expect(result.text).toBe("Original");
    expect(
      result.nodes.filter((item) => item.status === "skipped").map((item) => item.nodeId),
    ).toEqual(["expensive", "bypass"]);
  });

  it("sends typed history exactly once before the current message and preserves images/model options", async () => {
    const graph = createPipeline("message");
    const data = input();
    if (data.message) data.message.images.push({ media_type: "image/png", data: "base64-image" });
    const model = graph.nodes.find((item) => item.kind === "llm");
    const configured = updatePipelineNode(graph, model?.id ?? "", {
      text: "Formatting instructions [keywords]: [gRPC]",
      thinking: true,
      webSearch: true,
    });
    const options = executionOptions();
    const result = await executePipeline(configured, data, options);
    const request = options.callModel.mock.calls[0]?.[0];
    expect(request?.messages).toEqual([...data.history, data.message]);
    expect(request?.system).toBe("You are an engineering coach.\n\nFormatting instructions");
    expect(request?.options).toEqual({ thinking: true, webSearch: true });
    expect(request?.model).toBe("test-model");
    expect(result.text).toBe("model answer");
    expect(result.keywordSources.join(" ")).toContain("gRPC");
  });

  it("carries images through merges and rejects text-only output/system paths before making calls", async () => {
    const data = input();
    if (data.message) data.message.images = [{ media_type: "image/png", data: "image" }];
    const nodes = [
      node("message", "message"),
      node("merge", "llm", { enabled: false }),
      node("llm", "llm"),
      node("out", "output"),
    ];
    const valid = pipeline(nodes, [
      ["message", "merge"],
      ["merge", "llm"],
      ["llm", "out"],
    ]);
    const options = executionOptions();
    await executePipeline(valid, data, options);
    expect(options.callModel.mock.calls[0]?.[0].messages.at(-1)?.images).toEqual(
      data.message?.images,
    );
    const badOutput = connectPipelineNodes(valid, { source: "message", target: "out" });
    const badSystem = connectPipelineNodes(valid, {
      source: "message",
      target: "llm",
      targetPort: "system",
    });
    options.callModel.mockClear();
    for (const bad of [badOutput, badSystem]) {
      expect(
        previewPipeline(bad, data).issues.some((issue) => issue.code === "unconsumed-images"),
      ).toBe(true);
      expect(await rejectedCodes(executePipeline(bad, data, options))).toContain(
        "unconsumed-images",
      );
    }
    expect(options.callModel).not.toHaveBeenCalled();
  });

  it("reads one snapshot even when graph, library and request history change during a call", async () => {
    const data = input();
    const graph = pipeline(
      [
        node("message", "message"),
        node("first", "llm"),
        node("doc", "document", { sourceId: "role" }),
        node("second", "llm"),
        node("out", "output"),
      ],
      [
        ["message", "first"],
        ["first", "second"],
        ["doc", "second"],
        ["second", "out"],
      ],
    );
    const callModel = vi
      .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
      .mockImplementation(async ({ nodeId }) => {
        if (nodeId === "first") {
          const doc = data.library.docs.find((item) => item.id === "role");
          if (doc) doc.text = "CHANGED";
          const second = graph.nodes.find((item) => item.id === "second");
          if (second) second.text = "CHANGED";
        }
        return Promise.resolve("step output");
      });
    await executePipeline(graph, data, executionOptions(callModel));
    expect(callModel.mock.calls[1]?.[0].messages[0]?.text).toContain("Frontend engineer");
    expect(JSON.stringify(callModel.mock.calls[1]?.[0])).not.toContain("CHANGED");
  });

  it("cancels an in-flight request promptly without committing its late result or executing descendants", async () => {
    const graph = pipeline(
      [
        node("text", "text", { text: "Input" }),
        node("first", "llm"),
        node("next", "llm"),
        node("out", "output"),
      ],
      [
        ["text", "first"],
        ["first", "next"],
        ["next", "out"],
      ],
    );
    const controller = new AbortController();
    let finish: ((value: string) => void) | undefined;
    const pending = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const callModel = vi
      .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
      .mockReturnValue(pending);
    const updates: PipelineNodeResult[] = [];
    const run = executePipeline(graph, input(), {
      signal: controller.signal,
      callModel,
      onNode: (result) => updates.push(result),
    });
    expect(callModel).toHaveBeenCalledOnce();
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    finish?.("late answer");
    await Promise.resolve();
    expect(callModel).toHaveBeenCalledOnce();
    expect(
      updates.some((result) => result.nodeId === "first" && result.status === "complete"),
    ).toBe(false);
    expect(
      updates.filter((result) => result.status === "cancelled").map((result) => result.nodeId),
    ).toEqual(["first", "next", "out"]);
  });

  it("stops on failure and reports the failing node without starting its children", async () => {
    const graph = createPipeline("message");
    const options = executionOptions(
      vi
        .fn<Parameters<typeof executePipeline>[2]["callModel"]>()
        .mockRejectedValue(new Error("provider unavailable")),
    );
    const onNode = vi.fn();
    await expect(executePipeline(graph, input(), { ...options, onNode })).rejects.toThrow(
      "provider unavailable",
    );
    expect(onNode).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "provider unavailable" }),
    );
    expect(onNode).not.toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: graph.nodes.find((item) => item.kind === "output")?.id,
        status: "complete",
      }),
    );
  });
});

describe("pipeline semantic fingerprint", () => {
  it("preserves raw recognition metadata through prepared contexts and unresolved model steps", async () => {
    const graph = createPipeline("message");
    const data = {
      ...input(),
      chatContext: "Prepared instruction without recognizer directives",
      chatContextKeywordSources: [
        "Original preset [keywords]: [Kubernetes]",
        "Original document [keywords]: [gRPC]",
      ],
    };
    const preview = previewPipeline(graph, data);
    expect(preview.complete).toBe(false);
    expect(preview.keywordSources).toEqual(expect.arrayContaining(data.chatContextKeywordSources));
    const options = executionOptions();
    const result = await executePipeline(graph, data, options);
    expect(options.callModel.mock.calls[0]?.[0].system).toBe(data.chatContext);
    expect(result.keywordSources).toEqual(expect.arrayContaining(data.chatContextKeywordSources));
    expect(result.text).not.toContain("keywords");
    expect(semanticPipelineFingerprint(graph, data)).not.toBe(
      semanticPipelineFingerprint(graph, { ...data, chatContextKeywordSources: [] }),
    );
    const independent = pipeline(
      [
        node("text", "text", { text: "Unrelated instruction" }),
        node("out", "output"),
        node("context", "chatContext"),
      ],
      [["text", "out"]],
    );
    expect(previewPipeline(independent, data).keywordSources).not.toEqual(
      expect.arrayContaining(data.chatContextKeywordSources),
    );
  });

  it("keeps native typed error messages readable in per-node diagnostics", async () => {
    const graph = createPipeline("message");
    const nativeError = { code: "network", message: "Connection lost" };
    const options = executionOptions(
      vi.fn<Parameters<typeof executePipeline>[2]["callModel"]>().mockRejectedValue(nativeError),
    );
    const onNode = vi.fn();
    await expect(executePipeline(graph, input(), { ...options, onNode })).rejects.toBe(nativeError);
    expect(onNode).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error: "Connection lost" }),
    );
  });

  it("ignores layout, card names and unrelated sources but invalidates referenced source changes", () => {
    const graph = pipeline(
      [
        node("folder", "folder", { sourceId: "folder" }),
        node("out", "output"),
        node("unused", "text"),
      ],
      [["folder", "out"]],
    );
    const data = input();
    const initial = semanticPipelineFingerprint(graph, data);
    const rearranged = {
      ...graph,
      name: "Renamed",
      nodes: [...graph.nodes]
        .reverse()
        .map((item) => ({ ...item, name: "New label", position: { x: 300, y: 400 } })),
    };
    expect(semanticPipelineFingerprint(rearranged, data)).toBe(initial);
    data.history.push({ role: "user", text: "unused", images: [] });
    data.library.docs.push({
      id: "unrelated",
      name: "Unrelated",
      text: "Not included",
      folderId: "",
    });
    expect(semanticPipelineFingerprint(graph, data)).toBe(initial);
    data.library.docs.push({ id: "added", name: "Added", text: "Included", folderId: "folder" });
    expect(semanticPipelineFingerprint(graph, data)).not.toBe(initial);
  });

  it("tracks inherited model, selected settings, history and referenced folder existence", () => {
    const graph = createPipeline("message");
    const data = input();
    const initial = semanticPipelineFingerprint(graph, data);
    expect(semanticPipelineFingerprint(graph, { ...data, model: "another-model" })).not.toBe(
      initial,
    );
    expect(semanticPipelineFingerprint(graph, { ...data, history: [] })).not.toBe(initial);
    const folder = pipeline(
      [
        node("folder", "folder", { sourceId: "folder", folderDocIds: ["role"] }),
        node("out", "output"),
      ],
      [["folder", "out"]],
    );
    expect(
      semanticPipelineFingerprint(folder, { ...data, library: { ...data.library, folders: [] } }),
    ).not.toBe(semanticPipelineFingerprint(folder, data));
  });
});

describe("pipeline lookup and inputs", () => {
  it("finds a pipeline only by id and kind together, and lists one kind in library order", () => {
    const prompt = { ...createPipeline("prompt", "Prepare"), id: "prepare" };
    const answer = { ...createPipeline("message", "Answer"), id: "answer" };
    const pipelines = [answer, prompt];
    expect(findPipeline(pipelines, "prepare", "prompt")).toBe(prompt);
    expect(findPipeline(pipelines, "prepare", "message")).toBeUndefined();
    expect(findPipeline(pipelines, undefined, "prompt")).toBeUndefined();
    expect(findPipeline(pipelines, "", "prompt")).toBeUndefined();
    expect(pipelinesOfKind([...pipelines, prompt], "prompt")).toEqual([prompt, prompt]);
    expect(pipelinesOfKind(pipelines, "message")).toEqual([answer]);
  });

  it("builds a message-less input and attaches a prepared or pending chat context", () => {
    const base = input();
    const built = pipelineInput({ library: base.library, presets: base.presets, model: "m" });
    expect(built).toEqual({
      library: base.library,
      presets: base.presets,
      message: null,
      history: [],
      chatContext: "",
      model: "m",
      options: { thinking: false, webSearch: false },
    });
    expect(
      pipelineInput({ ...built, chatContext: "ctx", chatContextKeywordSources: ["raw"] }),
    ).toMatchObject({ chatContext: "ctx", chatContextKeywordSources: ["raw"] });
    const prepared = withPreparedContext(built, { text: "prepared", keywordSources: ["Kafka"] });
    expect(prepared).toMatchObject({
      chatContext: "prepared",
      chatContextPending: false,
      chatContextKeywordSources: ["Kafka"],
    });
    expect(withPreparedContext(built, undefined, ["from preview"])).toMatchObject({
      chatContext: "",
      chatContextPending: true,
      chatContextKeywordSources: ["from preview"],
    });
  });
});

describe("pipeline edits", () => {
  it("orders incoming connections by order and then by id, and moves them one step at a time", () => {
    const graph = pipeline(
      [node("a", "text", { text: "A" }), node("b", "text", { text: "B" }), node("out", "output")],
      [
        ["b", "out"],
        ["a", "out"],
      ],
    );
    const tie = { ...graph, edges: graph.edges.map((edge) => ({ ...edge, order: 0 })) };
    expect(incomingEdges(tie, "out").map((edge) => edge.id)).toEqual(["edge-0", "edge-1"]);
    expect(incomingEdges(graph, "out").map((edge) => edge.source)).toEqual(["b", "a"]);
    const swapped = movePipelineEdge(graph, "edge-1", -1);
    expect(incomingEdges(swapped, "out").map((edge) => edge.source)).toEqual(["a", "b"]);
    expect(incomingEdges(swapped, "out").map((edge) => edge.order)).toEqual([0, 1]);
    expect(movePipelineEdge(graph, "edge-0", -1)).toBe(graph);
    expect(movePipelineEdge(graph, "edge-1", 1)).toBe(graph);
    expect(movePipelineEdge(graph, "missing", 1)).toBe(graph);
  });

  it("moves only the listed cards and removes nodes together with their connections", () => {
    const graph = pipeline(
      [node("a", "text", { text: "A" }), node("b", "text", { text: "B" }), node("out", "output")],
      [
        ["a", "out"],
        ["b", "out"],
      ],
    );
    expect(movePipelineNodes(graph, new Map())).toBe(graph);
    const moved = movePipelineNodes(graph, new Map([["a", { x: 10, y: 20 }]]));
    expect(moved.nodes.find((item) => item.id === "a")?.position).toEqual({ x: 10, y: 20 });
    expect(moved.nodes.find((item) => item.id === "b")?.position).toEqual({ x: 0, y: 0 });
    const trimmed = removePipelineItems(graph, { nodeIds: ["a"], edgeIds: ["edge-1"] });
    expect(trimmed.nodes.map((item) => item.id)).toEqual(["b", "out"]);
    expect(trimmed.edges).toEqual([]);
    expect(removePipelineNode(graph, "b").edges.map((edge) => edge.source)).toEqual(["a"]);
  });
});
