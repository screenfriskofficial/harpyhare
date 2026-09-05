import { cloneElement, isValidElement, type ReactNode } from "react";

const NEWLINE = "\n";

type Line = ReactNode[];

/** Хвост `into` и голова `next` — одна и та же строка, остальное дописывается на месте. */
function appendLines(into: Line[], next: Line[]): void {
  const [head = [], ...rest] = next;
  const last = into[into.length - 1];
  if (last === undefined) into.push(head);
  else last.push(...head);
  into.push(...rest);
}

/**
 * Режет отрендеренное содержимое блока на строки, сохраняя обёртки подсветки.
 *
 * Наивное «разбить текст по \n» тут не работает: rehype-highlight отдаёт дерево
 * span'ов, и перенос строки почти всегда лежит ВНУТРИ токена (комментарий,
 * многострочная строка, шаблон). Поэтому дерево обходится рекурсивно, а span,
 * попавший на границу строк, переоткрывается на следующей — ровно так же, как
 * это делают подсветчики с нумерацией.
 */
export function splitRenderedLines(node: ReactNode): Line[] {
  if (node === null || node === undefined || typeof node === "boolean") return [[]];
  if (typeof node === "number") return [[String(node)]];
  if (typeof node === "string") {
    return node.split(NEWLINE).map((part) => (part === "" ? [] : [part]));
  }
  if (Array.isArray(node)) {
    const lines: Line[] = [[]];
    for (const child of node as ReactNode[]) appendLines(lines, splitRenderedLines(child));
    return lines;
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const inner = splitRenderedLines(node.props.children);
    if (inner.length === 1) return [[node]];
    // Пустой список детей передаётся явным `null`: `cloneElement` без
    // children-аргументов наследует детей оригинала, и пустая строка внутри
    // токена показала бы весь токен целиком ещё раз.
    return inner.map((line, index) => [
      cloneElement(node, { key: index }, ...(line.length === 0 ? [null] : line)),
    ]);
  }
  return [[node]];
}

/** Завершающий перенос не должен рисовать лишнюю пустую строку с номером. */
export function trimTrailingEmptyLine(lines: Line[]): Line[] {
  const last = lines[lines.length - 1];
  return lines.length > 1 && last?.length === 0 ? lines.slice(0, -1) : lines;
}
