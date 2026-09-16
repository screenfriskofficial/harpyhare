import { Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SelectItem } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ContextLibrary } from "@/lib/context-library";
import type { ModelInfo } from "@/lib/models";
import type { Pipeline, PipelineInput, PipelineNode } from "@/lib/pipeline-types";
import { removePipelineNode, updatePipelineNode } from "@/lib/pipelines";
import {
  escapeSeparator,
  folderMemberOptions,
  isSeparatorPresetId,
  ROOT_FOLDER_VALUE,
  SEPARATOR_PRESET_IDS,
  SEPARATOR_PRESETS,
  separatorPreset,
  sourceChoices,
  unescapeSeparator,
} from "./editor-model";
import { PipelineField, PipelineSelectField, PipelineSwitch } from "./fields";
import { PipelineConnections } from "./PipelineConnections";

// Radix selects cannot carry an empty item value, so the empty ids of the
// domain («the chat's model», a folder's live membership) travel under sentinels.
const CHAT_MODEL_VALUE = "chat";
const LIVE_FOLDER_VALUE = "all";
const CUSTOM_SEPARATOR_VALUE = "custom";
const SUBSET_FOLDER_VALUE = "subset";

type Patch = (patch: Partial<PipelineNode>) => void;

/** Which document, preset or folder the node reads; a deleted source stays visible as a disabled row. */
function SourceSelect({
  node,
  input,
  patch,
}: {
  node: PipelineNode;
  input: PipelineInput;
  patch: Patch;
}) {
  const { t } = useTranslation();
  const { choices, value, found } = sourceChoices(node, input);
  return (
    <>
      <PipelineSelectField
        label={t("pipelines.editor.source")}
        value={value}
        placeholder={t("pipelines.editor.chooseSource")}
        onValueChange={(next) => {
          patch({ sourceId: next === ROOT_FOLDER_VALUE ? "" : next, folderDocIds: undefined });
        }}
      >
        {!found && value !== "" && (
          <SelectItem value={value} disabled>
            {t("pipelines.editor.missing")}
          </SelectItem>
        )}
        {choices.map((choice) => (
          <SelectItem key={choice.id} value={choice.id}>
            {choice.name}
          </SelectItem>
        ))}
      </PipelineSelectField>
      <p className="text-caption text-muted-foreground">{t("pipelines.editor.sourceHint")}</p>
    </>
  );
}

/** Live membership follows the library; a pinned subset keeps the chosen ids even after documents move. */
function FolderMembership({
  node,
  library,
  patch,
}: {
  node: PipelineNode;
  library: ContextLibrary;
  patch: Patch;
}) {
  const { t } = useTranslation();
  const members = folderMemberOptions(node, library);
  const pinned = node.folderDocIds;
  return (
    <>
      <PipelineSelectField
        label={t("pipelines.editor.membership")}
        value={pinned === undefined ? LIVE_FOLDER_VALUE : SUBSET_FOLDER_VALUE}
        onValueChange={(value) => {
          patch({
            folderDocIds:
              value === LIVE_FOLDER_VALUE
                ? undefined
                : library.docs.filter((doc) => doc.folderId === node.sourceId).map((doc) => doc.id),
          });
        }}
      >
        <SelectItem value={LIVE_FOLDER_VALUE}>{t("pipelines.editor.liveFolder")}</SelectItem>
        <SelectItem value={SUBSET_FOLDER_VALUE}>{t("pipelines.editor.subset")}</SelectItem>
      </PipelineSelectField>
      <div className="flex max-h-40 flex-col gap-2 overflow-y-auto rounded-md bg-surface p-2">
        {members.length === 0 && (
          <p className="text-caption text-muted-foreground">{t("pipelines.editor.emptyFolder")}</p>
        )}
        {members.map((doc) =>
          pinned === undefined ? (
            <p key={doc.id} className="truncate text-caption">
              {doc.name}
            </p>
          ) : (
            <PipelineSwitch
              key={doc.id}
              label={doc.name}
              checked={pinned.includes(doc.id)}
              onChange={(checked) => {
                patch({
                  folderDocIds: checked
                    ? [...pinned, doc.id]
                    : pinned.filter((id) => id !== doc.id),
                });
              }}
            />
          ),
        )}
      </div>
    </>
  );
}

/**
 * Named choices first; the free-form field appears only when asked for, with
 * escapes spelled out, so the stored value is never invisible whitespace.
 */
function SeparatorField({
  value,
  onChange,
}: {
  value: string;
  onChange: (separator: string) => void;
}) {
  const { t } = useTranslation();
  const [custom, setCustom] = useState(() => separatorPreset(value) === null);
  // The text as typed, escapes and all: the stored value must never be empty,
  // so a cleared field keeps the last separator until something is typed.
  const [draft, setDraft] = useState(() => escapeSeparator(value));
  const preset = custom ? null : separatorPreset(value);
  return (
    <>
      <PipelineSelectField
        label={t("pipelines.editor.separator")}
        value={preset ?? CUSTOM_SEPARATOR_VALUE}
        onValueChange={(next) => {
          if (next === CUSTOM_SEPARATOR_VALUE) {
            setCustom(true);
            return;
          }
          if (!isSeparatorPresetId(next)) return;
          setCustom(false);
          onChange(SEPARATOR_PRESETS[next]);
        }}
      >
        {SEPARATOR_PRESET_IDS.map((id) => (
          <SelectItem key={id} value={id}>
            {t(`pipelines.editor.separators.${id}`)}
          </SelectItem>
        ))}
        <SelectItem value={CUSTOM_SEPARATOR_VALUE}>
          {t("pipelines.editor.separators.custom")}
        </SelectItem>
      </PipelineSelectField>
      {custom && (
        <PipelineField label={t("pipelines.editor.separatorCustom")}>
          <Input
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              const next = unescapeSeparator(e.target.value);
              if (next !== "") onChange(next);
            }}
          />
        </PipelineField>
      )}
      <p className="text-caption text-muted-foreground">{t("pipelines.editor.separatorHint")}</p>
    </>
  );
}

export function PipelineInspector({
  pipeline,
  node,
  input,
  models,
  onChange,
  disabled,
}: {
  pipeline: Pipeline;
  node: PipelineNode;
  input: PipelineInput;
  models: ModelInfo[];
  onChange: (pipeline: Pipeline) => void;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const patch: Patch = (next) => {
    onChange(updatePipelineNode(pipeline, node.id, next));
  };
  const effectiveModel = models.find((model) => model.id === (node.model || input.model));
  const hasSource = node.kind === "folder" || node.kind === "document" || node.kind === "preset";
  return (
    <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-3">
      {disabled && (
        <p className="text-caption text-muted-foreground">
          {t("pipelines.editor.runningEditHint")}
        </p>
      )}
      <PipelineField label={t("pipelines.editor.name")}>
        <Input
          value={node.name}
          onChange={(e) => {
            patch({ name: e.target.value });
          }}
        />
      </PipelineField>
      {hasSource && <SourceSelect node={node} input={input} patch={patch} />}
      {node.kind === "folder" && (
        <FolderMembership node={node} library={input.library} patch={patch} />
      )}
      {(node.kind === "text" || node.kind === "llm") && (
        <>
          <PipelineField
            label={
              node.kind === "llm" ? t("pipelines.editor.instruction") : t("pipelines.editor.text")
            }
          >
            <Textarea
              rows={5}
              value={node.text}
              onChange={(e) => {
                patch({ text: e.target.value });
              }}
              className="max-h-56 overflow-y-auto"
            />
          </PipelineField>
          {node.kind === "llm" && (
            <p className="text-caption text-muted-foreground">
              {t("pipelines.editor.instructionHint")}
            </p>
          )}
        </>
      )}
      {(node.kind === "llm" || node.kind === "output" || node.kind === "folder") && (
        <SeparatorField
          // Keyed per node like the connections block below, with its own prefix:
          // two siblings sharing a key make React drop or duplicate one of them.
          key={`separator-${node.id}`}
          value={node.separator}
          onChange={(separator) => {
            patch({ separator });
          }}
        />
      )}
      {node.kind === "llm" && (
        <>
          <PipelineSelectField
            label={t("pipelines.editor.model")}
            value={node.model === "" ? CHAT_MODEL_VALUE : node.model}
            onValueChange={(value) => {
              patch({ model: value === CHAT_MODEL_VALUE ? "" : value });
            }}
          >
            <SelectItem value={CHAT_MODEL_VALUE}>{t("pipelines.editor.chatModel")}</SelectItem>
            {node.model !== "" && !models.some((model) => model.id === node.model) && (
              <SelectItem value={node.model}>{node.model}</SelectItem>
            )}
            {models.map((model) => (
              <SelectItem key={model.id} value={model.id}>
                {model.displayName}
              </SelectItem>
            ))}
          </PipelineSelectField>
          <PipelineSwitch
            label={t("pipelines.editor.thinking")}
            checked={node.thinking || effectiveModel?.alwaysThinks === true}
            disabled={effectiveModel?.alwaysThinks === true}
            onChange={(thinking) => {
              patch({ thinking });
            }}
          />
          <PipelineSwitch
            label={t("pipelines.editor.web")}
            checked={node.webSearch}
            onChange={(webSearch) => {
              patch({ webSearch });
            }}
          />
          <PipelineSwitch
            label={t("pipelines.editor.bypass")}
            checked={!node.enabled}
            onChange={(bypass) => {
              patch({ enabled: !bypass });
            }}
          />
          {!node.enabled && (
            <p className="text-caption text-muted-foreground">{t("pipelines.editor.bypassHint")}</p>
          )}
        </>
      )}
      {node.kind === "output" && (
        <p className="text-caption text-muted-foreground">{t("pipelines.editor.outputHint")}</p>
      )}
      {node.kind === "message" && (
        <p className="text-caption text-muted-foreground">{t("pipelines.editor.messageHint")}</p>
      )}
      {node.kind === "history" && (
        <p className="text-caption text-muted-foreground">{t("pipelines.editor.historyHint")}</p>
      )}
      {node.kind === "chatContext" && (
        <p className="text-caption text-muted-foreground">
          {t("pipelines.editor.chatContextHint")}
        </p>
      )}
      <PipelineConnections key={node.id} pipeline={pipeline} node={node} onChange={onChange} />
      <div className="flex flex-col gap-1 border-t pt-3">
        <Button
          size="sm"
          variant="ghost"
          className="justify-start text-destructive"
          onClick={() => {
            onChange(removePipelineNode(pipeline, node.id));
          }}
        >
          <Trash2 />
          {t("pipelines.editor.remove")}
        </Button>
        {hasSource && (
          <p className="text-hint text-muted-foreground">{t("pipelines.editor.removeHint")}</p>
        )}
      </div>
    </fieldset>
  );
}
