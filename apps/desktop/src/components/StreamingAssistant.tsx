import { useState } from "react";
import { type Components } from "react-markdown";
import { CodeBlock } from "@/components/CodeBlock";
import { PROSE_MARKDOWN_CLASS } from "@/components/markdown-config";
import { MarkdownChunk } from "@/components/MarkdownChunk";
import {
  openFenceBody,
  openFenceLanguage,
  splitOpenFence,
  splitStableTail,
} from "@/lib/stream-markdown";

/**
 * Уже отрезанные куски копятся, а граница ищется только в том, что дописали
 * с прошлого кадра: `splitStableTail` проходит весь переданный текст, и на
 * длинном ответе это был бы полный скан на каждый кадр стрима. Резать по
 * нарастающей корректно, потому что у каждого отрезанного куска fence-маркеры
 * сбалансированы, а граница ставится только там, где за ней уже видна
 * строка, начинающая новый блок.
 *
 * Накопитель держится в состоянии, а не в рефе: правка рефа в теле рендера
 * запрещена React и разъезжается при отброшенном рендере. Обновление состояния
 * прямо в рендере — санкционированный приём для «подстройки под изменившийся
 * проп»: React перезапускает компонент, ничего не коммитя.
 */
interface SettledChunks {
  chunks: string[];
  consumed: number;
}

const NO_SETTLED_CHUNKS: SettledChunks = { chunks: [], consumed: 0 };

function useStreamChunks(text: string): { chunks: string[]; tail: string } {
  const [settled, setSettled] = useState<SettledChunks>(NO_SETTLED_CHUNKS);
  const base = text.length < settled.consumed ? NO_SETTLED_CHUNKS : settled;
  const [fresh, tail] = splitStableTail(text.slice(base.consumed));
  const next: SettledChunks =
    fresh === ""
      ? base
      : { chunks: [...base.chunks, fresh], consumed: base.consumed + fresh.length };
  if (next !== settled) setSettled(next);
  return { chunks: next.chunks, tail };
}

function OpenFenceBlock({ fenced }: { fenced: string }) {
  const body = openFenceBody(fenced);
  if (body === "") return null;
  return (
    <CodeBlock language={openFenceLanguage(fenced)} code={body}>
      {body}
    </CodeBlock>
  );
}

function StreamingTail({ text, components }: { text: string; components: Components }) {
  const split = splitOpenFence(text);
  if (split === null) return <MarkdownChunk text={text} components={components} />;
  const [before, fenced] = split;
  return (
    <>
      {before !== "" && <MarkdownChunk text={before} components={components} />}
      <OpenFenceBlock fenced={fenced} />
    </>
  );
}

export function StreamingAssistant({ text, components }: { text: string; components: Components }) {
  const { chunks, tail } = useStreamChunks(text);
  return (
    <div className={PROSE_MARKDOWN_CLASS}>
      {chunks.map((chunk, i) => (
        <MarkdownChunk key={i} text={chunk} components={components} />
      ))}
      {tail !== "" && <StreamingTail text={tail} components={components} />}
    </div>
  );
}
