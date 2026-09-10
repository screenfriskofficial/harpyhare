import { act, cleanup, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PermissionKind, PermissionState, PermissionsStatus } from "@/ipc/bindings";

const permissionsStatus = vi.fn<() => Promise<PermissionsStatus>>();
const requestPermission = vi.fn<(kind: PermissionKind) => Promise<PermissionState>>();
const openPermissionSettings = vi.fn<(kind: PermissionKind) => Promise<void>>(() =>
  Promise.resolve(),
);
const notify = vi.fn<(input: { variant: string; message: string }) => void>();
vi.mock("@/lib/notify", () => ({
  notify: (input: { variant: string; message: string }) => {
    notify(input);
  },
}));

vi.mock("@/ipc/commands", () => ({
  permissionsStatus: () => permissionsStatus(),
  requestPermission: (kind: PermissionKind) => requestPermission(kind),
  openPermissionSettings: (kind: PermissionKind) => openPermissionSettings(kind),
}));

import { usePermissions } from "./usePermissions";

afterEach(() => {
  cleanup();
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

  it("перечитывает доступ после возвращения из системных настроек", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "denied",
      audio: "granted",
      screen: "granted",
    });
    const { result, unmount } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    permissionsStatus.mockResolvedValue({
      microphone: "granted",
      audio: "granted",
      screen: "granted",
    });
    fireEvent.focus(window);
    await waitFor(() => {
      expect(result.current.microphoneOk).toBe(true);
    });
    unmount();
    permissionsStatus.mockClear();
    fireEvent.focus(window);
    expect(permissionsStatus).not.toHaveBeenCalled();
  });

  it("ошибка запроса видна пользователю и не блокирует повторную попытку", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "unknown",
      audio: "granted",
      screen: "granted",
    });
    requestPermission.mockRejectedValueOnce(new Error("native failure"));
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    await act(() => result.current.request("microphone"));
    expect(notify.mock.calls[0]?.[0].variant).toBe("error");
    expect(notify.mock.calls[0]?.[0].message).toContain("Не удалось запросить доступ");
    expect(result.current.pending).toBeNull();
    requestPermission.mockResolvedValueOnce("granted");
    await act(() => result.current.request("microphone"));
    expect(result.current.microphoneOk).toBe(true);
  });

  it("ошибки проверки и открытия настроек не теряются в rejected promise", async () => {
    permissionsStatus.mockRejectedValueOnce(new Error("unavailable"));
    openPermissionSettings.mockRejectedValueOnce(new Error("unavailable"));
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(notify).toHaveBeenCalledTimes(1);
    });
    expect(result.current.loaded).toBe(false);
    act(() => {
      result.current.openSettings("microphone");
    });
    await waitFor(() => {
      expect(notify).toHaveBeenCalledTimes(2);
    });
  });

  it("устаревшая проверка не отменяет выданный доступ, двойной клик не дублирует запрос", async () => {
    permissionsStatus.mockResolvedValue({
      microphone: "unknown",
      audio: "granted",
      screen: "granted",
    });
    const { result } = renderHook(() => usePermissions());
    await waitFor(() => {
      expect(result.current.loaded).toBe(true);
    });
    let resolveStatus!: (status: PermissionsStatus) => void;
    permissionsStatus.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveStatus = resolve;
      }),
    );
    fireEvent.focus(window);
    requestPermission.mockResolvedValueOnce("granted");
    await act(async () => {
      await Promise.all([
        result.current.request("microphone"),
        result.current.request("microphone"),
      ]);
      resolveStatus({ microphone: "unknown", audio: "granted", screen: "granted" });
    });
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(result.current.microphoneOk).toBe(true);
  });
});
