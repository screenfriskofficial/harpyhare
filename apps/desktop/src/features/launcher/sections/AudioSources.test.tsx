import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionsApi } from "@/hooks/usePermissions";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";
import type { SetSetting } from "../contract";
import { AudioSources } from "./AudioSources";

function renderSources(overrides: Partial<Settings> = {}) {
  const set = vi.fn<SetSetting>();
  const permissions: PermissionsApi = {
    status: { audio: "granted", microphone: "unknown", screen: "unknown" },
    loaded: true,
    audioOk: true,
    microphoneOk: false,
    screenOk: false,
    allOk: false,
    needsAttention: false,
    pending: null,
    request: vi.fn(() => Promise.resolve()),
    refresh: vi.fn(() => Promise.resolve()),
    openSettings: vi.fn(),
  };
  render(
    <AudioSources
      draft={{ ...DEFAULT_SETTINGS, ...overrides }}
      set={set}
      permissions={permissions}
    />,
  );
  return { set, permissions };
}

afterEach(cleanup);

describe("audio source controls", () => {
  it("keeps the microphone off until explicitly selected", () => {
    const { set, permissions } = renderSources();
    expect(
      screen.getByRole("switch", { name: "Я — мой микрофон" }).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.queryByText("Выдать")).toBeNull();
    expect(permissions.request).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("switch", { name: "Я — мой микрофон" }));
    expect(set).toHaveBeenCalledWith("capture_microphone", true);
    expect(permissions.request).not.toHaveBeenCalled();
  });
  it("can disable system audio independently of the microphone", () => {
    const { set } = renderSources({ capture_microphone: true });
    fireEvent.click(screen.getByRole("switch", { name: "Собеседующий — системный звук" }));
    expect(set.mock.calls).toEqual([["capture_system_audio", false]]);
  });
  it("requests only microphone permission from its explicit button", () => {
    const { permissions } = renderSources({ capture_microphone: true });
    fireEvent.click(screen.getByText("Выдать"));
    expect(permissions.request).toHaveBeenCalledWith("microphone");
  });
  it("explains why recording is unavailable with both switches off", () => {
    renderSources({ capture_system_audio: false, capture_microphone: false });
    expect(screen.getByRole("alert").textContent).toBe("Включите хотя бы один источник звука");
  });
});
