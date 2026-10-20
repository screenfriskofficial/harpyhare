import { Check, Lock } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { CatalogFailure } from "@/ipc/bindings";
import { missingKeyHint } from "@/lib/api-keys";
import {
  modelGroups,
  modelLabel,
  selectableModels,
  type ModelGroup,
  type ModelInfo,
} from "@/lib/models";
import { errorToastContent } from "@/lib/notify";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import { cn } from "@/lib/utils";

const PROVIDER_HEADING_SEPARATOR = " · ";

function answerGroupHeading(heading: string, group: ModelGroup, groupCount: number): string {
  if (groupCount < 2) return heading;
  return `${heading}${PROVIDER_HEADING_SEPARATOR}${group.label}`;
}

interface ModelCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sttProvider: string;
  providersMissingKey: readonly string[];
  onSwitchSttProvider: (provider: string) => void;
  models: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  activeModelId: string;
  /** Список моделей ещё предварительный — см. `useModels`. */
  modelsPending: boolean;
  /** Вендоры, чей живой каталог не пришёл — см. `useModels`. */
  catalogFailures: readonly CatalogFailure[];
  onSelectModel: (id: string) => void;
  /**
   * Зовётся, когда Radix собирается вернуть фокус после закрытия — ПОСЛЕ
   * exit-анимации. Возврат на триггер отменяется: открытое из дока меню
   * иначе оставляло бы каретку на кнопке дока, а не в поле промпта.
   */
  onRestoreFocus: () => void;
}

/**
 * Строка под заголовком группы, чей каталог не обновился: модели в ней — прежние
 * записи или вшитая таблица, и молча выдавать их за живой список нельзя.
 */
function CatalogFailureNote({ failure }: { failure: CatalogFailure }) {
  const { t } = useTranslation();
  const reason = errorToastContent(failure.error)?.title ?? failure.error.message;
  return (
    <p className="px-2 py-1 text-hint text-muted-foreground" role="note">
      {t("hud.modelMenu.catalogFailed", { reason })}
    </p>
  );
}

function ActiveMark({ active }: { active: boolean }) {
  return <Check className={cn("ml-auto", !active && "invisible")} />;
}

/**
 * Пока живой каталог не пришёл, показываем ЗАГЛУШКИ, а не вшитый список.
 * Разница принципиальная: вшитый список знает не все модели живого каталога,
 * поэтому выбранная модель попадала в группу «Другие» и с приходом настоящего
 * списка прыгала на своё место — выглядело как сбой.
 *
 * Высота строк совпадает с настоящими, поэтому список не дёргается при подмене.
 * Ширины разные: одинаковые полосы читаются как таблица, а не как загрузка.
 */
const PENDING_ROW_WIDTHS = ["9rem", "12rem", "10.5rem"];

function PendingModelRows() {
  return (
    <div className="flex flex-col gap-1 px-2 py-1.5" aria-hidden>
      {PENDING_ROW_WIDTHS.map((width) => (
        <span key={width} className="h-5 animate-pulse rounded-sm bg-surface" style={{ width }} />
      ))}
    </div>
  );
}

function ModelMenuContent({
  onOpenChange,
  sttProvider,
  providersMissingKey,
  onSwitchSttProvider,
  models,
  modelProvidersMissingKey,
  activeModelId,
  modelsPending,
  catalogFailures,
  onSelectModel,
}: ModelCommandMenuProps) {
  const { t } = useTranslation();
  const voiceHeading = t("hud.modelMenu.voice");
  const answerHeading = t("hud.modelMenu.answer");
  const searchPlaceholder = t("hud.modelMenu.placeholder");
  // Известные модели показываем сразу и обычными: они настоящие, из статических
  // реестров, и прятать их ради ещё не пришедшего живого каталога значит
  // заблокировать заведомо рабочий выбор. Предварительность касается ТОЛЬКО
  // неизвестной части — она и уходит в отдельную группу ниже.
  const answerGroups = modelGroups(
    modelsPending ? models : selectableModels(models, activeModelId),
    activeModelId,
  );
  const activeIsKnown = models.some((m) => m.id === activeModelId);
  const close = () => {
    onOpenChange(false);
  };
  return (
    <>
      <CommandInput placeholder={searchPlaceholder} aria-label={searchPlaceholder} />
      <CommandList className="max-h-[min(24rem,65vh)]">
        <CommandEmpty>{t("hud.modelMenu.empty")}</CommandEmpty>
        <CommandGroup heading={voiceHeading}>
          {STT_PROVIDERS.map((p) => {
            const missingKey = providersMissingKey.includes(p.id);
            return (
              <CommandItem
                key={p.id}
                value={`stt-provider:${p.id}`}
                keywords={[p.label, voiceHeading]}
                disabled={missingKey}
                onSelect={() => {
                  onSwitchSttProvider(p.id);
                  close();
                }}
              >
                {missingKey && <Lock aria-hidden />}
                {p.label}
                {missingKey && (
                  <span className="ml-auto text-hint text-muted-foreground">
                    {missingKeyHint()}
                  </span>
                )}
                <ActiveMark active={p.id === sttProvider} />
              </CommandItem>
            );
          })}
        </CommandGroup>
        {answerGroups.map((group) => {
          const locked = modelProvidersMissingKey.includes(group.id);
          const failure = catalogFailures.find((f) => f.provider === group.id);
          return (
            <CommandGroup
              key={group.id}
              heading={answerGroupHeading(answerHeading, group, answerGroups.length)}
            >
              {failure !== undefined && <CatalogFailureNote failure={failure} />}
              {group.models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={`answer:${m.id}`}
                  keywords={[modelLabel(m), answerHeading, group.label]}
                  disabled={locked}
                  onSelect={() => {
                    onSelectModel(m.id);
                    close();
                  }}
                >
                  {locked && <Lock aria-hidden />}
                  <span className="min-w-0 flex-1 leading-snug break-words whitespace-normal">
                    {modelLabel(m)}
                  </span>
                  {locked && (
                    <span className="ml-auto text-hint text-muted-foreground">
                      {missingKeyHint()}
                    </span>
                  )}
                  <ActiveMark active={m.id === activeModelId} />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {modelsPending && (
          <CommandGroup heading={t("hud.modelMenu.pending")}>
            {!activeIsKnown && (
              <CommandItem value={activeModelId} disabled>
                {activeModelId}
                <ActiveMark active />
              </CommandItem>
            )}
            <PendingModelRows />
          </CommandGroup>
        )}
      </CommandList>
    </>
  );
}

export function ModelCommandMenu(props: ModelCommandMenuProps) {
  const { t } = useTranslation();
  return (
    <CommandDialog
      className="flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden"
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={t("hud.modelMenu.title")}
      description={t("hud.modelMenu.description")}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        props.onRestoreFocus();
      }}
    >
      {/* Radix unmounts the contents on close, resetting the search. */}
      <ModelMenuContent {...props} />
    </CommandDialog>
  );
}
