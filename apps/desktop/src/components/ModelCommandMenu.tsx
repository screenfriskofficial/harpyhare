import { Check, Lock } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { MISSING_KEY_HINT } from "@/lib/api-keys";
import {
  modelGroups,
  modelLabel,
  selectableModels,
  type ModelGroup,
  type ModelInfo,
} from "@/lib/models";
import { STT_PROVIDERS } from "@/lib/stt-providers";
import { cn } from "@/lib/utils";

const MENU_TITLE = "Модели";
const MENU_DESCRIPTION = "Выбор голосовой модели и модели ответа";
const INPUT_PLACEHOLDER = "Найти модель…";
const EMPTY_TEXT = "Ничего не найдено.";
const PENDING_GROUP_HEADING = "Загружаем каталог";
const VOICE_GROUP_HEADING = "Голосовая модель";
const ANSWER_GROUP_HEADING = "Модель ответа";
const PROVIDER_HEADING_SEPARATOR = " · ";

function answerGroupHeading(group: ModelGroup, groupCount: number): string {
  if (groupCount < 2) return ANSWER_GROUP_HEADING;
  return `${ANSWER_GROUP_HEADING}${PROVIDER_HEADING_SEPARATOR}${group.label}`;
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

export function ModelCommandMenu({
  open,
  onOpenChange,
  sttProvider,
  providersMissingKey,
  onSwitchSttProvider,
  models,
  modelProvidersMissingKey,
  activeModelId,
  modelsPending,
  onSelectModel,
  onRestoreFocus,
}: ModelCommandMenuProps) {
  // Известные модели показываем сразу и обычными: они настоящие, из статических
  // реестров, и прятать их ради ещё не пришедшего динамического каталога значит
  // заблокировать заведомо рабочий выбор. Предварительность касается ТОЛЬКО
  // неизвестной части — она и уходит в отдельную группу ниже.
  const answerGroups = modelGroups(
    modelsPending ? models : selectableModels(models, activeModelId),
  );
  const activeIsKnown = models.some((m) => m.id === activeModelId);
  const close = () => {
    onOpenChange(false);
  };
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={MENU_TITLE}
      description={MENU_DESCRIPTION}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        onRestoreFocus();
      }}
    >
      <CommandInput placeholder={INPUT_PLACEHOLDER} />
      <CommandList>
        <CommandEmpty>{EMPTY_TEXT}</CommandEmpty>
        <CommandGroup heading={VOICE_GROUP_HEADING}>
          {STT_PROVIDERS.map((p) => {
            const missingKey = providersMissingKey.includes(p.id);
            return (
              <CommandItem
                key={p.id}
                value={p.label}
                keywords={[VOICE_GROUP_HEADING]}
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
                    {MISSING_KEY_HINT}
                  </span>
                )}
                <ActiveMark active={p.id === sttProvider} />
              </CommandItem>
            );
          })}
        </CommandGroup>
        {answerGroups.map((group) => {
          const locked = modelProvidersMissingKey.includes(group.id);
          return (
            <CommandGroup key={group.id} heading={answerGroupHeading(group, answerGroups.length)}>
              {group.models.map((m) => (
                <CommandItem
                  key={m.id}
                  value={modelLabel(m)}
                  keywords={[ANSWER_GROUP_HEADING, group.label]}
                  disabled={locked}
                  onSelect={() => {
                    onSelectModel(m.id);
                    close();
                  }}
                >
                  {locked && <Lock aria-hidden />}
                  {modelLabel(m)}
                  {locked && (
                    <span className="ml-auto text-hint text-muted-foreground">
                      {MISSING_KEY_HINT}
                    </span>
                  )}
                  <ActiveMark active={m.id === activeModelId} />
                </CommandItem>
              ))}
            </CommandGroup>
          );
        })}
        {modelsPending && (
          <CommandGroup heading={PENDING_GROUP_HEADING}>
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
    </CommandDialog>
  );
}
