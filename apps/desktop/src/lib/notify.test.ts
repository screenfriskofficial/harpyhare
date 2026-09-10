import { describe, expect, it } from "vitest";
import type { AppError } from "./errors";
import { errorToastContent } from "./notify";

function err(code: AppError["code"], message = "подробности"): AppError {
  return { code, message };
}

describe("errorToastContent", () => {
  it("сеть и отмена не дают тост — сеть закрывает оверлей, отмена не ошибка", () => {
    expect(errorToastContent(err("network"))).toBeNull();
    expect(errorToastContent(err("cancelled"))).toBeNull();
  });

  it("ошибки получают заголовок и действие на языке интерфейса", () => {
    expect(errorToastContent(err("badApiKey", "Неверный ключ Anthropic"))).toEqual({
      title: "Неверный ключ",
      message: "Откройте «Настройки → Доступ к API» и проверьте ключ выбранного провайдера.",
    });
    expect(errorToastContent(err("api", "HTTP 500"))?.title).toBe("Ошибка API");
    expect(errorToastContent(err("silence"))?.title).toBe("Речь не распознана");
    expect(errorToastContent(err("internal"))?.title).toBe("Ошибка");
  });

  it("отличает оплату от ограничения частоты и не выводит сырое тело провайдера", () => {
    const billing = errorToastContent(err("billing", "secret provider response sk-private"));
    expect(billing?.title).toBe("Проблема оплаты или квоты");
    expect(billing?.message).toContain("баланс");
    expect(billing?.message).not.toContain("sk-private");
    expect(errorToastContent(err("rateLimited"))?.title).toBe("Лимит запросов");
  });
});
