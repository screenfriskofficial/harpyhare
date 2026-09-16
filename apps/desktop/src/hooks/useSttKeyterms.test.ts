import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const setSttKeyterms = vi.fn<(terms: string[]) => Promise<void>>(() => Promise.resolve());
vi.mock("@/ipc/commands", () => ({
  setSttKeyterms: (terms: string[]) => setSttKeyterms(terms),
}));

import { useSttKeyterms } from "./useSttKeyterms";

beforeEach(() => {
  setSttKeyterms.mockClear();
});

describe("useSttKeyterms", () => {
  it("передаёт многословные термины целиком и не шлёт повтор за тот же список", () => {
    const { rerender } = renderHook(
      ({ terms }) => {
        useSttKeyterms(terms);
      },
      {
        initialProps: { terms: ["Apache Kafka", "gRPC"] },
      },
    );
    expect(setSttKeyterms).toHaveBeenCalledTimes(1);
    expect(setSttKeyterms).toHaveBeenCalledWith(["Apache Kafka", "gRPC"]);
    rerender({ terms: ["Apache Kafka", "gRPC"] });
    expect(setSttKeyterms).toHaveBeenCalledTimes(1);
    rerender({ terms: ["gRPC"] });
    expect(setSttKeyterms).toHaveBeenLastCalledWith(["gRPC"]);
    rerender({ terms: [] });
    expect(setSttKeyterms).toHaveBeenLastCalledWith([]);
  });
});
