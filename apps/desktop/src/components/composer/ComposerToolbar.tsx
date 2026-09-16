import { Crop, Eraser, NotebookText } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { NoticeDot } from "@/components/NoticeDot";
import {
  RequestParamsPopover,
  type RequestParamsPopoverProps,
} from "@/components/RequestParamsPopover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ComposerToolbarProps = RequestParamsPopoverProps & {
  streaming: boolean;
  onClearHistory: () => void;
  onCaptureRegion: () => void;
  hasContext: boolean;
  onOpenContext: () => void;
  /** Clipped away by the collapsed card, and then inert: nothing in it can be tabbed into or clicked. */
  shown: boolean;
  /** Keeps clear of the action buttons pinned into the card's corner. */
  className?: string;
};

interface ToolbarIconButtonProps {
  /** Both the tooltip and the accessible name — one string, so they cannot drift apart. */
  label: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  children: ReactNode;
}

function ToolbarIconButton({
  label,
  onClick,
  disabled,
  className,
  children,
}: ToolbarIconButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      className={className}
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      {children}
    </Button>
  );
}

export function ComposerToolbar(props: ComposerToolbarProps) {
  const { t } = useTranslation();
  return (
    <div
      data-slot="composer-toolbar"
      inert={!props.shown}
      aria-hidden={!props.shown}
      className={cn("flex items-center gap-1 px-1.5 pb-1.5", props.className)}
    >
      <ToolbarIconButton
        label={t("hud.composer.clearHistory")}
        disabled={props.streaming}
        onClick={props.onClearHistory}
      >
        <Eraser />
      </ToolbarIconButton>
      <ToolbarIconButton
        label={t("hud.composer.context")}
        className="relative"
        onClick={props.onOpenContext}
      >
        <NotebookText />
        {props.hasContext && <NoticeDot />}
      </ToolbarIconButton>
      <ToolbarIconButton label={t("hud.composer.screenshot")} onClick={props.onCaptureRegion}>
        <Crop />
      </ToolbarIconButton>
      <RequestParamsPopover
        chat={props.chat}
        onPatch={props.onPatch}
        modelOptions={props.modelOptions}
        modelProvidersMissingKey={props.modelProvidersMissingKey}
        thinkingDisabled={props.thinkingDisabled}
        presets={props.presets}
        pipelines={props.pipelines}
        pipelinesReady={props.pipelinesReady}
        onClosed={props.onClosed}
      />
    </div>
  );
}
