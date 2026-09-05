import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioDevices } from "@/ipc/bindings";
import { DEFAULT_SETTINGS, type Settings } from "@/ipc/types";
import { queryKeys } from "@/lib/query-client";
import type { SetSetting } from "../contract";
import { AudioRouting } from "./AudioRouting";

const { listDevices } = vi.hoisted(() => ({ listDevices: vi.fn<() => Promise<AudioDevices>>() }));
vi.mock("@/ipc/commands", () => ({ listAudioDevices: listDevices }));
vi.mock("@/components/ui/select", () => ({
  SelectItem: ({
    children,
    ...props
  }: {
    children: ReactNode;
    value: string;
    disabled?: boolean;
  }) => <option {...props}>{children}</option>,
}));
vi.mock("../fields", () => ({
  SettingRow: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SettingSelect: ({
    children,
    ariaLabel,
    onValueChange,
    ...props
  }: {
    children: ReactNode;
    ariaLabel: string;
    value: string;
    disabled: boolean;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label={ariaLabel}
      {...props}
      onChange={(event) => {
        onValueChange(event.target.value);
      }}
    >
      {children}
    </select>
  ),
}));

const DEVICES: AudioDevices = {
  outputs: [
    { uid: "airpods-output", name: "AirPods Max", is_default: true },
    { uid: "vb-output", name: "VB-Cable", is_default: false },
  ],
  inputs: [
    { uid: "airpods-input", name: "AirPods Max", is_default: true },
    { uid: "shure-input", name: "Shure MV7+", is_default: false },
  ],
};

function setup(settings: Partial<Settings> = {}) {
  const set = vi.fn<SetSetting>();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AudioRouting
        draft={{ ...DEFAULT_SETTINGS, capture_microphone: true, ...settings }}
        set={set}
      />
    </QueryClientProvider>,
  );
  return { set, client };
}

beforeEach(() => {
  listDevices.mockResolvedValue(DEVICES);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("explicit audio routing", () => {
  it("lets the user select output and microphone independently, without auto-selecting", async () => {
    const { set } = setup();
    await screen.findByRole("option", { name: "Shure MV7+" });
    expect(set).not.toHaveBeenCalled();
    const output = screen.getByRole<HTMLSelectElement>("combobox", { name: "Выход собеседника" });
    const microphone = screen.getByRole("combobox", { name: "Устройство моего микрофона" });
    fireEvent.change(output, { target: { value: "airpods-output" } });
    fireEvent.change(microphone, { target: { value: "shure-input" } });
    expect(set.mock.calls).toEqual([
      ["capture_device_uid", "airpods-output"],
      ["microphone_device_uid", "shure-input"],
    ]);
    expect(output.textContent).not.toContain("Shure MV7+");
    expect(microphone.textContent).not.toContain("VB-Cable");
    expect(screen.getAllByText("Системный по умолчанию — AirPods Max")).toHaveLength(2);
  });

  it("keeps missing saved devices selected until the user chooses a replacement", async () => {
    const { set, client } = setup({
      capture_device_uid: "missing-output",
      microphone_device_uid: "shure-input",
    });
    await screen.findByRole("alert");
    const output = screen.getByRole<HTMLSelectElement>("combobox", { name: "Выход собеседника" });
    expect(output.value).toBe("missing-output");
    expect(set).not.toHaveBeenCalled();
    listDevices.mockResolvedValue({
      ...DEVICES,
      outputs: [
        ...DEVICES.outputs,
        { uid: "missing-output", name: "Reconnected output", is_default: false },
      ],
    });
    await client.invalidateQueries({ queryKey: queryKeys.audioDevices });
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    expect(output.value).toBe("missing-output");
    expect(set).not.toHaveBeenCalled();
  });

  it("uses system default only when the user chooses that option", async () => {
    const { set } = setup({
      capture_device_uid: "vb-output",
      microphone_device_uid: "shure-input",
    });
    await screen.findByRole("option", { name: "Shure MV7+" });
    fireEvent.change(screen.getByRole("combobox", { name: "Устройство моего микрофона" }), {
      target: { value: "system-default" },
    });
    expect(set.mock.calls).toEqual([["microphone_device_uid", ""]]);
  });

  it("shows only the enabled source and leaves the disabled microphone selection untouched", async () => {
    const { set } = setup({ capture_microphone: false, microphone_device_uid: "shure-input" });
    await screen.findByRole("option", { name: "VB-Cable" });
    expect(screen.getAllByRole("combobox")).toHaveLength(1);
    expect(screen.queryByRole("option", { name: "Shure MV7+" })).toBeNull();
    expect(set).not.toHaveBeenCalled();
  });

  it("does not replace selections when device discovery fails", async () => {
    listDevices.mockRejectedValue(new Error("HAL unavailable"));
    const { set } = setup({ microphone_device_uid: "shure-input" });
    await screen.findByRole("alert");
    expect(set).not.toHaveBeenCalled();
    expect(screen.getAllByRole("combobox").every((el) => (el as HTMLSelectElement).disabled)).toBe(
      true,
    );
  });
});
