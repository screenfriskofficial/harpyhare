import type { ContextLibraryApi } from "@/hooks/useContextLibrary";
import type { UpdaterApi } from "@/hooks/useUpdater";
import type { Settings, UpdateInfo } from "@/ipc/types";
import type { LauncherReadiness } from "./useLauncherReadiness";

export type SetSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => void;

export interface SectionProps {
  draft: Settings;
  set: SetSetting;
}

export interface LauncherPanelProps {
  settings: Settings;
  contextLibrary: ContextLibraryApi;
  readiness: LauncherReadiness;
  updater: UpdaterApi;
  launching: boolean;
  saving: boolean;
  onRedeem: (code: string) => Promise<string | null>;
  onUnlink: () => Promise<void>;
  onCheckUpdates: () => Promise<UpdateInfo | null>;
  onSave: (next: Settings) => void;
  onPrepare: (next: Settings) => Promise<boolean>;
  onLaunch: (next: Settings) => void;
}
