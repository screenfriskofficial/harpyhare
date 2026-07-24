import { Crop } from "lucide-react";
import { describe, expect, it } from "vitest";
import { pluginIcon } from "./plugin-icons";

describe("pluginIcon", () => {
  it("возвращает компонент для известного имени", () => {
    expect(pluginIcon("crop")).toBe(Crop);
  });
  it("фолбэк на Crop для неизвестного имени", () => {
    expect(pluginIcon("nope")).toBe(Crop);
  });
});
