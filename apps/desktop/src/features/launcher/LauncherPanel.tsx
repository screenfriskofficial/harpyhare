import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { useOfficialPresets } from "@/hooks/useOfficialPresets";
import type { Settings } from "@/ipc/types";
import { visibleApiKeys } from "@/lib/api-keys";
import { mergePresets } from "@/lib/presets";
import { normalizeDraft } from "@/lib/settings-draft";
import { ContextLibraryPanel } from "./ContextLibraryPanel";
import type { LauncherPanelProps, SetSetting } from "./contract";
import { LaunchBar } from "./LaunchBar";
import { LauncherSearch } from "./LauncherSearch";
import { DEFAULT_SCREEN, type ScreenId } from "./screens";
import { PermissionsScreen } from "./screens/PermissionsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { UpdatesScreen, type CheckState } from "./screens/UpdatesScreen";
import { ScreenShell } from "./ScreenShell";
import { PresetsSection, type PresetsUpdate } from "./sections/PresetsSection";
import { DEFAULT_SETTINGS_TAB, type SettingsTabId } from "./settings-tabs";
import { Sidebar, type SidebarNotice } from "./Sidebar";
import { useDraftAutosave } from "./useDraftAutosave";

const RISE_STEP_MS = 50;

export interface LauncherDestination {
  screen: ScreenId;
  tab?: SettingsTabId;
}

function riseDelay(order: number): CSSProperties {
  return { animationDelay: `${String(order * RISE_STEP_MS)}ms` };
}

export function LauncherPanel({
  settings,
  contextLibrary,
  readiness,
  updater,
  launching,
  saving,
  onRedeem,
  onUnlink,
  onCheckUpdates,
  onSave,
  onLaunch,
}: LauncherPanelProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<Settings>(settings);
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [screen, setScreen] = useState<ScreenId>(DEFAULT_SCREEN);
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>(DEFAULT_SETTINGS_TAB);

  const official = useOfficialPresets();

  const searchSources = useMemo(
    () => ({
      presets: mergePresets(official, draft.prompt_presets).map((p) => ({
        id: p.id,
        name: p.name,
      })),
      quickActions: draft.quick_actions.map((a) => ({ id: a.id, title: a.title })),
      contextDocs: contextLibrary.library.docs.map((d) => ({ id: d.id, name: d.name })),
      apiKeys: visibleApiKeys(draft),
    }),
    [official, draft, contextLibrary.library.docs],
  );

  const sidebarNotices = useMemo<SidebarNotice[]>(
    () => [
      ...readiness.blockers.map((b): SidebarNotice => ({
        screen: b.screen,
        label: b.label,
        kind: "blocker",
      })),
      ...(updater.info === null
        ? []
        : [
            {
              screen: "updates",
              label: t("updates.available", { version: updater.info.version }),
              kind: "info",
            } as const satisfies SidebarNotice,
          ]),
    ],
    [readiness.blockers, updater.info, t],
  );

  const goTo = ({ screen: target, tab }: LauncherDestination) => {
    setScreen(target);
    if (tab !== undefined) setSettingsTab(tab);
  };

  const landed = useRef(false);
  useEffect(() => {
    if (landed.current || readiness.checking) return;
    landed.current = true;
    const blocker = readiness.blockers[0];
    if (!blocker) return;
    setScreen(blocker.screen);
    if (blocker.tab !== undefined) setSettingsTab(blocker.tab);
  }, [readiness.checking, readiness.blockers]);

  useEffect(() => {
    setDraft((d) =>
      d.access_token === settings.access_token ? d : { ...d, access_token: settings.access_token },
    );
  }, [settings.access_token]);

  useDraftAutosave(draft, launching, onSave);

  const checkUpdates = () => {
    setCheckState("checking");
    onCheckUpdates()
      .then((found) => {
        setCheckState(found ? "idle" : "latest");
      })
      .catch((e: unknown) => {
        setCheckState({ failure: String(e) });
      });
  };

  const set: SetSetting = (key, value) => {
    setDraft((d) => ({ ...d, [key]: value }));
  };

  const changePresets = (update: PresetsUpdate) => {
    setDraft((d) => ({ ...d, prompt_presets: update(d.prompt_presets) }));
  };

  return (
    <div className="flex h-screen flex-col gap-2.5 px-4 pt-0 pb-4 sm:px-5">
      <div className="launcher-rise relative z-30" style={riseDelay(0)}>
        <LaunchBar
          readiness={readiness}
          launching={launching}
          saving={saving}
          search={
            <LauncherSearch
              sources={searchSources}
              onNavigate={(hit) => {
                goTo({ screen: hit.screen, tab: hit.tab ?? undefined });
              }}
            />
          }
          onGoToBlocker={(blocker) => {
            goTo({ screen: blocker.screen, tab: blocker.tab });
          }}
          onLaunch={() => {
            onLaunch(normalizeDraft(draft));
          }}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 gap-3 md:gap-4">
        <div className="launcher-rise flex min-h-0" style={riseDelay(1)}>
          <Sidebar
            active={screen}
            notices={sidebarNotices}
            onSelect={(target) => {
              goTo({ screen: target });
            }}
          />
        </div>
        <div className="launcher-rise flex min-h-0 min-w-0 flex-1" style={riseDelay(2)}>
          <div
            key={screen}
            className="flex min-h-0 min-w-0 flex-1 animate-in duration-150 fade-in-0 slide-in-from-bottom-1 motion-reduce:animate-none"
          >
            {screen === "settings" && (
              <SettingsScreen
                draft={draft}
                set={set}
                tab={settingsTab}
                onRedeem={onRedeem}
                onUnlink={onUnlink}
                onTabChange={setSettingsTab}
              />
            )}
            {screen === "permissions" && <PermissionsScreen permissions={readiness.permissions} />}
            {screen === "updates" && (
              <UpdatesScreen updater={updater} checkState={checkState} onCheck={checkUpdates} />
            )}
            {screen === "contexts" && (
              <ScreenShell screen="contexts">
                <ContextLibraryPanel api={contextLibrary} />
              </ScreenShell>
            )}
            {screen === "presets" && (
              <ScreenShell screen="presets">
                <PresetsSection presets={draft.prompt_presets} onChange={changePresets} />
              </ScreenShell>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
