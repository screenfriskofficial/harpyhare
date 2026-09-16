import { cn } from "@/lib/utils";

/**
 * The small primary dot in a control's corner that says it carries something:
 * a filled-in chat context, a chosen pipeline, an unread answer on a tab.
 * `primary` is the sanctioned indicator colour; the dot never carries text.
 */
export function NoticeDot({ className }: { className?: string }) {
  return (
    <span
      className={cn("absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary", className)}
      aria-hidden
    />
  );
}
