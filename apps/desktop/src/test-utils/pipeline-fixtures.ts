import type { PipelineInput } from "@/lib/pipeline-types";

export const FIXTURE_MODEL = "test-model";

/** A pipeline input with nothing in it; a test overrides only the parts it exercises. */
export function pipelineInputFixture(overrides: Partial<PipelineInput> = {}): PipelineInput {
  return {
    library: { folders: [], docs: [] },
    presets: [],
    message: null,
    history: [],
    chatContext: "",
    model: FIXTURE_MODEL,
    options: { thinking: false, webSearch: false },
    ...overrides,
  };
}
