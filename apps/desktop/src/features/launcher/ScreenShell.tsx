import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { screenDescription, screenLabel, type ScreenId } from "./screens";

export function ScreenShell({
  screen,
  actions,
  children,
}: {
  screen: ScreenId;
  actions?: ReactNode;
  children: ReactNode;
}) {
  // Подписка на смену языка: сам текст приходит из реестра через общий `t`.
  useTranslation();
  const description = screenDescription(screen);
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5">
      <header className="flex min-h-7 items-center gap-2.5">
        <h2 className="shrink-0 text-title font-semibold tracking-tight text-foreground">
          {screenLabel(screen)}
        </h2>
        <p
          title={description}
          className="min-w-0 flex-1 truncate text-caption text-muted-foreground"
        >
          {description}
        </p>
        {actions !== undefined && (
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </header>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1.5">
        <div className="flex flex-col gap-4 pb-1">{children}</div>
      </div>
    </section>
  );
}
