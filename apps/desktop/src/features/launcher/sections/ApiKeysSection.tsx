import { Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AccessCodeForm } from "@/components/AccessCodeForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { openExternal } from "@/ipc/commands";
import {
  apiKeyInfo,
  hasAccessCode,
  modelProvidersMissingKey,
  sttProvidersMissingKey,
  vendorsOutsideCode,
  visibleApiKeys,
  type ApiKeyId,
} from "@/lib/api-keys";
import { MODEL_PROVIDERS } from "@/lib/models";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import type { SectionProps } from "../contract";
import { SettingBlock, SettingGroup, SettingRow } from "../fields";

type ApiKeysSectionProps = SectionProps & {
  onRedeem: (code: string) => Promise<string | null>;
  onUnlink: () => Promise<void>;
};

const KEY_PLACEHOLDERS: Record<ApiKeyId, string> = {
  anthropic: "sk-ant-…",
  groq: "gsk_…",
  openai: "sk-…",
  xai: "xai-…",
  deepgram: "…",
  xclis: "sk-…",
};

const VENDOR_LIST_SEPARATOR = ", ";

function groupDescription(outside: readonly string[], code: boolean): string {
  if (!code) return t("launcher.access.keysDescription");
  return outside.length === 0
    ? t("launcher.access.codeDescription")
    : t("launcher.access.codePartialDescription", { vendors: outside.join(VENDOR_LIST_SEPARATOR) });
}

function codeRowHint(outside: readonly string[]): string {
  return outside.length === 0
    ? t("launcher.access.unlinkHint")
    : t("launcher.access.coveredExcept", { vendors: outside.join(VENDOR_LIST_SEPARATOR) });
}

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

export function ApiKeysSection({ draft, set, onRedeem, onUnlink }: ApiKeysSectionProps) {
  const { t } = useTranslation();
  const code = hasAccessCode(draft);
  const outside = vendorsOutsideCode();

  return (
    <SettingGroup title={t("launcher.access.title")} description={groupDescription(outside, code)}>
      {code ? (
        <SettingRow label={t("launcher.access.codeActive")} hint={codeRowHint(outside)}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void onUnlink();
            }}
          >
            {t("launcher.access.unlink")}
          </Button>
        </SettingRow>
      ) : (
        <SettingBlock label={t("launcher.access.code")} hint={t("launcher.access.codeHint")}>
          <AccessCodeForm onRedeem={onRedeem} />
        </SettingBlock>
      )}
      <VendorSummary draft={draft} />
      {visibleApiKeys(draft).map((id) => (
        <KeyField key={id} id={id} draft={draft} set={set} />
      ))}
    </SettingGroup>
  );
}
