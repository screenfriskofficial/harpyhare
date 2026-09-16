import { useMemo } from "react";
import type { Components } from "react-markdown";
import { markdownComponents } from "@/components/markdown-config";
import { makePre } from "@/components/PreBlock";
import type { PreviewContent } from "@/lib/html-blocks";

/**
 * The shared markdown components plus the fenced-code renderer bound to this
 * window's preview toggle. Memoised on the toggle so the memoised history
 * (`ChatHistory`) keeps the same component identities across renders.
 */
export function useAnswerMarkdownComponents(
  onTogglePreview?: (content: PreviewContent) => void,
): Components {
  return useMemo(
    () => ({ ...markdownComponents, pre: makePre(onTogglePreview) }),
    [onTogglePreview],
  );
}
