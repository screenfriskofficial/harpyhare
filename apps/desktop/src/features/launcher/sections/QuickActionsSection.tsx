import { Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MODIFIER_COMBOS, QUICK_ACTION_LIMIT } from "@/ipc/bindings";
import type { QuickAction } from "@/ipc/types";
import {
  actionHint,
  actionLabel,
  effectiveCombo,
  formatCombo,
  type HotkeyActionId,
} from "@/lib/hotkeys";
import { PLATFORM } from "@/lib/platform";
import { filledQuickActions, newQuickAction, quickActionHint } from "@/lib/quick-actions";
import type { SectionProps } from "../contract";
import { SettingGroup, SettingRow, SettingSelect, SettingSwitch } from "../fields";
import { useHotkeyEditor } from "../useHotkeyEditor";
import { StolenNote } from "./HotkeysSection";

const QUICK_ACTION: HotkeyActionId = "quick_action";
const PLATFORM_MODIFIERS: readonly string[] = MODIFIER_COMBOS[PLATFORM];
const PROMPT_ROWS = 2;

function comboByActionId(actions: QuickAction[], modifier: string): Map<string, string> {
  const combos = new Map<string, string>();
  filledQuickActions(actions).forEach((action, index) => {
    const hint = quickActionHint(modifier, index);
    if (hint !== null) combos.set(action.id, hint);
  });
  return combos;
}

function QuickActionRow({
  action,
  combo,
  onChange,
  onRemove,
}: {
  action: QuickAction;
  combo: string;
  onChange: (patch: Partial<QuickAction>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          aria-label={t("launcher.quickActions.name")}
          placeholder={t("launcher.quickActions.namePlaceholder")}
          value={action.title}
          onChange={(e) => {
            onChange({ title: e.target.value });
          }}
        />
        <span className="min-w-10 shrink-0 text-right font-mono text-caption text-muted-foreground tabular-nums">
          {combo}
        </span>
        <IconButton
          title={t("launcher.quickActions.remove")}
          className="hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      </div>
      <Textarea
        rows={PROMPT_ROWS}
        aria-label={t("launcher.quickActions.prompt")}
        placeholder={t("launcher.quickActions.promptPlaceholder")}
        value={action.prompt}
        onChange={(e) => {
          onChange({ prompt: e.target.value });
        }}
        className="max-h-64 overflow-y-auto"
      />
    </div>
  );
}

export function QuickActionsSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  const editor = useHotkeyEditor(draft, set);
  const attachmentsLabel = t("launcher.quickActions.attachments");
  const modifier = effectiveCombo(draft.hotkeys, QUICK_ACTION);
  const actions = draft.quick_actions;
  const combos = comboByActionId(actions, modifier);
  const atLimit = actions.length >= QUICK_ACTION_LIMIT;

  const updateAt = (index: number, patch: Partial<QuickAction>) => {
    set(
      "quick_actions",
      actions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  };
  const removeAt = (index: number) => {
    set(
      "quick_actions",
      actions.filter((_, i) => i !== index),
    );
  };
  const add = () => {
    set("quick_actions", [...actions, newQuickAction()]);
  };

  return (
    <SettingGroup
      title={t("launcher.quickActions.title")}
      description={t("launcher.quickActions.description")}
    >
      <SettingRow label={t("launcher.quickActions.combo")} hint={actionHint(QUICK_ACTION)}>
        <SettingSelect
          ariaLabel={t("launcher.quickActions.comboAria", { action: actionLabel(QUICK_ACTION) })}
          value={modifier}
          onValueChange={(v) => {
            editor.onAssign(QUICK_ACTION, v);
          }}
        >
          {PLATFORM_MODIFIERS.map((m) => (
            <SelectItem key={m} value={m}>
              {t("launcher.quickActions.modifierDigit", { combo: formatCombo(m) })}
            </SelectItem>
          ))}
        </SettingSelect>
      </SettingRow>
      <StolenNote editor={editor} />

      <SettingRow label={attachmentsLabel} hint={t("launcher.quickActions.attachmentsHint")}>
        <SettingSwitch
          ariaLabel={attachmentsLabel}
          checked={draft.quick_action_attachments}
          onCheckedChange={(v) => {
            set("quick_action_attachments", v);
          }}
        />
      </SettingRow>

      {actions.length === 0 && (
        <p className="px-3 py-2.5 text-caption text-muted-foreground">
          {t("launcher.quickActions.empty")}
        </p>
      )}
      {actions.map((quickAction, index) => (
        <QuickActionRow
          key={quickAction.id}
          action={quickAction}
          combo={combos.get(quickAction.id) ?? ""}
          onChange={(patch) => {
            updateAt(index, patch);
          }}
          onRemove={() => {
            removeAt(index);
          }}
        />
      ))}
      <div className="flex items-center gap-3 px-3 py-2">
        <Button variant="ghost" size="sm" disabled={atLimit} onClick={add}>
          <Plus />
          {t("common.add")}
        </Button>
        {atLimit && (
          <span className="text-caption text-muted-foreground">
            {t("launcher.quickActions.limit", { limit: QUICK_ACTION_LIMIT })}
          </span>
        )}
      </div>
    </SettingGroup>
  );
}
