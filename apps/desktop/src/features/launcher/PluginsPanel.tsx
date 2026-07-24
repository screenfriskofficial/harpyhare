import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { SectionLabel } from "@/components/SectionLabel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useScreenCapturePermission } from "@/hooks/useScreenCapturePermission";
import type { PluginDescriptor } from "@/ipc/bindings";
import { listPlugins } from "@/ipc/commands";
import type { PluginSetting, Settings } from "@/ipc/types";
import { pluginIcon } from "@/lib/plugin-icons";
import { queryKeys } from "@/lib/query-client";
import { cn } from "@/lib/utils";
import type { SectionProps } from "./contract";
import { Field, SectionGroup, SwitchRow } from "./fields";
import { HotkeyCapture } from "./HotkeyCapture";

const SCREEN_RECORDING_PERMISSION = "screen_recording";

const PERMISSION_LABELS: Record<string, string> = {
  screen_recording: "Запись экрана",
};

function permissionLabel(id: string): string {
  return PERMISSION_LABELS[id] ?? id;
}

function upsertPluginSetting(list: PluginSetting[], entry: PluginSetting): PluginSetting[] {
  const idx = list.findIndex((p) => p.id === entry.id);
  if (idx >= 0) return list.map((p, i) => (i === idx ? entry : p));
  return [...list, entry];
}

function ScreenRecordingRequirement() {
  const { screenCaptureOk, requestScreenCapture, openScreenCaptureSettings } =
    useScreenCapturePermission();
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 text-body">
        Запись экрана
        <span
          className={cn(
            "text-caption",
            screenCaptureOk ? "text-muted-foreground" : "text-destructive",
          )}
        >
          {screenCaptureOk ? "выдано" : "нет доступа"}
        </span>
      </span>
      {!screenCaptureOk && (
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="ghost" onClick={openScreenCaptureSettings}>
            Настройки
          </Button>
          <Button size="sm" onClick={() => void requestScreenCapture()}>
            Запросить
          </Button>
        </div>
      )}
    </div>
  );
}

interface PluginDetailProps {
  descriptor: PluginDescriptor;
  draft: Settings;
  set: SectionProps["set"];
  onClose: () => void;
}

function PluginDetailDialog({ descriptor: d, draft, set, onClose }: PluginDetailProps) {
  const Icon = pluginIcon(d.icon);
  const pref = draft.plugin_settings.find((p) => p.id === d.id);
  const enabled = pref?.enabled ?? d.enabled;
  const hotkey = pref?.hotkey ?? d.hotkey;

  const write = (entry: PluginSetting) => {
    set("plugin_settings", upsertPluginSetting(draft.plugin_settings, entry));
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent className="max-w-[min(520px,95vw)] sm:max-w-[min(520px,95vw)]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2.5">
            <Icon className="size-5 shrink-0 text-foreground" aria-hidden />
            <span>{d.name}</span>
            <span className="text-caption font-normal text-muted-foreground">v{d.version}</span>
          </DialogTitle>
        </DialogHeader>

        <p className="text-body text-muted-foreground">{d.description}</p>

        <SwitchRow
          checked={enabled}
          onCheckedChange={(v) => {
            write({ id: d.id, enabled: v, hotkey });
          }}
        >
          <span className="text-body">{enabled ? "Включён" : "Выключен"}</span>
        </SwitchRow>

        <Field label="Хоткей">
          <HotkeyCapture
            value={hotkey}
            onChange={(hk) => {
              write({ id: d.id, enabled, hotkey: hk });
            }}
          />
        </Field>

        {d.permissions.length > 0 && (
          <div className="flex flex-col gap-2">
            <SectionLabel>Требуемые разрешения</SectionLabel>
            {d.permissions.map((perm) =>
              perm === SCREEN_RECORDING_PERMISSION ? (
                <ScreenRecordingRequirement key={perm} />
              ) : (
                <span key={perm} className="text-body">
                  {permissionLabel(perm)}
                </span>
              ),
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function PluginsPanel({ draft, set }: SectionProps) {
  const { data } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });
  const descriptors = data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = descriptors.find((d) => d.id === selectedId) ?? null;

  if (descriptors.length === 0) {
    return (
      <SectionGroup title="Плагины">
        <p className="text-caption text-muted-foreground">
          Плагинов пока нет. Они подкачиваются автоматически.
        </p>
      </SectionGroup>
    );
  }

  return (
    <>
      <SectionGroup title="Плагины">
        {descriptors.map((d) => {
          const pref = draft.plugin_settings.find((p) => p.id === d.id);
          const enabled = pref?.enabled ?? d.enabled;
          const Icon = pluginIcon(d.icon);
          return (
            <button
              key={d.id}
              type="button"
              onClick={() => {
                setSelectedId(d.id);
              }}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-surface"
            >
              <Icon className="size-5 shrink-0 text-foreground" aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="text-caption text-muted-foreground">v{d.version}</span>
                </div>
                <p className="truncate text-caption text-muted-foreground">{d.description}</p>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-caption text-muted-foreground">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    enabled ? "bg-primary" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                {enabled ? "вкл" : "выкл"}
              </span>
            </button>
          );
        })}
      </SectionGroup>

      {selected !== null && (
        <PluginDetailDialog
          descriptor={selected}
          draft={draft}
          set={set}
          onClose={() => {
            setSelectedId(null);
          }}
        />
      )}
    </>
  );
}
