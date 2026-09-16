import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PipelineModelRequest } from "@/lib/pipeline-types";
import { PipelineRequestView } from "./PipelineRequestView";

const REQUEST: PipelineModelRequest = {
  nodeId: "model",
  model: "test-model",
  system: "Keep source facts intact.",
  options: { thinking: false, webSearch: true },
  messages: [
    { role: "user", text: "Earlier question", images: [] },
    { role: "assistant", text: "Earlier answer", images: [] },
    {
      role: "user",
      text: "Current material",
      images: [{ media_type: "image/png", data: "PRIVATE_IMAGE_BYTES" }],
    },
  ],
};

afterEach(cleanup);

describe("PipelineRequestView", () => {
  it("shows exact system, typed history and current material while keeping image payloads out of the DOM", () => {
    const { container } = render(<PipelineRequestView request={REQUEST} complete executed />);
    expect(screen.getByText("Отправленный запрос")).not.toBeNull();
    expect(screen.getByText("Keep source facts intact.")).not.toBeNull();
    expect(screen.getByText("История: 2")).not.toBeNull();
    expect(screen.getByText("Ассистент")).not.toBeNull();
    expect(screen.getByText("Earlier answer")).not.toBeNull();
    expect(screen.getByText("Данные текущего запроса")).not.toBeNull();
    expect(screen.getByText("Current material")).not.toBeNull();
    expect(screen.getByText("Изображения: 1")).not.toBeNull();
    expect(container.textContent).not.toContain("PRIVATE_IMAGE_BYTES");
    expect(container.querySelector("img")).toBeNull();
  });

  it("explicitly marks partial static input instead of claiming a request was sent", () => {
    render(<PipelineRequestView request={REQUEST} complete={false} executed={false} />);
    expect(screen.getByText("Запрос к модели")).not.toBeNull();
    expect(screen.getByText(/Показана только известная часть входа/)).not.toBeNull();
    expect(screen.queryByText("Отправленный запрос")).toBeNull();
    expect(screen.queryByText(/Вход полностью собран/)).toBeNull();
  });
});
