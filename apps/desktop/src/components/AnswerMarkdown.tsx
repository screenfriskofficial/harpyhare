import { PROSE_MARKDOWN_CLASS } from "@/components/markdown-config";
import { MarkdownChunk } from "@/components/MarkdownChunk";
import { useAnswerMarkdownComponents } from "@/hooks/useAnswerMarkdownComponents";
import type { PreviewContent } from "@/lib/html-blocks";

/**
 * A model answer rendered the way the HUD renders one: the chat prose class,
 * the shared markdown components and `CodeBlock` for fenced code. Without
 * `onTogglePreview` an HTML block is shown as code — the launcher has no
 * preview panel to open it in.
 */
export function AnswerMarkdown({
  text,
  onTogglePreview,
}: {
  text: string;
  onTogglePreview?: (content: PreviewContent) => void;
}) {
  const components = useAnswerMarkdownComponents(onTogglePreview);
  return (
    <div className={PROSE_MARKDOWN_CLASS}>
      <MarkdownChunk text={text} components={components} />
    </div>
  );
}
