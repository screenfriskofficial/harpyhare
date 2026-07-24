import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { missingKeysNotice, type ApiKeyInfo } from "@/lib/api-keys";

export interface RequirementsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  missingKeys: ApiKeyInfo[];
  audioOk: boolean;
  needsScreenRecording: boolean;
  screenCaptureOk: boolean;
  onConfigureKeys: () => void;
  onRequestAudio: () => void;
  onOpenAudioSettings: () => void;
  onRequestScreen: () => void;
  onOpenScreenSettings: () => void;
}

function RequirementRow({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-xl bg-surface px-3 py-2.5 ring-1 ring-border ring-inset">
      <div className="min-w-0">
        <p className="text-body text-foreground">{title}</p>
        {hint !== undefined && <p className="text-caption text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

export function RequirementsDialog(props: RequirementsDialogProps) {
  const rows: ReactNode[] = [];
  if (props.missingKeys.length > 0) {
    rows.push(
      <RequirementRow key="keys" title={missingKeysNotice(props.missingKeys)}>
        <Button size="sm" variant="ghost" onClick={props.onConfigureKeys}>
          Настроить
        </Button>
      </RequirementRow>,
    );
  }
  if (!props.audioOk) {
    rows.push(
      <RequirementRow key="audio" title="Запись системного звука" hint="Разрешение macOS">
        <Button size="sm" variant="ghost" onClick={props.onOpenAudioSettings}>
          Настройки
        </Button>
        <Button size="sm" onClick={props.onRequestAudio}>
          Разрешить
        </Button>
      </RequirementRow>,
    );
  }
  if (props.needsScreenRecording && !props.screenCaptureOk) {
    rows.push(
      <RequirementRow key="screen" title="Запись экрана" hint="Нужно для harpyshot">
        <Button size="sm" variant="ghost" onClick={props.onOpenScreenSettings}>
          Настройки
        </Button>
        <Button size="sm" onClick={props.onRequestScreen}>
          Запросить
        </Button>
      </RequirementRow>,
    );
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="max-w-[min(460px,95vw)] sm:max-w-[min(460px,95vw)]">
        <DialogHeader>
          <DialogTitle>Нельзя запустить — не хватает доступа</DialogTitle>
        </DialogHeader>
        <p className="text-caption text-muted-foreground">
          Выдай недостающее и запусти снова. Разрешения macOS применяются после перезапуска
          приложения.
        </p>
        <div className="flex flex-col gap-2">{rows}</div>
      </DialogContent>
    </Dialog>
  );
}
