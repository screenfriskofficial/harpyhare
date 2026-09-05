import type Markdown from "react-markdown";
import { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";
import { ExternalLinkAnchor } from "@/components/ExternalLinkAnchor";
import { ScrollableTable } from "@/components/ScrollableTable";

/**
 * Язык, чей блок рендерится чипом превью, а не кодом. Он же — в `plainText`
 * подсветки: чип требует, чтобы children код-элемента остались сырой строкой,
 * а подсветка превратила бы их в массив span'ов и молча сломала чип.
 */
export const PREVIEW_LANGUAGE = "html";
const LANGUAGE_CLASS_PREFIX = "language-";
const PREVIEW_LANGUAGE_CLASS = `${LANGUAGE_CLASS_PREFIX}${PREVIEW_LANGUAGE}`;
const PLAIN_TEXT_LANGUAGES = [PREVIEW_LANGUAGE];
const AUTODETECT_LANGUAGE_SUBSET = [
  "javascript",
  "typescript",
  "python",
  "json",
  "bash",
  "css",
  "xml",
  "sql",
  "yaml",
  "rust",
  "go",
  "java",
];

export function hasPreviewLanguageClass(className: string): boolean {
  return className.split(/\s+/).some((token) => token.toLowerCase() === PREVIEW_LANGUAGE_CLASS);
}

export const PROSE_MARKDOWN_CLASS = "prose-answer text-chat leading-relaxed text-foreground";

type MarkdownProps = Parameters<typeof Markdown>[0];

export const REMARK_PLUGINS: NonNullable<MarkdownProps["remarkPlugins"]> = [remarkGfm];

export const REHYPE_PLUGINS: NonNullable<MarkdownProps["rehypePlugins"]> = [
  [
    rehypeHighlight,
    { detect: true, plainText: PLAIN_TEXT_LANGUAGES, subset: AUTODETECT_LANGUAGE_SUBSET },
  ],
];

/**
 * Общий набор компонентов для ЛЮБОГО markdown в приложении, включая заметки
 * к обновлению: голый `<a href>` в вебвью Tauri навигирует само окно прочь
 * от приложения, `ExternalLinkAnchor` открывает ссылку в браузере.
 */
export const markdownComponents: Components = { a: ExternalLinkAnchor, table: ScrollableTable };
