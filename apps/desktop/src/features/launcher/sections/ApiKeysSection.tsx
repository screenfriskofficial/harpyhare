import { Check, Lock } from "lucide-react";
import { AccessCodeForm } from "@/components/AccessCodeForm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

const GROUP_TITLE = "Доступ к API";
const KEYS_DESCRIPTION =
  "Нужен ОДИН ключ для ответов и один для распознавания речи — или код доступа вместо обоих.";
const CODE_DESCRIPTION = "Код доступа работает вместо ключей API — вводить их не нужно.";
const CODE_PARTIAL_DESCRIPTION =
  "Код доступа работает вместо ключей API — свой ключ нужен только для";

function groupDescription(outside: readonly string[], code: boolean): string {
  if (!code) return KEYS_DESCRIPTION;
  return outside.length === 0
    ? CODE_DESCRIPTION
    : `${CODE_PARTIAL_DESCRIPTION} ${outside.join(", ")}.`;
}

function codeRowHint(outside: readonly string[]): string {
  return outside.length === 0
    ? "Отвязка вернёт запросы на ваши ключи API."
    : `Покрывает всё, кроме ${outside.join(", ")} — для них нужен свой ключ ниже.`;
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
  const answersLocked = modelProvidersMissingKey(draft);
  const speechLocked = sttProvidersMissingKey(draft);
  return (
    <>
      <SettingRow label="Отвечают" hint="Достаточно любого одного — модель выбирается в чате.">
        <span className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
          {MODEL_PROVIDERS.map((p) => (
            <VendorState key={p.id} ready={!answersLocked.includes(p.id)} label={p.label} />
          ))}
        </span>
      </SettingRow>
      <SettingRow label="Распознают речь" hint="Активен тот, что выбран на этой же вкладке.">
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
  const info = apiKeyInfo(id);
  return (
    <SettingBlock label={`Ключ ${info.name}`} hint={`Нужен для ${info.purpose}.`}>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          aria-label={`Ключ ${info.name}`}
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
          Где взять
        </Button>
      </div>
    </SettingBlock>
  );
}

export function ApiKeysSection({ draft, set, onRedeem, onUnlink }: ApiKeysSectionProps) {
  const code = hasAccessCode(draft);
  const outside = vendorsOutsideCode();

  return (
    <SettingGroup title={GROUP_TITLE} description={groupDescription(outside, code)}>
      {code ? (
        <SettingRow label="Код доступа активен" hint={codeRowHint(outside)}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void onUnlink();
            }}
          >
            Отвязать
          </Button>
        </SettingRow>
      ) : (
        <SettingBlock label="Код доступа" hint="Быстрый путь: заводить ключи не нужно.">
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
