import { useQuery } from "@tanstack/react-query";
import { listPlugins } from "@/ipc/commands";
import type { PluginSetting } from "@/ipc/types";
import { queryKeys } from "@/lib/query-client";
import type { SectionProps } from "./contract";
import { Field, SectionGroup, SwitchRow } from "./fields";
import { HotkeyCapture } from "./HotkeyCapture";

function upsertPluginSetting(list: PluginSetting[], entry: PluginSetting): PluginSetting[] {
  const idx = list.findIndex((p) => p.id === entry.id);
  if (idx >= 0) return list.map((p, i) => (i === idx ? entry : p));
  return [...list, entry];
}

export function PluginsPanel({ draft, set }: SectionProps) {
  const { data } = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });
  const descriptors = data ?? [];

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
    <SectionGroup title="Плагины">
      {descriptors.map((d) => {
        const pref = draft.plugin_settings.find((p) => p.id === d.id);
        const enabled = pref?.enabled ?? d.enabled;
        const hotkey = pref?.hotkey ?? d.hotkey;
        return (
          <div key={d.id} className="flex flex-col gap-2 border-b pb-3 last:border-b-0 last:pb-0">
            <SwitchRow
              checked={enabled}
              onCheckedChange={(v) => {
                set(
                  "plugin_settings",
                  upsertPluginSetting(draft.plugin_settings, {
                    id: d.id,
                    enabled: v,
                    hotkey,
                  }),
                );
              }}
            >
              <span className="font-medium">{d.name}</span>
            </SwitchRow>
            <p className="text-caption text-muted-foreground">{d.description}</p>
            <Field label="Хоткей">
              <HotkeyCapture
                value={hotkey}
                onChange={(hk) => {
                  set(
                    "plugin_settings",
                    upsertPluginSetting(draft.plugin_settings, {
                      id: d.id,
                      enabled,
                      hotkey: hk,
                    }),
                  );
                }}
              />
            </Field>
          </div>
        );
      })}
    </SectionGroup>
  );
}
