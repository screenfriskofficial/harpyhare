import { describe, expect, it } from "vitest";
import { SETTINGS_LIMITS } from "@/ipc/bindings";
import {
  chatColumnWidthPx,
  clampPreviewWidth,
  PREVIEW_EXTRA_WIDTH_PX,
  previewWidthBounds,
  SHELL_COLUMN_GAP_PX,
  SHELL_PADDING_PX,
} from "./shell-layout";

const { previewWidth, windowWidth } = SETTINGS_LIMITS;

describe("shell layout", () => {
  it("окно с превью растёт ровно на дефолтную панель и зазор", () => {
    expect(PREVIEW_EXTRA_WIDTH_PX).toBe(previewWidth.default + SHELL_COLUMN_GAP_PX);
  });

  it("чат занимает окно без отступов, а с превью отдаёт ему разницу с дефолтной шириной", () => {
    expect(chatColumnWidthPx(960, null)).toBe(960 - SHELL_PADDING_PX * 2);
    expect(chatColumnWidthPx(960, previewWidth.default)).toBe(960 - SHELL_PADDING_PX * 2);
    expect(chatColumnWidthPx(960, previewWidth.default + 100)).toBe(
      960 - SHELL_PADDING_PX * 2 - 100,
    );
    expect(chatColumnWidthPx(960, previewWidth.default - 40)).toBe(960 - SHELL_PADDING_PX * 2 + 40);
  });

  it("границы превью: снизу общие из Rust, сверху — чат не уже, чем в самом узком окне", () => {
    const chatMin = windowWidth.min - SHELL_PADDING_PX * 2;
    expect(previewWidthBounds(960)).toEqual({
      min: previewWidth.min,
      max: 960 - SHELL_PADDING_PX * 2 + previewWidth.default - chatMin,
    });
    // In the narrowest window the panel cannot grow past the default — the chat is already at its minimum.
    expect(previewWidthBounds(windowWidth.min).max).toBe(previewWidth.default);
    // A wide window hits the shared maximum instead of growing without bound.
    expect(previewWidthBounds(windowWidth.max).max).toBe(previewWidth.max);
  });

  it("кламп держит панель в границах, округляет и отбрасывает не-числа", () => {
    const { min, max } = previewWidthBounds(960);
    expect(clampPreviewWidth(10, 960)).toBe(min);
    expect(clampPreviewWidth(5000, 960)).toBe(max);
    expect(clampPreviewWidth(600.4, 960)).toBe(600);
    expect(clampPreviewWidth(Number.NaN, 960)).toBe(previewWidth.default);
    expect(chatColumnWidthPx(960, clampPreviewWidth(5000, 960))).toBe(
      windowWidth.min - SHELL_PADDING_PX * 2,
    );
  });
});
