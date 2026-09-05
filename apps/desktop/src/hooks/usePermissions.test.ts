import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionKind, PermissionState, PermissionsStatus } from "@/ipc/bindings";

const permissionsStatus = vi.fn<() => Promise<PermissionsStatus>>();
const requestPermission = vi.fn<(kind: PermissionKind) => Promise<PermissionState>>();
const openPermissionSettings = vi.fn<(kind: PermissionKind) => Promise<void>>(() =>
  Promise.resolve(),
);

vi.mock("@/ipc/commands", () => ({
  permissionsStatus: () => permissionsStatus(),
  requestPermission: (kind: PermissionKind) => requestPermission(kind),
  openPermissionSettings: (kind: PermissionKind) => openPermissionSettings(kind),
}));

import { usePermissions } from "./usePermissions";

afterEach(() => {
  vi.clearAllMocks();
});

describe("usePermissions", () => {
  it("подтягивает статус на маунте и выводит производные флаги", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "unknown",
      audio: "granted",
      screen: "denied",
    });
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    expect(result.current.audioOk).toBe(true);
    expect(result.current.screenOk).toBe(false);
    expect(result.current.allOk).toBe(false);
  });

  it("request обновляет статус только запрошенного доступа", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "unknown",
      audio: "unknown",
      screen: "denied",
    });
    requestPermission.mockResolvedValue("granted");
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    await act(async () => {
      await result.current.request("audio");
    });
    expect(requestPermission).toHaveBeenCalledWith("audio");
    expect(result.current.status).toEqual({
      microphone: "unknown",
      audio: "granted",
      screen: "denied",
    });
    expect(result.current.pending).toBeNull();
  });

  it("pending держится, пока команда не ответила", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "unknown",
      audio: "unknown",
      screen: "unknown",
    });
    let resolveRequest: ((state: PermissionState) => void) | undefined;
    requestPermission.mockReturnValue(
      new Promise<PermissionState>((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });

    let pendingRequest: Promise<void> | undefined;
    act(() => {
      pendingRequest = result.current.request("screen");
    });
    await waitFor(() => {
      expect(result.current.pending).toBe("screen");
    });

    await act(async () => {
      resolveRequest?.("denied");
      await pendingRequest;
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.status.screen).toBe("denied");
  });
});
