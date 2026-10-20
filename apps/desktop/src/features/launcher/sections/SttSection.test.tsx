import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";
import type { PermissionsApi } from "@/hooks/usePermissions";
import { STT_PROVIDER_DEEPGRAM } from "@/test/providers";
import type { SetSetting } from "../contract";

vi.mock("./AudioRouting", () => ({ AudioRouting: () => null }));
vi.mock("./AudioSources", () => ({ AudioSources: () => null }));
import { SttSection } from "./SttSection";

afterEach(cleanup);

function setup(provider: string) {
  const set = vi.fn<SetSetting>();
  // Source controls are tested separately and do not participate in vendor selection.
  const permissions = {} as PermissionsApi;
  render(
    <SttSection
      draft={{ ...DEFAULT_SETTINGS, stt_provider: provider }}
      set={set}
      permissions={permissions}
    />,
  );
  return set;
}

describe("STT settings", () => {
  it("names the selected vendor and keeps the language choosable", () => {
    setup(STT_PROVIDER_DEEPGRAM);
    expect(screen.getByRole("combobox", { name: "Провайдер распознавания" }).textContent).toContain(
      "Deepgram",
    );
    const language = screen.getByRole("combobox", { name: "Язык распознавания" });
    expect(language.hasAttribute("disabled")).toBe(false);
  });

  it("has no translation toggle: the vendor offers no translation", () => {
    setup(STT_PROVIDER_DEEPGRAM);
    expect(screen.queryByRole("switch", { name: "Перевод на английский" })).toBeNull();
  });
});
