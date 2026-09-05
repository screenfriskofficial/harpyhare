import { Check, Copy, WrapText } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { useCopy } from "./copy";
import { AppIconButton, ICON_CLUSTER_BUTTON_SIZE_CLASS } from "./ui";

/**
 * Маленький markdown для заранее записанных ответов: абзацы, списки, инлайн-код
 * и fenced-блоки кода с той же шапкой, что у `CodeBlock` в приложении —
 * язык, счётчик строк, перенос и копирование, нумерация строк.
 */
const FENCE_RE = /^```(\w*)\n([\s\S]*?)\n```$/;
const BULLET_RE = /^(?:- |— )/;
const COPIED_FEEDBACK_MS = 1500;
const MIN_GUTTER_DIGITS = 2;
const TEENS_START = 11;
const TEENS_END = 14;

type Block =
  { kind: "code"; language: string | null; code: string } | { kind: "text"; text: string };

function splitBlocks(markdown: string): Block[] {
  const blocks: Block[] = [];
  const parts = markdown.split(/(```\w*\n[\s\S]*?\n```)/);
  for (const part of parts) {
    const fence = FENCE_RE.exec(part);
    if (fence) {
      const language = fence[1] ?? "";
      blocks.push({
        kind: "code",
        language: language === "" ? null : language,
        code: fence[2] ?? "",
      });
      continue;
    }
    for (const paragraph of part.split("\n\n")) {
      if (paragraph.trim() !== "") blocks.push({ kind: "text", text: paragraph.trim() });
    }
  }
  return blocks;
}

/** «1 строка», «3 строки», «12 строк» — по формам из копии. */
function linesLabel(count: number, forms: [string, string, string]): string {
  const withinHundred = count % 100;
  const lastDigit = count % 10;
  const isTeen = withinHundred >= TEENS_START && withinHundred <= TEENS_END;
  const form = isTeen
    ? forms[2]
    : lastDigit === 1
      ? forms[0]
      : lastDigit > 1 && lastDigit <= 4
        ? forms[1]
        : forms[2];
  return `${count} ${form}`;
}

function InlineText({ text }: { text: string }) {
  return (
    <>
      {text
        .split("`")
        .map((part, index) =>
          index % 2 === 1 ? (
            <code key={index}>{part}</code>
          ) : (
            <Fragment key={index}>{part}</Fragment>
          ),
        )}
    </>
  );
}

function useCopiedFlag(): [copied: boolean, markCopied: () => void] {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const markCopied = () => {
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      setCopied(false);
    }, COPIED_FEEDBACK_MS);
  };
  return [copied, markCopied];
}

export function copyText(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !("clipboard" in navigator))
    return Promise.resolve(false);
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

function CodeBlock({ language, code }: { language: string | null; code: string }) {
  const copy = useCopy().hud.code;
  const [wrapped, setWrapped] = useState(true);
  const [copied, markCopied] = useCopiedFlag();
  const lines = code.replace(/\n$/, "").split("\n");
  const gutter = Math.max(MIN_GUTTER_DIGITS, String(lines.length).length);
  return (
    <div
      data-wrap={wrapped}
      style={{ "--code-gutter": `${gutter}ch` } as CSSProperties}
      className="app-code-block my-2 overflow-hidden rounded-md bg-app-code-surface ring-1 ring-app-border ring-inset"
    >
      <div className="flex items-center gap-2 border-b border-app-border py-0.5 pr-0.5 pl-2.5 font-mono text-app-caption">
        <span className="truncate font-medium text-app-fg/85">{language ?? copy.unknown}</span>
        <span className="shrink-0 text-app-muted tabular-nums">
          {linesLabel(lines.length, copy.lines)}
        </span>
        <span className="min-w-0 flex-1" />
        <AppIconButton
          title={wrapped ? copy.wrapOff : copy.wrapOn}
          className={cn(ICON_CLUSTER_BUTTON_SIZE_CLASS, wrapped && "text-app-fg")}
          onClick={() => {
            setWrapped((on) => !on);
          }}
        >
          <WrapText />
        </AppIconButton>
        <AppIconButton
          title={copied ? copy.copied : copy.copy}
          className={ICON_CLUSTER_BUTTON_SIZE_CLASS}
          onClick={() => {
            void copyText(code).then((ok) => {
              if (ok) markCopied();
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
        </AppIconButton>
      </div>
      <pre>
        <code>
          {lines.map((line, index) => (
            <span key={index} className="code-line">
              <span className="code-line-number" aria-hidden>
                {index + 1}
              </span>
              <span className="code-line-text">{line}</span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

function TextBlock({ text }: { text: string }) {
  const lines = text.split("\n");
  if (lines.every((line) => BULLET_RE.test(line))) {
    return (
      <ul>
        {lines.map((line, index) => (
          <li key={index}>
            <InlineText text={line.replace(BULLET_RE, "")} />
          </li>
        ))}
      </ul>
    );
  }
  return (
    <p>
      <InlineText text={text} />
    </p>
  );
}

export function HudMarkdown({ text }: { text: string }) {
  return (
    <div className="app-prose text-app-chat leading-relaxed text-app-fg">
      {splitBlocks(text).map((block, index) =>
        block.kind === "code" ? (
          <CodeBlock key={index} language={block.language} code={block.code} />
        ) : (
          <TextBlock key={index} text={block.text} />
        ),
      )}
    </div>
  );
}

/** Проза для суфлёра: markdown снят, как `toReadingText` в приложении. */
export function toReadingText(markdown: string): string {
  return markdown
    .replace(/```\w*\n[\s\S]*?\n```\n?/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^(?:- |— )/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
