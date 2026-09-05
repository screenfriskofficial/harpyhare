import { ArrowLeft, Check, ChevronRight, Lock } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { SttCatalogStatus } from "@/components/SttCatalogStatus";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import type { SttModelsState } from "@/hooks/useSttModels";
import { missingKeyHint } from "@/lib/api-keys";
import {
  modelGroups,
  modelLabel,
  OPENROUTER_PROVIDER,
  selectableModels,
  type ModelGroup,
  type ModelInfo,
} from "@/lib/models";
import { sttModelOptions } from "@/lib/stt-models";
import { OPENROUTER_STT_PROVIDER, STT_PROVIDERS } from "@/lib/stt-providers";
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
  activeSttModelId: string;
  sttCatalog: SttModelsState;
  onSelectSttModel: (id: string) => void;
  providersMissingKey: readonly string[];
  onSwitchSttProvider: (provider: string) => void;
  models: ModelInfo[];
  modelProvidersMissingKey: readonly string[];
  activeModelId: string;
  /** Список моделей ещё предварительный — см. `useModels`. */
  modelsPending: boolean;
  modelsRefreshing: boolean;
  onRefreshModels: () => void;
  onSelectModel: (id: string) => void;
  /**
   * Зовётся, когда Radix собирается вернуть фокус после закрытия — ПОСЛЕ
   * exit-анимации. Возврат на триггер отменяется: открытое из дока меню
   * иначе оставляло бы каретку на кнопке дока, а не в поле промпта.
   */
  onRestoreFocus: () => void;
}

function ActiveMark({ active }: { active: boolean }) {
  return <Check className={cn("ml-auto", !active && "invisible")} />;
}

/**
 * Пока живой каталог не пришёл, показываем ЗАГЛУШКИ, а не вшитый список.
 * Разница принципиальная: вшитый список не знает моделей вендора с динамическим
 * каталогом, поэтому выбранная модель попадала в группу «Другие» и с приходом
 * настоящего списка прыгала на своё место — выглядело как сбой.
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
  activeSttModelId,
  sttCatalog,
  onSelectSttModel,
  providersMissingKey,
  onSwitchSttProvider,
  models,
  modelProvidersMissingKey,
  activeModelId,
  modelsPending,
  modelsRefreshing,
  onRefreshModels,
  onSelectModel,
}: ModelCommandMenuProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<"voice" | "answer" | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const showOpenrouterModels = page === "voice" || (page === null && searching);
  const openrouterLocked = providersMissingKey.includes(OPENROUTER_STT_PROVIDER);
  const selectedSttName =
    sttCatalog.models.find((model) => model.id === activeSttModelId)?.name ?? activeSttModelId;
  const navigate = (target: typeof page) => {
    setPage(target);
    setQuery("");
    searchRef.current?.focus();
  };
  const voiceHeading = t("hud.modelMenu.voice");
  const answerHeading = t("hud.modelMenu.answer");
  // Известные модели показываем сразу и обычными: они настоящие, из статических
  // реестров, и прятать их ради ещё не пришедшего динамического каталога значит
  // заблокировать заведомо рабочий выбор. Предварительность касается ТОЛЬКО
  // неизвестной части — она и уходит в отдельную группу ниже.
  const answerGroups = modelGroups(
    modelsPending ? models : selectableModels(models, activeModelId),
    activeModelId,
  );
  if (!answerGroups.some((group) => group.id === OPENROUTER_PROVIDER)) {
    answerGroups.push({ id: OPENROUTER_PROVIDER, label: "OpenRouter", models: [] });
  }
  const openrouterAnswers = models.filter((m) => m.provider === OPENROUTER_PROVIDER);
  const answersLocked = modelProvidersMissingKey.includes(OPENROUTER_PROVIDER);
  const answerPageEmpty = page === "answer" && openrouterAnswers.length === 0;
  const activeIsKnown = models.some((m) => m.id === activeModelId);
  const close = () => {
    onOpenChange(false);
  };
  return (
    <>
      {page !== null && (
        <div className="flex shrink-0 items-center gap-2 border-b px-2 py-1.5 text-caption text-muted-foreground">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              navigate(null);
            }}
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {t("sttModels.back")}
          </Button>
          <ChevronRight className="size-3" aria-hidden />
          <span className="min-w-0 truncate">
            {page === "voice" ? voiceHeading : answerHeading} · OpenRouter
          </span>
        </div>
      )}
      <CommandInput
        ref={searchRef}
        value={query}
        onValueChange={setQuery}
        placeholder={t(
          page === "voice"
            ? "sttModels.search"
            : page === "answer"
              ? "hud.modelMenu.answerSearch"
              : "hud.modelMenu.placeholder",
        )}
        aria-label={t(
          page === "voice"
            ? "sttModels.search"
            : page === "answer"
              ? "hud.modelMenu.answerSearch"
              : "hud.modelMenu.placeholder",
        )}
        onKeyDown={(event) => {
          if (event.key === "Backspace" && query === "" && page !== null) {
            event.preventDefault();
            navigate(null);
          }
        }}
      />
      {showOpenrouterModels && <SttCatalogStatus catalog={sttCatalog} />}
      {answerPageEmpty && (
        <div className="shrink-0 px-3 py-2 text-caption text-muted-foreground" role="status">
          {answersLocked
            ? missingKeyHint()
            : modelsRefreshing
              ? t("hud.modelMenu.pending")
              : t("hud.modelMenu.catalogUnavailable")}
          {!answersLocked && !modelsRefreshing && (
            <Button variant="ghost" size="sm" onClick={onRefreshModels}>
              {t("common.retry")}
            </Button>
          )}
        </div>
      )}
      <CommandList className="max-h-[min(24rem,65vh)]">
        {!answerPageEmpty && <CommandEmpty>{t("hud.modelMenu.empty")}</CommandEmpty>}
        {page === null && (
          <CommandGroup heading={voiceHeading}>
            {STT_PROVIDERS.map((p) => {
              const missingKey = providersMissingKey.includes(p.id);
              if (p.id === OPENROUTER_STT_PROVIDER)
                return (
                  <CommandItem
                    key={p.id}
                    value={`stt-provider:${p.id}`}
                    aria-label={`${voiceHeading} · ${p.label}`}
                    keywords={[p.label, voiceHeading, selectedSttName]}
                    onSelect={() => {
                      navigate("voice");
                    }}
                  >
                    {missingKey && <Lock aria-hidden />}
                    <span className="min-w-0 flex-1">
                      <span className="block">{p.label}</span>
                      <span
                        className="block truncate text-caption text-muted-foreground"
                        title={selectedSttName}
                      >
                        {p.id === sttProvider ? selectedSttName : t("sttModels.browse")}
                      </span>
                    </span>
                    <ActiveMark active={p.id === sttProvider} />
                    <ChevronRight aria-hidden />
                  </CommandItem>
                );
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
        )}
        {showOpenrouterModels && (
          <CommandGroup heading={`${voiceHeading} · OpenRouter`}>
            {sttModelOptions(sttCatalog, activeSttModelId).map((option) => (
              <CommandItem
                key={option.value}
                value={`stt-model:${option.value}`}
                keywords={[option.label, "OpenRouter", voiceHeading]}
                disabled={openrouterLocked || option.disabled}
                onSelect={() => {
                  onSelectSttModel(option.value);
                  close();
                }}
              >
                {openrouterLocked && <Lock aria-hidden />}
                <span className="min-w-0 flex-1">
                  <span className="block leading-snug break-words whitespace-normal">
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block text-caption text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {openrouterLocked && (
                  <span className="text-hint text-muted-foreground">{missingKeyHint()}</span>
                )}
                <ActiveMark
                  active={
                    sttProvider === OPENROUTER_STT_PROVIDER && option.value === activeSttModelId
                  }
                />
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {page !== "voice" &&
          answerGroups
            .filter((group) => page === null || group.id === OPENROUTER_PROVIDER)
            .map((group) => {
              const locked = modelProvidersMissingKey.includes(group.id);
              const collapsed = group.id === OPENROUTER_PROVIDER && page === null && !searching;
              const selectedAnswer = group.models.find((model) => model.id === activeModelId);
              return (
                <CommandGroup
                  key={group.id}
                  heading={answerGroupHeading(answerHeading, group, answerGroups.length)}
                >
                  {collapsed ? (
                    <CommandItem
                      value={`answer-provider:${group.id}`}
                      aria-label={`${answerHeading} · ${group.label}`}
                      keywords={[group.label, answerHeading]}
                      onSelect={() => {
                        navigate("answer");
                      }}
                    >
                      {locked && <Lock aria-hidden />}
                      <span className="min-w-0 flex-1">
                        <span className="block">{group.label}</span>
                        <span className="block truncate text-caption text-muted-foreground">
                          {selectedAnswer
                            ? modelLabel(selectedAnswer)
                            : t("hud.modelMenu.browseAnswers")}
                        </span>
                      </span>
                      <ActiveMark active={selectedAnswer !== undefined} />
                      <ChevronRight aria-hidden />
                    </CommandItem>
                  ) : (
                    group.models.map((m) => (
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
                        <span className="min-w-0 flex-1">
                          <span className="block leading-snug break-words whitespace-normal">
                            {modelLabel(m)}
                          </span>
                          {group.id === OPENROUTER_PROVIDER && (
                            <span className="block text-caption break-all text-muted-foreground">
                              {m.id.slice(OPENROUTER_PROVIDER.length + 1)}
                            </span>
                          )}
                        </span>
                        {locked && (
                          <span className="ml-auto text-hint text-muted-foreground">
                            {missingKeyHint()}
                          </span>
                        )}
                        <ActiveMark active={m.id === activeModelId} />
                      </CommandItem>
                    ))
                  )}
                </CommandGroup>
              );
            })}
        {page === null && modelsPending && (
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
      {/* Radix unmounts the contents on close, resetting search and navigation. */}
      <ModelMenuContent {...props} />
    </CommandDialog>
  );
}
