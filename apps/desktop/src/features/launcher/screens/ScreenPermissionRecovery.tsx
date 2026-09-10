import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { resetScreenPermissionAndRestart } from "@/ipc/commands";
import { notify } from "@/lib/notify";

export function ScreenPermissionRecovery({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);

  async function recover() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    try {
      await resetScreenPermissionAndRestart();
    } catch {
      notify({ message: t("launcher.permissions.recoveryFailed"), variant: "error" });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <div className="space-y-2 px-3 py-2.5">
      <p className="text-caption text-muted-foreground">
        {t(
          confirming ? "launcher.permissions.recoveryConfirm" : "launcher.permissions.recoveryHint",
        )}
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || pending}
          onClick={() => {
            if (confirming) void recover();
            else setConfirming(true);
          }}
        >
          {t(
            pending
              ? "launcher.permissions.recovering"
              : confirming
                ? "launcher.permissions.recoveryRestart"
                : "launcher.permissions.recover",
          )}
        </Button>
        {confirming && (
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setConfirming(false);
            }}
          >
            {t("common.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
