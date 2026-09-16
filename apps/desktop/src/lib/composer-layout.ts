/** What the composer measures, in pixels: the animated card, the field row, the whole content and the quick-actions bar. */
export interface ComposerMeasure {
  card: number;
  /** The row holding the input field — what the card collapses to. */
  row: number;
  /** The whole content: field, attachments and toolbar — the expanded card's height. */
  content: number;
  bar: number;
}

export interface ComposerZone {
  /** How much the composer takes in the column's flow: the quick-actions bar plus the collapsed card. */
  slot: number;
  /** How much taller than the slot the card currently is — this overhang lies over the chat ledger. */
  overflow: number;
}

/**
 * The composer zone. The in-flow slot does not change on expansion: it is the
 * quick-actions bar (with its gap, when present) plus the input field row —
 * exactly the collapsed card's size. Whatever the card is taller than the slot
 * overhangs the chat ledger, and the ledger only gets a matching bottom inset —
 * its own size never changes.
 */
export function composerZone(measure: ComposerMeasure, barGap: number): ComposerZone {
  const chrome = measure.bar > 0 ? measure.bar + barGap : 0;
  return { slot: chrome + measure.row, overflow: Math.max(0, measure.card - measure.row) };
}

/** Where the card height animates to: expanded shows the whole content, collapsed a single field row. */
export function composerCardHeight(measure: ComposerMeasure, expanded: boolean): number {
  return expanded ? measure.content : measure.row;
}
