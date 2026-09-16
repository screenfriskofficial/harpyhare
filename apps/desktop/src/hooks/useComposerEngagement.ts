import {
  useCallback,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { insideFloatingLayer } from "@/lib/portalled-layers";

/** Controls inside the card keep their own clicks: they neither open the card nor move the caret. */
const CARD_CONTROL_SELECTOR = "button, [role='combobox']";

export interface ComposerEngagementInput {
  promptRef: RefObject<HTMLTextAreaElement | null>;
  onRestoreFocus: () => void;
  onSend: () => void;
  /** A non-empty draft or an attachment: the card stays open regardless of focus. */
  hasContent: boolean;
}

export interface ComposerEngagement {
  expanded: boolean;
  /** This render flips between pill and card — the spring plays on that switch only. */
  switching: boolean;
  /** Sends and folds the card, as in the original, even though the field keeps its focus. */
  send: () => void;
  onCardFocus: (event: FocusEvent<HTMLDivElement>) => void;
  onCardMouseDown: (event: MouseEvent<HTMLDivElement>) => void;
  onCardBlur: (event: FocusEvent<HTMLDivElement>) => void;
  /** The caret is gone for good — the card's popover closed on a press elsewhere; an empty card folds. */
  disengage: () => void;
}

/**
 * When the composer is a pill and when it is a card. Focus in the field opens
 * the card — however it got there: a click, Tab, or the app placing the caret
 * on launch and after its dialogs; a click on the card's body opens it too and
 * returns the caret to the field, and a click on any of its controls leaves the
 * caret in the field. An empty card folds when the focus leaves it
 * (its own popover or dialog does not count — what happens inside them is
 * theirs, and the popover reports where the press that closed it landed) and
 * after sending; a draft or an attachment keeps it open regardless of focus.
 */
export function useComposerEngagement({
  promptRef,
  onRestoreFocus,
  onSend,
  hasContent,
}: ComposerEngagementInput): ComposerEngagement {
  const [engaged, setEngaged] = useState(false);
  const expanded = hasContent || engaged;
  const wasExpanded = useRef(expanded);
  const switching = wasExpanded.current !== expanded;
  wasExpanded.current = expanded;

  const onCardFocus = useCallback(
    (event: FocusEvent<HTMLDivElement>) => {
      const target: EventTarget = event.target;
      if (target === promptRef.current) setEngaged(true);
    },
    [promptRef],
  );
  const onCardMouseDown = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      // A press inside the card's own popover reaches here through the React
      // tree, not the DOM: it is the popover's business, not the card's.
      if (insideFloatingLayer(target)) return;
      if (target instanceof HTMLTextAreaElement) {
        // The browser focuses the field itself; the click also reopens a card
        // that folded after sending while the field kept its focus.
        setEngaged(true);
        return;
      }
      // Everything else — the body, the toolbar, the send button — leaves the
      // caret where it is. WebKit, unlike Chrome, never focuses a button by
      // mouse: without this the field blurred to the body with a null
      // `relatedTarget`, and an empty card folded on the first click on its
      // own toolbar.
      event.preventDefault();
      if (target instanceof Element && target.closest(CARD_CONTROL_SELECTOR) !== null) return;
      // The card's body — padding, gaps of the toolbar — belongs to the field.
      onRestoreFocus();
      setEngaged(true);
    },
    [onRestoreFocus],
  );
  const onCardBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    // Focus traffic inside the card's own popover — a select opening and
    // closing in it — reaches here through the React tree, and WebKit even
    // reports the closed list's removal as a blur with no `relatedTarget`.
    // None of it is the caret leaving the card: the popover's `onClosed`
    // decides that when the popover itself goes.
    if (insideFloatingLayer(event.target)) return;
    const next = event.relatedTarget;
    if (
      next instanceof Element &&
      (event.currentTarget.contains(next) || insideFloatingLayer(next))
    ) {
      return;
    }
    setEngaged(false);
  }, []);
  const disengage = useCallback(() => {
    setEngaged(false);
  }, []);
  const send = useCallback(() => {
    setEngaged(false);
    onSend();
  }, [onSend]);

  return { expanded, switching, send, onCardFocus, onCardMouseDown, onCardBlur, disengage };
}
