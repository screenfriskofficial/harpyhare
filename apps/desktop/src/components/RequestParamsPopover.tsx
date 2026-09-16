import { Lock, SlidersHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { NoticeDot } from "@/components/NoticeDot";
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
import { modelGroups, modelLabel, modelIdHint, type ModelInfo } from "@/lib/models";
import type { Pipeline, PipelineKind } from "@/lib/pipeline-types";
import { findPipeline, pipelinesOfKind } from "@/lib/pipelines";

export interface RequestParamsPopoverProps {
  chat: Chat;
  onPatch: (chatId: string, patch: ChatPatch) => void;
  presets: { id: string; name: string }[];
  /** Every saved pipeline; each row shows the ones of its kind. */
  pipelines: Pipeline[];
  /** Until the library is read, a chat's choice can be neither shown nor changed. */
  pipelinesReady: boolean;
  modelOptions: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  thinkingDisabled: boolean;
  /**
   * The popover has closed and Radix's own return of focus to the trigger is
   * suppressed. `pressedOutside` is what the dismissing press landed on, or
   * `null` when it closed from the keyboard or its own trigger; the caller
   * decides whether the caret goes back to the prompt field.
   */
  onClosed: (pressedOutside: Element | null) => void;
}

const SELECT_TRIGGER_CLASS = "h-7 w-full text-caption";
const SELECT_CONTENT_POSITION = "popper";
/** Radix cannot carry an empty item value, so «none» travels under a sentinel in every select here. */
const NONE_OPTION_VALUE = "none";
/** A chat pointing at a deleted pipeline keeps pointing until the user picks another. */
const UNAVAILABLE_PIPELINE_VALUE = "unavailable";

/** Nothing until the library is read; then «none», the known pipeline, or the disabled «unavailable» row. */
function pipelineSelectValue(
  ready: boolean,
  selectedId: string | undefined,
  known: boolean,
): string {
  if (!ready) return "";
  if (selectedId === undefined) return NONE_OPTION_VALUE;
  return known ? selectedId : UNAVAILABLE_PIPELINE_VALUE;
}

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
  const groups = modelGroups(props.models, props.value);
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
          description: locked ? missingKeyHint() : modelIdHint(model),
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
    presetId !== "" && presets.some((p) => p.id === presetId) ? presetId : NONE_OPTION_VALUE;
  return (
    <Select
      value={selectedValue}
      onValueChange={(v) => {
        onChange(v === NONE_OPTION_VALUE ? "" : v);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={presetLabel}>
        <SelectValue placeholder={presetLabel} />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={NONE_OPTION_VALUE}>{t("hud.params.noPreset")}</SelectItem>
        {presets.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name || t("common.unnamed")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

interface PipelineSelectProps {
  label: string;
  kind: PipelineKind;
  pipelines: Pipeline[];
  selectedId: string | undefined;
  ready: boolean;
  onChange: (id: string | undefined) => void;
}

/**
 * Pipelines are built in the launcher and only chosen here, like presets. A
 * chat keeps its choice per kind: preparation of the system prompt and the
 * processing of each message are independent.
 */
function PipelineSelect(props: PipelineSelectProps) {
  const { t } = useTranslation();
  const options = pipelinesOfKind(props.pipelines, props.kind);
  const known = findPipeline(options, props.selectedId, props.kind) !== undefined;
  const value = pipelineSelectValue(props.ready, props.selectedId, known);
  return (
    <Select
      value={value}
      disabled={!props.ready}
      onValueChange={(v) => {
        if (v === UNAVAILABLE_PIPELINE_VALUE) return;
        props.onChange(v === NONE_OPTION_VALUE ? undefined : v);
      }}
    >
      <SelectTrigger className={SELECT_TRIGGER_CLASS} aria-label={props.label}>
        <SelectValue placeholder={t("hud.params.pipelinesLoading")} />
      </SelectTrigger>
      <SelectContent position={SELECT_CONTENT_POSITION}>
        <SelectItem value={NONE_OPTION_VALUE}>{t("hud.params.noPipeline")}</SelectItem>
        {props.selectedId !== undefined && !known && (
          <SelectItem value={UNAVAILABLE_PIPELINE_VALUE} disabled>
            {t("hud.params.pipelineUnavailable")}
          </SelectItem>
        )}
        {options.map((pipeline) => (
          <SelectItem key={pipeline.id} value={pipeline.id}>
            {pipeline.name || t("common.unnamed")}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ParamRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2">
      <Label className="w-24 shrink-0">{label}</Label>
      <div className="flex min-w-0 flex-1 items-center justify-end">{children}</div>
    </div>
  );
}

export function RequestParamsPopover(props: RequestParamsPopoverProps) {
  const { t } = useTranslation();
  // Подпись строки и `aria-label` тумблера — одно значение: разъехаться они могут только молча.
  const thinkingLabel = t("hud.params.thinking");
  const webSearchLabel = t("hud.params.webSearch");
  const promptPipelineLabel = t("hud.params.promptPipeline");
  const messagePipelineLabel = t("hud.params.messagePipeline");
  // A pipeline rewrites what the chat sends, invisibly to the transcript: the
  // dot is the only permanent trace of it in the HUD.
  const pipelineActive = !!props.chat.promptPipelineId || !!props.chat.messagePipelineId;
  // Radix dispatches the outside-interaction event on the element that was
  // pressed, so this is where the caret question gets its answer.
  const pressedOutside = useRef<Element | null>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-compact"
          className="relative"
          title={pipelineActive ? t("hud.params.pipelineActive") : t("hud.params.title")}
          aria-label={t("hud.params.title")}
        >
          <SlidersHorizontal />
          {pipelineActive && <NoticeDot />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="w-72 p-3"
        onInteractOutside={(event) => {
          pressedOutside.current = event.target instanceof Element ? event.target : null;
        }}
        // Radix would refocus the trigger button (and, after an outside press,
        // nothing at all); the composer knows better where the caret belongs.
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          props.onClosed(pressedOutside.current);
          pressedOutside.current = null;
        }}
      >
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
          <ParamRow label={promptPipelineLabel}>
            <PipelineSelect
              label={promptPipelineLabel}
              kind="prompt"
              pipelines={props.pipelines}
              selectedId={props.chat.promptPipelineId}
              ready={props.pipelinesReady}
              onChange={(promptPipelineId) => {
                // The prepared text belongs to the pipeline that produced it.
                props.onPatch(props.chat.id, { promptPipelineId, preparedPrompt: undefined });
              }}
            />
          </ParamRow>
          <ParamRow label={messagePipelineLabel}>
            <PipelineSelect
              label={messagePipelineLabel}
              kind="message"
              pipelines={props.pipelines}
              selectedId={props.chat.messagePipelineId}
              ready={props.pipelinesReady}
              onChange={(messagePipelineId) => {
                props.onPatch(props.chat.id, { messagePipelineId });
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
