/**
 * `[keywords]: [golang, gRPC, Kubernetes]` — terms the user declares inside a
 * preset, a library document or the chat context, to bias speech recognition
 * toward the vocabulary this conversation actually uses.
 *
 * Declared, never inferred. Guessing terms out of prose was the alternative and
 * it is a bad one: the vendor cap is small (Deepgram recommends 20–50 terms,
 * and a list past a vendor's cap is an error, not a truncation), so a heuristic
 * that spends the budget on common words
 * makes recognition worse rather than better. Writing the block **is** the
 * opt-in — there is no setting, and that is deliberate.
 */

/**
 * `[keywords]` / `[ключевые слова]`, optional colon, then a bracketed list.
 *
 * Two alternatives on purpose. The first accepts one level of nesting, so a
 * Go term like `[]byte` neither truncates the list nor leaks its tail into the
 * prompt. The second is the typo case — a list nobody closed — and it stops at
 * the end of the line rather than swallowing the rest of the document: a
 * missing bracket must cost the terms, not the prompt around them.
 */
const KEYWORDS_BLOCK =
  /\[\s*(?:keywords|ключевые\s+слова)\s*\]\s*:?\s*(?:\[((?:[^[\]]|\[[^[\]]*\])*)\]|\[([^[\]\n]*))/gi;

const TERM_SEPARATORS = /[,;\n]/;
/** Long enough to be a term, short enough not to be a smuggled sentence. */
const TERM_MAX_CHARS = 60;

function cleanTerm(raw: string): string {
  return raw
    .trim()
    .replace(/^["'«]+|["'»]+$/g, "")
    .trim();
}

function isUsableTerm(term: string): boolean {
  return term.length > 0 && term.length <= TERM_MAX_CHARS;
}

/**
 * Terms declared in one piece of text, in the order written. Several blocks in
 * the same text are all read — a long document may group them by topic.
 */
export function extractKeyterms(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(KEYWORDS_BLOCK)) {
    const list = match[1] ?? match[2] ?? "";
    for (const raw of list.split(TERM_SEPARATORS)) {
      const term = cleanTerm(raw);
      if (isUsableTerm(term)) found.push(term);
    }
  }
  return found;
}

/**
 * The same text with the declarations removed.
 *
 * They are configuration for the recogniser, not an instruction for the model,
 * so the answering model never sees them — otherwise every system prompt would
 * carry a stray directive it is expected to ignore.
 */
export function stripKeywordBlocks(text: string): string {
  return text
    .replace(KEYWORDS_BLOCK, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Case-insensitive dedup, first spelling wins, order preserved. */
export function dedupeKeyterms(terms: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const term of terms) {
    const key = term.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/**
 * Every term a chat declares, across its preset, its library documents and its
 * own context. Capping is the vendor's business (`stt::registry`), not this
 * function's — it reports what the user asked for.
 */
export function chatKeyterms(sources: readonly string[]): string[] {
  return dedupeKeyterms(sources.flatMap(extractKeyterms));
}
