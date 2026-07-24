import type { ContextLibraryApi } from "@/hooks/useContextLibrary";
import { ContextLibraryPanel } from "./ContextLibraryPanel";
import type { SectionProps } from "./contract";
import { SectionGroup } from "./fields";
import { IdentityPanel } from "./IdentityPanel";
import { PluginsPanel } from "./PluginsPanel";
import { ApiKeysSection } from "./sections/ApiKeysSection";
import { AppearanceSection } from "./sections/AppearanceSection";
import { BehaviorSection } from "./sections/BehaviorSection";
import { HotkeysSection } from "./sections/HotkeysSection";
import { PresetsSection, type PresetsUpdate } from "./sections/PresetsSection";
import { SttSection } from "./sections/SttSection";
import type { TabId } from "./tabs";

type TabContentProps = SectionProps & {
  tab: TabId;
  contextLibrary: ContextLibraryApi;
  currentIdentityId: string;
  onRedeem: (code: string) => Promise<string | null>;
  onPresetsChange: (update: PresetsUpdate) => void;
};

function TabBody({
  tab,
  draft,
  set,
  contextLibrary,
  currentIdentityId,
  onRedeem,
  onPresetsChange,
}: TabContentProps) {
  switch (tab) {
    case "main":
      return (
        <>
          <SectionGroup title="Доступ">
            <ApiKeysSection draft={draft} set={set} onRedeem={onRedeem} />
          </SectionGroup>
          <SectionGroup title="Распознавание речи">
            <SttSection draft={draft} set={set} />
          </SectionGroup>
        </>
      );
    case "contexts":
      return <ContextLibraryPanel api={contextLibrary} />;
    case "hotkeys":
      return (
        <SectionGroup title="Горячие клавиши">
          <HotkeysSection draft={draft} set={set} />
        </SectionGroup>
      );
    case "behavior":
      return (
        <SectionGroup title="Поведение">
          <BehaviorSection draft={draft} set={set} />
        </SectionGroup>
      );
    case "appearance":
      return (
        <SectionGroup title="Вид">
          <AppearanceSection draft={draft} set={set} />
        </SectionGroup>
      );
    case "identity":
      return <IdentityPanel currentIdentityId={currentIdentityId} />;
    case "presets":
      return <PresetsSection presets={draft.prompt_presets} onChange={onPresetsChange} />;
    case "plugins":
      return <PluginsPanel draft={draft} set={set} />;
  }
}

export function TabContent(props: TabContentProps) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <TabBody {...props} />
    </div>
  );
}
