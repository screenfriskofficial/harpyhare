import { foldForSearch } from "./notes-search";

export interface ExcerptPart {
  text: string;
  match: boolean;
}

interface MatchRange {
  start: number;
  end: number;
}

const EXCERPT_MAX_CHARS = 200;
const EXCERPT_LEAD_CHARS = 48;
const ELLIPSIS = "…";
const WHITESPACE_RUN = /\s+/gu;
const SPACE = " ";
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;
const REGEX_ESCAPED_MATCH = "\\$&";
const YE_RUN = /е/g;
const YE_OR_YO_CLASS = "[её]";
const ALTERNATION = "|";
const MATCH_ALL_FLAGS = "giu";
const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;
/**
 * Цитата считается на каждый символ запроса для каждого хита; схлопывание
 * пробелов по всей заметке (до 200 КБ) — самая дорогая её часть, а текст
 * меняется редко. Кэш по строке: одна и та же заметка — одна нормализация.
 */
const FLATTENED_CACHE_LIMIT = 256;
const flattenedCache = new Map<string, string>();

function flattened(text: string): string {
  const cached = flattenedCache.get(text);
  if (cached !== undefined) return cached;
  const flat = text.replace(WHITESPACE_RUN, SPACE).trim();
  if (flattenedCache.size >= FLATTENED_CACHE_LIMIT) {
    const oldest = flattenedCache.keys().next().value;
    if (oldest !== undefined) flattenedCache.delete(oldest);
  }
  flattenedCache.set(text, flat);
  return flat;
}

function mergedRanges(ranges: MatchRange[]): MatchRange[] {
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

function termPattern(term: string): string {
  return term.replace(REGEX_SPECIALS, REGEX_ESCAPED_MATCH).replace(YE_RUN, YE_OR_YO_CLASS);
}

function termsRegex(terms: string[]): RegExp | null {
  const needles = [...new Set(terms.map(foldForSearch).filter((term) => term !== ""))].sort(
    (a, b) => b.length - a.length,
  );
  if (needles.length === 0) return null;
  return new RegExp(needles.map(termPattern).join(ALTERNATION), MATCH_ALL_FLAGS);
}

/** Совпадения по порядку; `stopAt` — смещение, начиная с которого они уже не нужны. */
function matchRanges(flat: string, regex: RegExp, stopAt: number = flat.length): MatchRange[] {
  const found: MatchRange[] = [];
  regex.lastIndex = 0;
  for (let match = regex.exec(flat); match !== null; match = regex.exec(flat)) {
    if (match.index >= stopAt) break;
    if (match[0] === "") {
      regex.lastIndex += 1;
      continue;
    }
    found.push({ start: match.index, end: match.index + match[0].length });
  }
  return mergedRanges(found);
}

function firstMatchIndex(flat: string, regex: RegExp): number | null {
  regex.lastIndex = 0;
  const match = regex.exec(flat);
  return match === null ? null : match.index;
}

function isHighSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= HIGH_SURROGATE_MIN && code <= HIGH_SURROGATE_MAX;
}

function isLowSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= LOW_SURROGATE_MIN && code <= LOW_SURROGATE_MAX;
}

/** Индексы — UTF-16; окно, разрезавшее суррогатную пару, показало бы «�» у многоточия. */
function alignedStart(flat: string, start: number): number {
  return start > 0 && start < flat.length && isLowSurrogate(flat, start) ? start + 1 : start;
}

function alignedEnd(flat: string, end: number): number {
  return end > 0 && end < flat.length && isHighSurrogate(flat, end - 1) ? end + 1 : end;
}

function windowStart(flat: string, firstMatch: number): number {
  const raw = Math.max(0, firstMatch - EXCERPT_LEAD_CHARS);
  if (raw === 0) return 0;
  const space = flat.indexOf(SPACE, raw);
  return alignedStart(flat, space === -1 || space >= firstMatch ? raw : space + 1);
}

function withEllipsis(parts: ExcerptPart[], before: boolean, after: boolean): ExcerptPart[] {
  return [
    ...(before ? [{ text: ELLIPSIS, match: false }] : []),
    ...parts,
    ...(after ? [{ text: ELLIPSIS, match: false }] : []),
  ];
}

export function noteExcerpt(text: string, terms: string[]): ExcerptPart[] {
  const flat = flattened(text);
  if (flat === "") return [];
  const regex = termsRegex(terms);
  const first = regex === null ? null : firstMatchIndex(flat, regex);
  const start = first === null ? 0 : windowStart(flat, first);
  const end = alignedEnd(flat, Math.min(flat.length, start + EXCERPT_MAX_CHARS));
  const ranges = regex === null ? [] : matchRanges(flat, regex, end);

  const parts: ExcerptPart[] = [];
  let cursor = start;
  for (const range of ranges) {
    if (range.end <= start) continue;
    if (range.start >= end) break;
    const from = Math.max(range.start, start);
    const to = Math.min(range.end, end);
    if (from > cursor) parts.push({ text: flat.slice(cursor, from), match: false });
    parts.push({ text: flat.slice(from, to), match: true });
    cursor = to;
  }
  if (cursor < end) parts.push({ text: flat.slice(cursor, end), match: false });
  return withEllipsis(parts, start > 0, end < flat.length);
}

export function noteMatchCount(text: string, terms: string[]): number {
  const regex = termsRegex(terms);
  return regex === null ? 0 : matchRanges(flattened(text), regex).length;
}
