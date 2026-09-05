import { Info, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { HOTKEY_ACTIONS } from "@/ipc/bindings";
import {
  actionHint,
  actionLabel,
  defaultCombo,
  effectiveCombo,
  formatCombo,
  groupTitle,
  hotkeyAction,
  type HotkeyAction,
  type HotkeyGroupId,
} from "@/lib/hotkeys";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow } from "../fields";
import { HotkeyCapture } from "../HotkeyCapture";
import { useHotkeyEditor, type HotkeyEditor } from "../useHotkeyEditor";

export function HotkeyRow({ action, editor }: { action: HotkeyAction; editor: HotkeyEditor }) {
  const { t } = useTranslation();
  const combo = effectiveCombo(editor.bindings, action.id);
  const fallback = defaultCombo(action.id);
  const isDefault = combo === fallback;
  return (
    <SettingRow
      label={actionLabel(action.id)}
      hint={combo.trim() === "" ? t("hotkeys.unassignedHint") : actionHint(action.id)}
    >
      <div className="flex w-full items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <HotkeyCapture
            value={combo}
            onChange={(next) => {
              editor.onAssign(action.id, next);
            }}
          />
        </div>
        <IconButton
          title={t("hotkeys.restoreDefault", { combo: formatCombo(fallback) })}
          disabled={isDefault}
          className={isDefault ? "invisible" : undefined}
          onClick={() => {
            editor.onReset(action.id);
          }}
        >
          <RotateCcw />
        </IconButton>
      </div>
    </SettingRow>
  );
}

export function StolenNote({ editor, group }: { editor: HotkeyEditor; group?: HotkeyGroupId }) {
  const { t } = useTranslation();
  if (editor.stolen === null) return null;
  if (group !== undefined && hotkeyAction(editor.stolen.to).group !== group) return null;
  return (
    <div className="flex items-center gap-2 bg-surface px-3 py-2">
      <Info className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <p className="text-caption text-foreground">
        {t("hotkeys.stolen", {
          combo: formatCombo(editor.stolen.combo),
          action: actionLabel(editor.stolen.from),
        })}
      </p>
    </div>
  );
}

export function HotkeysSection({ draft, set }: SectionProps) {
  useTranslation();
  const editor = useHotkeyEditor(draft, set);
  const comboActions = HOTKEY_ACTIONS.filter((a) => a.kind === "combo");
  const groups = comboActions
    .map((a) => a.group)
    .filter((group, index, all) => all.indexOf(group) === index);

  return (
    <>
      {groups.map((group) => (
        <SettingGroup key={group} title={groupTitle(group)}>
          {comboActions
            .filter((a) => a.group === group)
            .map((action) => (
              <HotkeyRow key={action.id} action={action} editor={editor} />
            ))}
          <StolenNote editor={editor} group={group} />
        </SettingGroup>
      ))}
    </>
  );
}
