import { renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/ipc/types";

const status = vi.hoisted(() => ({ loaded: true, audioOk: false, microphoneOk: false }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => status }));
import { useLauncherReadiness } from "./useLauncherReadiness";

beforeEach(() => {
  status.audioOk = false;
  status.microphoneOk = false;
});

it.each([
  [true, false, true, false, true],
  [false, true, false, true, true],
  [true, true, true, false, false],
  [true, true, true, true, true],
  [false, false, true, true, false],
])(
  "gates selected sources (%s, %s) by their own permissions",
  (system, microphone, audioOk, microphoneOk, ready) => {
    status.audioOk = audioOk;
    status.microphoneOk = microphoneOk;
    const { result } = renderHook(() =>
      useLauncherReadiness({
        ...DEFAULT_SETTINGS,
        access_token: "test-access",
        capture_system_audio: system,
        capture_microphone: microphone,
      }),
    );
    expect(result.current.ready).toBe(ready);
  },
);
