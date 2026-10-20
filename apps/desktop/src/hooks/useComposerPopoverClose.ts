import { useRef } from "react";

/**
 * A composer popover's half of the caret protocol. Radix would refocus the
 * trigger button (and, after an outside press, nothing at all); instead its
 * own return of focus is suppressed and `onClosed` learns what the dismissing
 * press landed on — `null` when it closed from the keyboard, its trigger or a
 * choice inside it — and the composer decides where the caret goes. Radix
 * dispatches the outside-interaction event on the element that was pressed,
 * so that is where the answer is recorded.
 */
export function useComposerPopoverClose(onClosed: (pressedOutside: Element | null) => void) {
  const pressedOutside = useRef<Element | null>(null);
  return {
    onInteractOutside: (event: Event) => {
      pressedOutside.current = event.target instanceof Element ? event.target : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      onClosed(pressedOutside.current);
      pressedOutside.current = null;
    },
  };
}
