import { ArrowUp, RotateCcw, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PROMPT_SEND_KEY } from "@/components/PromptTextarea";
import { ShortcutTooltip } from "@/components/ShortcutTooltip";
import { Button } from "@/components/ui/button";
import { formatCombo } from "@/lib/hotkeys";

export interface ActionGroupProps {
  streaming: boolean;
  showRetry: boolean;
  retryLabel: string;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
  onRetry: () => void;
}

/**
 * Pinned to the card's bottom-right corner in both states, as in the original:
 * it never travels with the toolbar, so the height animation leaves it still.
 */
export function ActionGroup(props: ActionGroupProps) {
  const { t } = useTranslation();
  const sendLabel = t("hud.composer.send");
  return (
    <div className="absolute right-1.5 bottom-1.5 flex items-center gap-1">
      {props.showRetry && (
        <Button
          variant="ghost"
          size="icon-compact"
          onClick={props.onRetry}
          title={props.retryLabel}
          aria-label={props.retryLabel}
        >
          <RotateCcw />
        </Button>
      )}
      {props.streaming ? (
        <Button
          variant="destructive"
          size="icon-compact"
          onClick={props.onStop}
          title={t("hud.composer.stop")}
          aria-label={t("hud.composer.stop")}
        >
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <ShortcutTooltip label={sendLabel} shortcut={formatCombo(PROMPT_SEND_KEY)}>
          <Button
            size="icon-compact"
            className="rounded-full"
            disabled={!props.canSend}
            onClick={props.onSend}
            aria-label={sendLabel}
          >
            <ArrowUp />
          </Button>
        </ShortcutTooltip>
      )}
    </div>
  );
}
