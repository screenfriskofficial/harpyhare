import { describe, expect, it } from "vitest";
import type { RequestOptions } from "@/lib/chats";
import type { AppError } from "@/lib/errors";
import type { ModelInfo } from "@/lib/models";
import type { PromptPreset } from "@/lib/presets";
import type * as Rust from "./bindings";
import type {
  AudioOutputDevice,
  EventMap,
  IdentityInfo,
  PluginSetting,
  RecorderState,
  Settings,
  UpdateInfo,
} from "./types";

type Loosened<T> = { [K in keyof T]-?: Exclude<T[K], null> };

type SameShape<Ours, Generated> = [Ours] extends [Generated]
  ? [Loosened<Generated>] extends [Ours]
    ? true
    : never
  : never;

const contract = {
  Settings: true satisfies SameShape<Settings, Rust.Settings>,
  OutputDeviceInfo: true satisfies SameShape<AudioOutputDevice, Rust.OutputDeviceInfo>,
  IdentityInfo: true satisfies SameShape<IdentityInfo, Rust.IdentityInfo>,
  UpdateInfo: true satisfies SameShape<UpdateInfo, Rust.UpdateInfo>,
  RecorderState: true satisfies SameShape<RecorderState, Rust.RecorderState>,
  PromptPreset: true satisfies SameShape<PromptPreset, Rust.PromptPreset>,
  PluginSetting: true satisfies SameShape<PluginSetting, Rust.PluginSetting>,
  AppError: true satisfies SameShape<AppError, Rust.AppError>,
  ModelInfo: true satisfies SameShape<ModelInfo, Rust.ModelInfo>,
  RequestOptions: true satisfies SameShape<RequestOptions, Rust.RequestOptions>,
  LlmDelta: true satisfies SameShape<EventMap["llm-delta"], Rust.LlmDelta>,
  LlmDone: true satisfies SameShape<EventMap["llm-done"], Rust.LlmDone>,
  LlmUsage: true satisfies SameShape<EventMap["llm-usage"], Rust.LlmUsage>,
  LlmErrorEvent: true satisfies SameShape<EventMap["llm-error"], Rust.LlmErrorEvent>,
  ResizeDim: true satisfies SameShape<EventMap["resize-key"]["dim"], Rust.ResizeDim>,
  UpdateProgress: true satisfies SameShape<EventMap["update-progress"], Rust.UpdateProgress>,
  UpdateDone: true satisfies SameShape<EventMap["update-done"], Rust.UpdateDone>,
};

describe("рукописные типы IPC против сгенерированных из Rust", () => {
  it("совпадают по форме — иначе tsc не соберёт этот файл", () => {
    expect(Object.values(contract).every(Boolean)).toBe(true);
  });
});
