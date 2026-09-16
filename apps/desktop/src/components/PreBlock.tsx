import { isValidElement, type ReactNode } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { HtmlBlockChip } from "@/components/HtmlBlockChip";
import { hasPreviewLanguageClass } from "@/components/markdown-config";
import { languageFromClassName } from "@/lib/code-block";
import { previewContent, type PreviewContent } from "@/lib/html-blocks";

/**
 * Сырой текст блока нужен и счётчику строк, и кнопке копирования, а после
 * подсветки children код-элемента — дерево span'ов, а не строка.
 */
function reactChildrenText(node: ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(reactChildrenText).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return reactChildrenText(node.props.children);
  return "";
}

/**
 * Инвариант: у языка превью children код-элемента обязаны остаться сырой
 * строкой — он в `plainText` подсветки (`markdown-config`). Подсветка
 * превратила бы их в массив span'ов и молча сломала чип.
 *
 * Without `onTogglePreview` (a window with no preview panel) an HTML block is
 * rendered as plain code: a chip with nowhere to open is worse than an honest block.
 */
export function makePre(onTogglePreview?: (content: PreviewContent) => void) {
  return function PreBlock({ children }: { children?: ReactNode }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children
      : null;
    const text = code?.props.children;
    if (
      onTogglePreview &&
      code &&
      hasPreviewLanguageClass(code.props.className ?? "") &&
      typeof text === "string"
    ) {
      const language = languageFromClassName(code.props.className);
      const content = previewContent(language, text);
      if (content !== null)
        return (
          <HtmlBlockChip
            language={language ?? content.kind}
            code={text}
            onToggle={() => {
              onTogglePreview(content);
            }}
          />
        );
    }
    if (!code) return <pre>{children}</pre>;
    return (
      <CodeBlock
        language={languageFromClassName(code.props.className)}
        code={reactChildrenText(code.props.children)}
        codeClassName={code.props.className}
      >
        {code.props.children}
      </CodeBlock>
    );
  };
}
