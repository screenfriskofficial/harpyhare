import { Lock, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MISSING_KEY_HINT } from "@/lib/api-keys";
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
const POPOVER_LABEL = "Параметры запроса";
const MODEL_PARAM_LABEL = "Модель";
const PRESET_PARAM_LABEL = "Препромпт";
const THINKING_PARAM_LABEL = "Thinking";
const WEB_SEARCH_PARAM_LABEL = "Веб-поиск";

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
  const groups = modelGroups(props.models);
  const showHeadings = groups.length > 1;
  return (
    <Select value={props.value} onValueChange={props.onChange}>
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={MODEL_PARAM_LABEL}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        {groups.map((group) => {
          const locked = props.providersMissingKey.includes(group.id);
          return (
            <SelectGroup key={group.id}>
              {showHeadings && (
                <SelectLabel>
                  {group.label}
                  {locked && (
                    <span className="ml-1.5 text-hint font-normal text-muted-foreground">
                      {MISSING_KEY_HINT}
                    </span>
                  )}
                </SelectLabel>
              )}
              {group.models.map((m) => (
                <SelectItem key={m.id} value={m.id} disabled={locked}>
                  <span className="flex items-center gap-1.5">
                    {locked && <Lock className="size-3" aria-hidden />}
                    {modelLabel(m)}
                  </span>
                </SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}

interface PresetSelectProps {
  presets: { id: string; name: string }[];
  presetId: string;
  onChange: (id: string) => void;
}

function PresetSelect({ presets, presetId, onChange }: PresetSelectProps) {
  const selectedValue =
    presetId !== "" && presets.some((p) => p.id === presetId) ? presetId : NO_PRESET_VALUE;
  return (
    <Select
      value={selectedValue}
      onValueChange={(v) => {
        onChange(v === NO_PRESET_VALUE ? "" : v);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={PRESET_PARAM_LABEL}>
        <SelectValue placeholder={PRESET_PARAM_LABEL} />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={NO_PRESET_VALUE}>Без препромпта</SelectItem>
        {presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name || "Без имени"}
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
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-compact"
          title={POPOVER_LABEL}
          aria-label={POPOVER_LABEL}
        >
          <SlidersHorizontal />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-64 p-3">
        <div className="flex flex-col gap-1">
          <ParamRow label={MODEL_PARAM_LABEL}>
            <ModelSelect
              models={props.modelOptions}
              providersMissingKey={props.modelProvidersMissingKey}
              value={props.chat.model}
              onChange={(model) => {
                props.onPatch(props.chat.id, { model });
              }}
            />
          </ParamRow>
          <ParamRow label={PRESET_PARAM_LABEL}>
            <PresetSelect
              presets={props.presets}
              presetId={props.chat.presetId}
              onChange={(presetId) => {
                props.onPatch(props.chat.id, { presetId });
              }}
            />
          </ParamRow>
          <ParamRow label={THINKING_PARAM_LABEL}>
            <ParamToggle
              label={THINKING_PARAM_LABEL}
              value={props.chat.thinkingEnabled}
              disabled={props.thinkingDisabled}
              onChange={(thinkingEnabled) => {
                props.onPatch(props.chat.id, { thinkingEnabled });
              }}
            />
          </ParamRow>
          <ParamRow label={WEB_SEARCH_PARAM_LABEL}>
            <ParamToggle
              label={WEB_SEARCH_PARAM_LABEL}
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
