import { memo } from "react";
import Markdown, { type Components } from "react-markdown";
import { REHYPE_PLUGINS, REMARK_PLUGINS } from "@/components/markdown-config";

export const MarkdownChunk = memo(function MarkdownChunk({
  text,
  components,
}: {
  text: string;
  components: Components;
}) {
  return (
    <Markdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={REHYPE_PLUGINS} components={components}>
      {text}
    </Markdown>
  );
});
