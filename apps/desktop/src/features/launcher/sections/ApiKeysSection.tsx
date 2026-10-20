import { Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { openExternal } from "@/ipc/commands";
import {
  API_KEY_IDS,
  apiKeyInfo,
  modelProvidersMissingKey,
  sttProvidersMissingKey,
  type ApiKeyId,
} from "@/lib/api-keys";
import { MODEL_PROVIDERS } from "@/lib/models";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import type { SectionProps } from "../contract";
import { SettingBlock, SettingGroup, SettingRow } from "../fields";

const KEY_PLACEHOLDERS: Record<ApiKeyId, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  deepgram: "…",
};

function VendorState({ ready, label }: { ready: boolean; label: string }) {
  const Icon = ready ? Check : Lock;
  return (
    <span className="flex items-center gap-1.5 text-hint text-muted-foreground">
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Which vendors the current keys reach. The point of the screen is no longer
 * "fill both fields" but "any one of these answers, any one of those hears" —
 * so the state of each vendor is shown rather than left to be inferred from
 * whether a field looks filled.
 */
function VendorSummary({ draft }: Pick<SectionProps, "draft">) {
  const { t } = useTranslation();
  const answersLocked = modelProvidersMissingKey(draft);
  const speechLocked = sttProvidersMissingKey(draft);
  return (
    <>
      <SettingRow label={t("launcher.access.answering")} hint={t("launcher.access.answeringHint")}>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {MODEL_PROVIDERS.map((p) => (
            <VendorState key={p.id} ready={!answersLocked.includes(p.id)} label={p.label} />
          ))}
        </span>
      </SettingRow>
      <SettingRow label={t("launcher.access.listening")} hint={t("launcher.access.listeningHint")}>
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {STT_PROVIDERS.map((p) => (
            <VendorState key={p.id} ready={!speechLocked.includes(p.id)} label={p.label} />
          ))}
        </span>
      </SettingRow>
    </>
  );
}

function KeyField({ id, draft, set }: { id: ApiKeyId } & SectionProps) {
  const { t } = useTranslation();
  const info = apiKeyInfo(id);
  const label = t("apiKeys.keyLabel", { name: info.name });
  return (
    <SettingBlock label={label} hint={t("apiKeys.keyHint", { purpose: info.purpose })}>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          aria-label={label}
          placeholder={KEY_PLACEHOLDERS[id]}
          value={draft[`${id}_api_key`]}
          onChange={(e) => {
            set(`${id}_api_key`, e.target.value);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            void openExternal(info.consoleUrl);
          }}
        >
          {t("apiKeys.whereToGet")}
        </Button>
      </div>
    </SettingBlock>
  );
}

export function ApiKeysSection({ draft, set }: SectionProps) {
  const { t } = useTranslation();
  return (
    <SettingGroup
      title={t("launcher.access.title")}
      description={t("launcher.access.keysDescription")}
    >
      <VendorSummary draft={draft} />
      {API_KEY_IDS.map((id) => (
        <KeyField key={id} id={id} draft={draft} set={set} />
      ))}
    </SettingGroup>
  );
}
