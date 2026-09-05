import { describe, expect, it, vi } from "vitest";
import type { SttModelsState } from "@/hooks/useSttModels";
import { sttModelOptions } from "./stt-models";

const catalog: SttModelsState = {
  models: [
    { id: "vendor/a", name: "A" },
    { id: "vendor/b", name: "B" },
  ],
  pending: false,
  failed: false,
  loaded: true,
  refresh: vi.fn(),
};

describe("STT model options", () => {
  it("puts the selected model first without duplicating it", () => {
    expect(sttModelOptions(catalog, "vendor/b").map((m) => m.value)).toEqual([
      "vendor/b",
      "vendor/a",
    ]);
  });
  it("retains a saved model through network failure and marks a removed model unavailable", () => {
    const offline = { ...catalog, models: [], loaded: false, failed: true };
    expect(sttModelOptions(offline, "vendor/saved")[0]).toMatchObject({
      value: "vendor/saved",
      disabled: false,
    });
    expect(sttModelOptions(catalog, "vendor/saved")[0]).toMatchObject({
      value: "vendor/saved",
      disabled: true,
    });
  });
});
