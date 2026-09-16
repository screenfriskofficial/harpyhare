import { lazy, Suspense, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import type { TranslationKey } from "@/i18n";

/**
 * A panel whose module — and the canvas library behind it — joins the bundle
 * only when it is first rendered; until then, a status line.
 */
export function lazyPanel<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
  fallbackKey: TranslationKey,
): ComponentType<P> {
  const Panel = lazy(load);
  return function LazyPanel(props: P) {
    const { t } = useTranslation();
    return (
      <Suspense
        fallback={
          <p role="status" className="text-body text-muted-foreground">
            {t(fallbackKey)}
          </p>
        }
      >
        <Panel {...props} />
      </Suspense>
    );
  };
}
