import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { hotkeyFromEvent, isModifierOnlyCode } from "@/lib/hotkey-capture";
import { formatCombo } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";

export interface HotkeyCaptureProps {
  value: string;
  onChange: (hotkey: string) => void;
}

const CANCEL_CAPTURE_CODE = "Escape";
const LISTEN_IN_CAPTURE_PHASE = true;

export function HotkeyCapture({ value, onChange }: HotkeyCaptureProps) {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const captureNextHotkey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === CANCEL_CAPTURE_CODE) {
        setCapturing(false);
        return;
      }
      if (isModifierOnlyCode(e.code)) return;
      const hotkey = hotkeyFromEvent(e);
      if (hotkey !== null) {
        onChange(hotkey);
        setCapturing(false);
      }
    };
    window.addEventListener("keydown", captureNextHotkey, LISTEN_IN_CAPTURE_PHASE);
    return () => {
      window.removeEventListener("keydown", captureNextHotkey, LISTEN_IN_CAPTURE_PHASE);
    };
  }, [capturing, onChange]);

  const label = formatCombo(value);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        setCapturing((c) => !c);
      }}
      className={cn(
        "w-full justify-start font-mono",
        capturing && "border-ring text-muted-foreground ring-2 ring-ring/40",
        !capturing && label === "" && "text-muted-foreground/60",
      )}
    >
      {capturing && <span className="size-1.5 shrink-0 rounded-full bg-ring" aria-hidden />}
      {capturing ? t("hotkeys.waiting") : label || t("hotkeys.unassigned")}
    </Button>
  );
}
