import { isValidElement, type ReactNode } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { HtmlBlockChip } from "@/components/HtmlBlockChip";
import { hasPreviewLanguageClass } from "@/components/markdown-config";
import { languageFromClassName } from "@/lib/code-block";

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
 */
export function makePre(onTogglePreview: (code: string) => void) {
  return function PreBlock({ children }: { children?: ReactNode }) {
    const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
      ? children
      : null;
    const text = code?.props.children;
    if (code && hasPreviewLanguageClass(code.props.className ?? "") && typeof text === "string") {
      return (
        <HtmlBlockChip
          code={text}
          onToggle={() => {
            onTogglePreview(text);
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
