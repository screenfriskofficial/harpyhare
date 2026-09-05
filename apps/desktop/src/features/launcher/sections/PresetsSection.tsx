import { Check, Copy, CopyPlus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/IconButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useOfficialPresets } from "@/hooks/useOfficialPresets";
import { t } from "@/i18n";
import type { PromptPreset } from "@/lib/presets";
import { cn } from "@/lib/utils";
import { SettingGroup } from "../fields";

const PRESET_TEXT_ROWS = 6;
const REVEAL_ON_HOVER_CLASS =
  "pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100";

export type PresetsUpdate = (presets: PromptPreset[]) => PromptPreset[];

function lengthLabel(text: string): string {
  const length = text.trim().length;
  return length === 0 ? t("launcher.presets.emptyLength") : t("units.chars", { count: length });
}

function PresetRow({
  preset,
  onEdit,
  onRemove,
}: {
  preset: PromptPreset;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 transition-colors hover:bg-surface/50">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-body">{preset.name.trim() || t("common.unnamed")}</span>
        <span className="line-clamp-1 text-caption text-muted-foreground">
          {lengthLabel(preset.text)}
          {preset.text.trim() === "" ? "" : ` · ${preset.text.trim()}`}
        </span>
      </div>
      <div className={cn("flex shrink-0 items-center gap-1", REVEAL_ON_HOVER_CLASS)}>
        <IconButton title={t("launcher.presets.edit")} onClick={onEdit}>
          <Pencil />
        </IconButton>
        <IconButton
          title={t("launcher.presets.remove")}
          className="hover:text-destructive"
          onClick={onRemove}
        >
          <Trash2 />
        </IconButton>
      </div>
    </div>
  );
}

function OfficialPresetRow({
  preset,
  expanded,
  onToggle,
  onCopyToOwn,
}: {
  preset: PromptPreset;
  expanded: boolean;
  onToggle: () => void;
  onCopyToOwn: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="group flex flex-col gap-1.5 px-3 py-2 transition-colors hover:bg-surface/50">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <button
          type="button"
          aria-expanded={expanded}
          title={expanded ? t("launcher.presets.collapse") : t("launcher.presets.expand")}
          onClick={onToggle}
          className="flex min-w-0 flex-col gap-0.5 text-left"
        >
          <span className="truncate text-body">{preset.name}</span>
          {!expanded && (
            <span className="line-clamp-1 text-caption text-muted-foreground">{preset.text}</span>
          )}
        </button>
        <div className={cn("flex shrink-0 items-center gap-1", !expanded && REVEAL_ON_HOVER_CLASS)}>
          <IconButton
            title={t("launcher.presets.copyText")}
            onClick={() => {
              void navigator.clipboard.writeText(preset.text);
            }}
          >
            <Copy />
          </IconButton>
          <IconButton title={t("launcher.presets.copyToOwn")} onClick={onCopyToOwn}>
            <CopyPlus />
          </IconButton>
        </div>
      </div>
      {expanded && (
        <div className="max-h-64 overflow-y-auto text-caption whitespace-pre-wrap text-muted-foreground">
          {preset.text}
        </div>
      )}
    </div>
  );
}

function PresetEditor({
  preset,
  onChange,
  onDone,
}: {
  preset: PromptPreset;
  onChange: (patch: Partial<PromptPreset>) => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-2 bg-surface px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Input
          autoFocus
          aria-label={t("launcher.presets.name")}
          placeholder={t("launcher.presets.namePlaceholder")}
          value={preset.name}
          onChange={(e) => {
            onChange({ name: e.target.value });
          }}
        />
        <Button onClick={onDone}>
          <Check />
          {t("common.done")}
        </Button>
      </div>
      <Textarea
        rows={PRESET_TEXT_ROWS}
        aria-label={t("launcher.presets.text")}
        placeholder={t("launcher.presets.textPlaceholder")}
        value={preset.text}
        onChange={(e) => {
          onChange({ text: e.target.value });
        }}
        className="max-h-64 overflow-y-auto"
      />
      {/* Единственное место, где объясняется синтаксис: называет пользу, а не механизм. */}
      <p className="text-hint text-muted-foreground">{t("launcher.presets.keywordsHint")}</p>
    </div>
  );
}

export function PresetsSection({
  presets,
  onChange,
}: {
  presets: PromptPreset[];
  onChange: (update: PresetsUpdate) => void;
}) {
  const { t } = useTranslation();
  const official = useOfficialPresets();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedOfficialId, setExpandedOfficialId] = useState<string | null>(null);

  const updateAt = (index: number, patch: Partial<PromptPreset>) => {
    onChange((ps) => ps.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };
  const removeAt = (index: number) => {
    onChange((ps) => ps.filter((_, i) => i !== index));
  };
  const add = () => {
    const id = crypto.randomUUID();
    onChange((ps) => [...ps, { id, name: "", text: "" }]);
    setEditingId(id);
  };
  const copyToOwn = (preset: PromptPreset) => {
    const id = crypto.randomUUID();
    onChange((ps) => [
      ...ps,
      { id, name: `${preset.name}${t("launcher.presets.copySuffix")}`, text: preset.text },
    ]);
    setEditingId(id);
  };

  return (
    <>
      <SettingGroup
        title={t("launcher.presets.title")}
        description={t("launcher.presets.description")}
      >
        {presets.length === 0 && (
          <div className="flex flex-col items-start gap-2 px-3 py-4">
            <span className="text-body">{t("launcher.presets.empty")}</span>
            <span className="max-w-prose text-caption text-muted-foreground">
              {t("launcher.presets.emptyHint")}
            </span>
            <Button size="sm" onClick={add}>
              <Plus />
              {t("launcher.presets.create")}
            </Button>
          </div>
        )}
        {presets.map((preset, index) =>
          editingId === preset.id ? (
            <PresetEditor
              key={preset.id}
              preset={preset}
              onChange={(patch) => {
                updateAt(index, patch);
              }}
              onDone={() => {
                setEditingId(null);
              }}
            />
          ) : (
            <PresetRow
              key={preset.id}
              preset={preset}
              onEdit={() => {
                setEditingId(preset.id);
              }}
              onRemove={() => {
                removeAt(index);
              }}
            />
          ),
        )}
        {presets.length > 0 && (
          <div className="px-3 py-2">
            <Button variant="ghost" size="sm" onClick={add}>
              <Plus />
              {t("launcher.presets.add")}
            </Button>
          </div>
        )}
      </SettingGroup>

      <SettingGroup
        title={t("launcher.presets.builtIn")}
        description={t("launcher.presets.builtInDescription")}
      >
        {official.map((preset) => (
          <OfficialPresetRow
            key={preset.id}
            preset={preset}
            expanded={expandedOfficialId === preset.id}
            onToggle={() => {
              setExpandedOfficialId((current) => (current === preset.id ? null : preset.id));
            }}
            onCopyToOwn={() => {
              copyToOwn(preset);
            }}
          />
        ))}
      </SettingGroup>
    </>
  );
}
