const LINE_BREAK = "\n";
const BACKTICK = "`";
/**
 * CommonMark: ограждение — три и более одинаковых символа с отступом не больше
 * трёх ПРОБЕЛОВ. Именно `[ ]`, а не `\s`: с флагом `m` `\s{0,3}` захватывал бы
 * переводы строк, и маркер «матчился» вместе с пустыми строками перед ним —
 * тогда `splitOpenFence` резал по ним, а строка ```` ```js ```` уезжала в тело блока.
 */
const FENCE_LINE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const CLOSING_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const OPEN_FENCE_INFO = /^ {0,3}(?:`{3,}|~{3,})[ \t]*([^\s`]*)/;
/** Строка с отступом — продолжение элемента списка или отступный код: сама по себе не абзац. */
const INDENTED_LINE_RE = /^[ \t]/;
const LIST_ITEM_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** Незавершённая строка, которая ещё может дорасти до пункта списка («2» → «2. Baz»). */
const LIST_ITEM_PREFIX_RE = /^ {0,3}(?:[-*+]|\d{1,9}[.)]?)$/;

interface OpenFence {
  marker: string;
  length: number;
  /** Смещение начала строки-открывателя в тексте. */
  start: number;
}

interface Scan {
  /** Смещение сразу после последней безопасной границы абзаца, −1 — её нет. */
  lastSafeBoundary: number;
  openFence: OpenFence | null;
}

function fenceOpener(line: string, start: number): OpenFence | null {
  const match = FENCE_LINE_RE.exec(line);
  if (match === null) return null;
  const marker = match[1] ?? "";
  const info = match[2] ?? "";
  // У backtick-ограждения строка сведений не может содержать backtick — иначе это не fence.
  if (marker.startsWith(BACKTICK) && info.includes(BACKTICK)) return null;
  return { marker: marker[0] ?? "", length: marker.length, start };
}

function closesFence(line: string, fence: OpenFence): boolean {
  const match = CLOSING_FENCE_RE.exec(line);
  if (match === null) return false;
  const marker = match[1] ?? "";
  return marker.startsWith(fence.marker) && marker.length >= fence.length;
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

/**
 * Один линейный проход по строкам: где открыт fence и где последняя граница
 * абзаца, по которой безопасно резать. Граница безопасна, когда она вне
 * ограждения И за ней уже пришла строка, которая начинает новый блок: без
 * отступа (иначе это хвост элемента списка, который отдельным чанком стал бы
 * отступным кодом) и не очередной пункт того же списка (иначе loose-список
 * разъехался бы на несколько `<ol>`). Пока следующая строка не пришла,
 * граница не считается — в стриме за ней может оказаться что угодно.
 */
function scanLines(text: string): Scan {
  const lines = text.split(LINE_BREAK);
  const completeLines = lines.length - 1;
  let fence: OpenFence | null = null;
  let inList = false;
  let pendingBoundary = -1;
  let lastSafeBoundary = -1;
  let offset = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const lineStart = offset;
    offset += line.length + LINE_BREAK.length;
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
      continue;
    }
    if (isBlank(line)) {
      // Пара `\n\n` должна стоять не в самом начале текста, а строка — быть завершённой.
      if (i < completeLines && lineStart >= 2 * LINE_BREAK.length) {
        pendingBoundary = lineStart + line.length + LINE_BREAK.length;
      }
      continue;
    }
    const startsListItem = LIST_ITEM_RE.test(line);
    if (pendingBoundary !== -1) {
      const incomplete = i === completeLines;
      const mayStartListItem = startsListItem || (incomplete && LIST_ITEM_PREFIX_RE.test(line));
      const continuesBlock = INDENTED_LINE_RE.test(line) || (inList && mayStartListItem);
      if (!continuesBlock) lastSafeBoundary = pendingBoundary;
      pendingBoundary = -1;
    }
    const opener = fenceOpener(line, lineStart);
    if (opener !== null) {
      fence = opener;
      inList = false;
      continue;
    }
    inList = startsListItem || (inList && INDENTED_LINE_RE.test(line));
  }
  return { lastSafeBoundary, openFence: fence };
}

export function splitStableTail(text: string): [stable: string, tail: string] {
  const { lastSafeBoundary } = scanLines(text);
  if (lastSafeBoundary === -1) return ["", text];
  return [text.slice(0, lastSafeBoundary), text.slice(lastSafeBoundary)];
}

export function splitOpenFence(tail: string): [before: string, fenced: string] | null {
  const { openFence } = scanLines(tail);
  if (openFence === null) return null;
  return [tail.slice(0, openFence.start), tail.slice(openFence.start)];
}

export function openFenceLanguage(fenced: string): string | null {
  const info = OPEN_FENCE_INFO.exec(fenced)?.[1] ?? "";
  return info === "" ? null : info.toLowerCase();
}

export function openFenceBody(fenced: string): string {
  const lineEnd = fenced.indexOf(LINE_BREAK);
  return lineEnd < 0 ? "" : fenced.slice(lineEnd + 1);
}
