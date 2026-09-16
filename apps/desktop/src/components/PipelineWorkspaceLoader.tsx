import { lazyPanel } from "@/components/lazy-panel";

/** The editor and React Flow join the launcher bundle only when the pipelines screen opens. */
export const PipelineWorkspaceLoader = lazyPanel(
  async () => ({ default: (await import("./PipelineWorkspace")).PipelineWorkspace }),
  "pipelines.workspace.loadingBuilder",
);
