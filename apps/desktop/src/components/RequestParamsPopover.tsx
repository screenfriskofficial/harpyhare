import { Lock, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { missingKeyHint } from "@/lib/api-keys";
import type { Chat, ChatPatch } from "@/lib/chats";
import { modelGroups, modelLabel, type ModelInfo } from "@/lib/models";

export interface RequestParamsPopoverProps {
  chat: Chat;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  presets: { id: string; name: string }[];
  modelOptions: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  thinkingDisabled: boolean;
}

const SELECT_TRIGGER_CLASS = "h-7 w-full text-caption";
const SELECT_CONTENT_POSITION = "popper";
const NO_PRESET_VALUE = "none";

interface ParamToggleProps {
  label: string;
  value: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

function ParamToggle(props: ParamToggleProps) {
  return (
    <Switch
      size="sm"
      aria-label={props.label}
      checked={props.value}
      disabled={props.disabled}
      onCheckedChange={props.onChange}
    />
  );
}

interface ModelSelectProps {
  value: string;
  models: ModelInfo[];
  providersMissingKey: readonly string[];
  onChange: (model: string) => void;
}

function ModelSelect(props: ModelSelectProps) {
  const { t } = useTranslation();
  const groups = modelGroups(props.models);
  const showHeadings = groups.length > 1;
  return (
    <SearchableSelect
      value={props.value}
      onValueChange={props.onChange}
      ariaLabel={t("hud.params.model")}
      placeholder={t("hud.modelMenu.placeholder")}
      emptyLabel={t("hud.modelMenu.empty")}
      options={groups.flatMap((group) => {
        const locked = props.providersMissingKey.includes(group.id);
        return group.models.map((model) => ({
          value: model.id,
          label: modelLabel(model),
          group: showHeadings ? group.label : undefined,
          keywords: [group.label],
          disabled: locked,
          description: locked ? missingKeyHint() : undefined,
          icon: locked ? <Lock className="size-3" aria-hidden /> : undefined,
        }));
      })}
    />
  );
}

interface PresetSelectProps {
  presets: { id: string; name: string }[];
  presetId: string;
  onChange: (id: string) => void;
}

function PresetSelect({ presets, presetId, onChange }: PresetSelectProps) {
  const { t } = useTranslation();
  const presetLabel = t("hud.params.preset");
  const selectedValue =
    presetId !== "" && presets.some((p) => p.id === presetId) ? presetId : NO_PRESET_VALUE;
  return (
    <Select
      value={selectedValue}
      onValueChange={(v) => {
        onChange(v === NO_PRESET_VALUE ? "" : v);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={presetLabel}>
        <SelectValue placeholder={presetLabel} />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={NO_PRESET_VALUE}>{t("hud.params.noPreset")}</SelectItem>
        {presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name || t("common.unnamed")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ParamRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <Label className="w-20 shrink-0">{label}</Label>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  );
}

export function RequestParamsPopover(props: RequestParamsPopoverProps) {
  const { t } = useTranslation();
  // Подпись строки и `aria-label` тумблера — одно значение: разъехаться они могут только молча.
  const thinkingLabel = t("hud.params.thinking");
  const webSearchLabel = t("hud.params.webSearch");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-compact"
          title={t("hud.params.title")}
          aria-label={t("hud.params.title")}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-3">
        <div className="flex flex-col gap-1">
          <ParamRow label={t("hud.params.model")}>
            <ModelSelect
              models={props.modelOptions}
              providersMissingKey={props.modelProvidersMissingKey}
              value={props.chat.model}
              onChange={(model) => {
                props.onPatch(props.chat.id, { model });
              }}
            />
          </ParamRow>
          <ParamRow label={t("hud.params.preset")}>
            <PresetSelect
              presets={props.presets}
              presetId={props.chat.presetId}
              onChange={(presetId) => {
                props.onPatch(props.chat.id, { presetId });
              }}
            />
          </ParamRow>
          <ParamRow label={thinkingLabel}>
            <ParamToggle
              label={thinkingLabel}
              value={props.chat.thinkingEnabled}
              disabled={props.thinkingDisabled}
              onChange={(thinkingEnabled) => {
                props.onPatch(props.chat.id, { thinkingEnabled });
              }}
            />
          </ParamRow>
          <ParamRow label={webSearchLabel}>
            <ParamToggle
              label={webSearchLabel}
              value={props.chat.webSearch}
              onChange={(webSearch) => {
                props.onPatch(props.chat.id, { webSearch });
              }}
            />
          </ParamRow>
        </div>
      </PopoverContent>
    </Popover>
  );
}
