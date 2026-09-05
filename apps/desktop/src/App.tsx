import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { AnswerPanel } from "@/components/AnswerPanel";
import { AppHeader, type UpdateBadge } from "@/components/AppHeader";
import { Composer } from "@/components/Composer";
import { ConnectivityOverlay } from "@/components/ConnectivityOverlay";
import { MiniHud } from "@/components/MiniHud";
import { ModelCommandMenu } from "@/components/ModelCommandMenu";
import { PreviewPanel } from "@/components/PreviewPanel";
import type { ContextUsage } from "@/components/StatusBar";
import { Teleprompter } from "@/components/Teleprompter";
import { LiquidMetalBorder } from "@/components/ui/liquid-metal-border";
import { UpdateDialog } from "@/components/UpdateDialog";
import { NotesPanel } from "@/features/notes/NotesPanel";
import { useChatActions } from "@/hooks/useChatActions";
import { useChats } from "@/hooks/useChats";
import { useClaudeStream } from "@/hooks/useClaudeStream";
import { useComboKey } from "@/hooks/useComboKey";
import { useConnectivity } from "@/hooks/useConnectivity";
import { useContextLibrary } from "@/hooks/useContextLibrary";
import { useErrorToasts } from "@/hooks/useErrorToasts";
import { useHudSettingsActions } from "@/hooks/useHudSettingsActions";
import { useLatestRef } from "@/hooks/useLatestRef";
import { useModels } from "@/hooks/useModels";
import { useNotesIndex } from "@/hooks/useNotesIndex";
import { useOfficialPresets } from "@/hooks/useOfficialPresets";
import { usePreviewPanel } from "@/hooks/usePreviewPanel";
import { useProjectedContextTokens } from "@/hooks/useProjectedContextTokens";
import { usePromptFocus } from "@/hooks/usePromptFocus";
import { usePttSuspend } from "@/hooks/usePttSuspend";
import { useQuickActionKeys } from "@/hooks/useQuickActionKeys";
import { useRecorder } from "@/hooks/useRecorder";
import { useRegionScreenshot } from "@/hooks/useRegionScreenshot";
import { useSendPipeline } from "@/hooks/useSendPipeline";
import { useSettings } from "@/hooks/useSettings";
import { useSttFeedback } from "@/hooks/useSttFeedback";
import { useSttKeyterms } from "@/hooks/useSttKeyterms";
import { useSttModels } from "@/hooks/useSttModels";
import { useTeleprompterSession } from "@/hooks/useTeleprompterSession";
import { useTranscription } from "@/hooks/useTranscription";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useUpdater, type UpdaterStatus } from "@/hooks/useUpdater";
import { useWindowControls } from "@/hooks/useWindowControls";
import { useWindowFrame } from "@/hooks/useWindowFrame";
import { t } from "@/i18n";
import { copyImageToClipboard, startWindowDrag, stopMainWindow } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { QuickAction, UpdateInfo } from "@/ipc/types";
import { modelProvidersMissingKey, sttProvidersMissingKey } from "@/lib/api-keys";
import { lastMessageOf, lastUserMessageIndex } from "@/lib/chat-messages";
import type { ChatMessage } from "@/lib/chats";
import { copyTextReportingError } from "@/lib/clipboard-text";
import { appendTranscript } from "@/lib/composer";
import { isNetworkError, isRetryable, type AppError } from "@/lib/errors";
import { effectiveCombo } from "@/lib/hotkeys";
import { extractHtmlBlocks } from "@/lib/html-blocks";
import { chatKeyterms } from "@/lib/keywords";
import { imagePngBase64, messageCopyImage, messageCopyText } from "@/lib/message-clipboard";
import { isActivityStatus } from "@/lib/mini-status";
import { defaultModelFor } from "@/lib/models";
import { DEFAULT_MODE, nextMode, NOTES_MODE, type AppModeId } from "@/lib/modes";
import { notify } from "@/lib/notify";
import { keyboardLayerOpen } from "@/lib/portalled-layers";
import { mergePresets } from "@/lib/presets";
import { filledQuickActions } from "@/lib/quick-actions";
import { chatColumnWidthPx, SHELL_COLUMN_GAP_PX, SHELL_PADDING_PX } from "@/lib/shell-layout";
import { chatPromptSources, chatSystemPrompt } from "@/lib/system-prompt";

function lastHtmlBlock(markdown: string): string | undefined {
  const blocks = extractHtmlBlocks(markdown);
  return blocks[blocks.length - 1];
}

function updateBadge(status: UpdaterStatus, info: UpdateInfo | null): UpdateBadge | null {
  if (status === "idle" || !info) return null;
  return { version: info.version, busy: status === "downloading" || status === "restarting" };
}

/** Текст, а если его нет — картинка: у скриншота без подписи копировать иначе нечего. */
function copyMessageToClipboard(message: ChatMessage): void {
  const text = messageCopyText(message);
  if (text !== "") {
    void copyTextReportingError(text);
    return;
  }
  const image = messageCopyImage(message);
  if (!image) return;
  void imagePngBase64(image)
    .then(copyImageToClipboard)
    .catch(() => {
      notify({
        variant: "error",
        title: t("common.error"),
        message: t("errors.copyImageFailed"),
      });
    });
}

export default function App() {
  const { t: tr } = useTranslation();
  const {
    settings,
    loading: settingsLoading,
    save,
    bumpOpacity,
    bumpChatFontSize,
    bumpWindowSize,
    applyNativeWindowSize,
    flush: flushSettings,
  } = useSettings();
  const recorderState = useRecorder();
  useErrorToasts();
  // Read at chat-creation time, not at render time: a key added mid-session
  // changes what the next chat opens on without a reload.
  const settingsRef = useLatestRef(settings);
  const newChatModel = useCallback(
    () => defaultModelFor(modelProvidersMissingKey(settingsRef.current)),
    [settingsRef],
  );
  const chats = useChats(newChatModel);
  const chatsRef = useLatestRef(chats);
  const { models, pending: modelsPending } = useModels();
  const updater = useUpdater();

  const [updateOpen, setUpdateOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const sttCatalog = useSttModels(modelMenuOpen);
  const [miniMode, setMiniMode] = useState(false);
  const [mode, setMode] = useState<AppModeId>(DEFAULT_MODE);
  const notesMode = mode === NOTES_MODE;
  const miniModeRef = useLatestRef(miniMode);
  const notesModeRef = useLatestRef(notesMode);

  const revealChat = useCallback(() => {
    setMiniMode(false);
    setMode(DEFAULT_MODE);
  }, []);

  const { sttError, showRetry, clearSttFeedback, retry } = useSttFeedback(recorderState);
  const { previewHtml, previewOpen, openPreview, togglePreview, closePreview } = usePreviewPanel();
  useWindowFrame({
    windowWidth: settings.window_width,
    windowHeight: settings.window_height,
    previewOpen,
    miniMode,
    ready: !settingsLoading,
    applyNativeWindowSize,
  });

  const officialPresets = useOfficialPresets();
  const presets = useMemo(
    () => mergePresets(officialPresets, settings.prompt_presets),
    [officialPresets, settings.prompt_presets],
  );
  const presetsRef = useLatestRef(presets);

  const contextLibrary = useContextLibrary();
  const libraryRef = useLatestRef(contextLibrary.library);

  const onScreenshotImage = useCallback(
    (dataUrl: string, mediaType: string) => {
      revealChat();
      void chatsRef.current.addDraftImage(chatsRef.current.activeId, dataUrl, mediaType);
    },
    [chatsRef, revealChat],
  );
  const screenshot = useRegionScreenshot(onScreenshotImage);
  const clearScreenshotError = screenshot.clearError;
  const clearAllErrors = useCallback(() => {
    clearSttFeedback();
    clearScreenshotError();
  }, [clearSttFeedback, clearScreenshotError]);

  const { unread, unreadAnswer, markUnread } = useUnreadChats(
    chats.chats,
    chats.activeId,
    miniMode || notesMode,
  );

  const onAssistantDone = useCallback(
    (chatId: string, text: string) => {
      if (text === "") return;
      chatsRef.current.appendAssistantMessage(chatId, text);
      const unseen =
        chatId !== chatsRef.current.activeId || miniModeRef.current || notesModeRef.current;
      if (unseen) markUnread(chatId);
      if (!settingsRef.current.auto_preview_html) return;
      if (chatId !== chatsRef.current.activeId) return;
      const block = lastHtmlBlock(text);
      if (block !== undefined) openPreview(block);
    },
    [chatsRef, settingsRef, miniModeRef, notesModeRef, markUnread, openPreview],
  );

  const onAssistantUsage = useCallback(
    (chatId: string, inputTokens: number) => {
      chatsRef.current.patchChat(chatId, { lastInputTokens: inputTokens });
    },
    [chatsRef],
  );

  const stream = useClaudeStream(onAssistantDone, onAssistantUsage);
  const streamRef = useLatestRef(stream);

  const { dispatchSend, dispatchQuickAction, doSend, resendFromMessage } = useSendPipeline(
    chatsRef,
    streamRef,
    presetsRef,
    libraryRef,
    clearAllErrors,
  );

  useTranscription(
    useCallback(
      (incoming: string) => {
        revealChat();
        const chat = chatsRef.current.active;
        const merged = appendTranscript(chat.draft, incoming);
        chatsRef.current.patchChat(chat.id, { draft: merged });
        clearSttFeedback();
        if (settingsRef.current.auto_send) dispatchSend(merged);
      },
      [chatsRef, settingsRef, dispatchSend, clearSttFeedback, revealChat],
    ),
  );

  const active = chats.active;
  const activeId = chats.activeId;
  const activeStreaming = !!stream.streaming[activeId];
  const partial = activeStreaming ? (stream.partial[activeId] ?? "") : null;

  const connectivity = useConnectivity();
  const {
    toggleScreenShareVisible,
    switchSttProvider,
    selectOpenrouterSttModel,
    skipVersion,
    persistTeleprompter,
  } = useHudSettingsActions(settingsRef, save, settingsLoading);
  // Суфлёр не открывается, пока поле промпта недоступно: под оверлеем сети он
  // жил бы невидимым и ловил Space/Esc, а в заметках — вставал бы поверх них.
  const teleprompterBlocked = connectivity.offline || miniMode || notesMode;
  const teleprompterBlockedRef = useLatestRef(teleprompterBlocked);
  const teleprompter = useTeleprompterSession(
    active.messages,
    partial,
    settings.teleprompter_resume,
    teleprompterBlockedRef,
    persistTeleprompter,
  );

  const promptUnavailable = teleprompter.open || connectivity.offline || miniMode || notesMode;
  const promptUnavailableRef = useLatestRef(promptUnavailable);
  const hotkeySuppressed = useCallback(
    () => promptUnavailableRef.current || keyboardLayerOpen(),
    [promptUnavailableRef],
  );

  const sendFromHotkey = useCallback(() => {
    if (hotkeySuppressed()) return;
    doSend();
  }, [doSend, hotkeySuppressed]);

  useWindowControls(
    settings.hotkeys,
    sendFromHotkey,
    bumpOpacity,
    bumpChatFontSize,
    bumpWindowSize,
  );
  usePttSuspend(effectiveCombo(settings.hotkeys, "record"));
  const { ref: promptRef, focus: focusPrompt } = usePromptFocus(promptUnavailable);

  // Фокус — через гейтованный `focus` хука, не через сырой `ref.focus()`:
  // иначе каретка встала бы в невидимое поле под оверлеем.
  const focusFrameRef = useRef(0);
  const focusPromptSoon = useCallback(() => {
    cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(focusPrompt);
  }, [focusPrompt]);
  useEffect(
    () => () => {
      cancelAnimationFrame(focusFrameRef.current);
    },
    [],
  );

  const afterChatCreated = useCallback(() => {
    revealChat();
    focusPromptSoon();
  }, [revealChat, focusPromptSoon]);
  const {
    createChat,
    duplicateActiveChat,
    removeChatWithUndo,
    clearHistoryWithUndo,
    removeMessage,
  } = useChatActions(chatsRef, streamRef, afterChatCreated);
  useEffect(() => onEvent("duplicate-chat", duplicateActiveChat), [duplicateActiveChat]);

  const modeSwitchAvailable = !miniMode && !teleprompter.open && !connectivity.offline;
  const toggleMode = useCallback(() => {
    if (keyboardLayerOpen()) return;
    setMode(nextMode);
  }, []);
  useComboKey(effectiveCombo(settings.hotkeys, "toggle_mode"), modeSwitchAvailable, toggleMode);

  const notesIndex = useNotesIndex(contextLibrary.library.docs, notesMode);
  const toggleLibraryDoc = useCallback(
    (docId: string) => {
      const chat = chatsRef.current.active;
      const libraryDocIds = chat.libraryDocIds.includes(docId)
        ? chat.libraryDocIds.filter((id) => id !== docId)
        : [...chat.libraryDocIds, docId];
      chatsRef.current.patchChat(chat.id, { libraryDocIds });
    },
    [chatsRef],
  );

  const openModelMenu = useCallback(() => {
    setModelMenuOpen((o) => !o);
  }, []);
  useComboKey(effectiveCombo(settings.hotkeys, "model_menu"), !promptUnavailable, openModelMenu);

  const stopActiveStream = useCallback(() => {
    streamRef.current.stop(chatsRef.current.activeId);
  }, [streamRef, chatsRef]);
  useComboKey(
    effectiveCombo(settings.hotkeys, "cancel_stream"),
    activeStreaming && !teleprompter.open && !notesMode,
    stopActiveStream,
  );

  const quickActions = useMemo(
    () => (settingsLoading ? [] : filledQuickActions(settings.quick_actions)),
    [settingsLoading, settings.quick_actions],
  );
  const quickActionCombo = effectiveCombo(settings.hotkeys, "quick_action");
  const quickActionAttachments = settings.quick_action_attachments;
  const runQuickAction = useCallback(
    (action: QuickAction) => {
      dispatchQuickAction(action.prompt, quickActionAttachments);
    },
    [dispatchQuickAction, quickActionAttachments],
  );
  const runQuickActionAt = useCallback(
    (index: number) => {
      if (hotkeySuppressed()) return;
      const action = quickActions[index];
      if (action) runQuickAction(action);
    },
    [hotkeySuppressed, quickActions, runQuickAction],
  );
  useQuickActionKeys(quickActionCombo, quickActions.length, runQuickActionAt);

  useEffect(
    () =>
      onEvent("toggle-mini", () => {
        setMiniMode((mini) => !mini);
      }),
    [],
  );

  const anyStreaming = Object.values(stream.streaming).some(Boolean);
  const activityFrame = isActivityStatus(recorderState, anyStreaming);
  const activeError: AppError | null =
    sttError ?? screenshot.error ?? stream.error[activeId] ?? null;
  const reportNetworkError = connectivity.reportNetworkError;
  const reportedNetworkErrorRef = useRef<AppError | null>(null);
  useEffect(() => {
    if (!isNetworkError(activeError)) return;
    if (reportedNetworkErrorRef.current === activeError) return;
    reportedNetworkErrorRef.current = activeError;
    reportNetworkError();
  }, [activeError, reportNetworkError]);
  const streamError = stream.error[activeId] ?? null;
  const answerRetry = useMemo(() => {
    if (showRetry || streamError === null || !isRetryable(streamError)) return null;
    return () => {
      const index = lastUserMessageIndex(chatsRef.current.active.messages);
      if (index >= 0) resendFromMessage(index);
    };
  }, [showRetry, streamError, chatsRef, resendFromMessage]);
  const lastAnswer = useMemo(() => lastMessageOf(active.messages, "assistant"), [active.messages]);
  const canCopy = !activeStreaming && lastAnswer !== null;
  const activeModelMaxInput = models.find((m) => m.id === active.model)?.maxInputTokens ?? 0;
  const { presetId, libraryDocIds, context } = active;
  const promptSources = useMemo(
    () => chatPromptSources(presets, { presetId, libraryDocIds, context }, contextLibrary.library),
    [presets, presetId, libraryDocIds, context, contextLibrary.library],
  );
  const activeSystem = useMemo(() => chatSystemPrompt(promptSources), [promptSources]);
  useSttKeyterms(useMemo(() => chatKeyterms(promptSources), [promptSources]));
  const projectedTokens = useProjectedContextTokens(active, activeSystem, activeStreaming);
  const usedTokens = projectedTokens > 0 ? projectedTokens : active.lastInputTokens;
  const contextUsage = useMemo<ContextUsage | null>(
    () =>
      activeModelMaxInput > 0 && usedTokens > 0
        ? { usedTokens, maxTokens: activeModelMaxInput }
        : null,
    [activeModelMaxInput, usedTokens],
  );

  const copyMessage = useCallback(
    (index: number) => {
      const message = chatsRef.current.active.messages[index];
      if (message) copyMessageToClipboard(message);
    },
    [chatsRef],
  );
  const copyLastAnswer = useCallback(() => {
    const answer = lastMessageOf(chatsRef.current.active.messages, "assistant");
    if (answer) void copyTextReportingError(answer.text);
  }, [chatsRef]);

  const lockedSttProviders = useMemo(() => sttProvidersMissingKey(settings), [settings]);
  const lockedAnswerProviders = useMemo(() => modelProvidersMissingKey(settings), [settings]);

  // Ключ вендора могли убрать (или отвязать код доступа) уже после того, как чат
  // сел на его модель. Пикер такую модель рисует запертой, но ВЫБРАННОЙ она
  // оставалась, и отправка уходила в чужого провайдера с неизвестным ему id.
  useEffect(() => {
    if (settingsLoading) return;
    const owner = models.find((m) => m.id === active.model)?.provider;
    if (owner === undefined || !lockedAnswerProviders.includes(owner)) return;
    chatsRef.current.patchChat(active.id, {
      model: defaultModelFor(lockedAnswerProviders),
    });
  }, [settingsLoading, models, active.model, active.id, lockedAnswerProviders, chatsRef]);

  const updaterStatus = updater.status;
  const updaterInfo = updater.info;
  const update = useMemo(
    () => updateBadge(updaterStatus, updaterInfo),
    [updaterStatus, updaterInfo],
  );
  const skipUpdate = useCallback(() => {
    const skipped = updater.info?.version ?? "";
    setUpdateOpen(false);
    updater.dismiss();
    skipVersion(skipped);
  }, [updater, skipVersion]);
  const openUpdate = useCallback(() => {
    setUpdateOpen(true);
  }, []);
  const closeUpdate = useCallback(() => {
    setUpdateOpen(false);
  }, []);
  const collapse = useCallback(() => {
    setMiniMode(true);
  }, []);
  const expand = useCallback(() => {
    setMiniMode(false);
  }, []);

  const onShellDragStart = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button === 0 && event.target === event.currentTarget) void startWindowDrag();
  }, []);

  // `Promise.all`, не `allSettled`: после неудачного сохранения окно остаётся
  // открытым, иначе `stop_main_window` уничтожил бы вебвью вместе с данными.
  const flushChats = chats.flush;
  const flushLibrary = contextLibrary.flush;
  const leaveToLauncher = useCallback(() => {
    void Promise.all([flushChats(), flushLibrary(), flushSettings()])
      .then(stopMainWindow)
      .catch((err: unknown) => {
        notify({
          variant: "error",
          title: t("common.error"),
          message: t("errors.leaveSaveFailed", { error: String(err) }),
        });
      });
  }, [flushChats, flushLibrary, flushSettings]);

  const removeDraftAttachment = useCallback(
    (index: number) => {
      chatsRef.current.removeDraftAttachment(chatsRef.current.activeId, index);
    },
    [chatsRef],
  );
  const pasteIntoDraft = useCallback(
    (items: DataTransferItemList) => {
      void chatsRef.current.addDraftAttachments(chatsRef.current.activeId, items);
    },
    [chatsRef],
  );
  const selectModel = useCallback(
    (id: string) => {
      chatsRef.current.patchChat(chatsRef.current.activeId, { model: id });
    },
    [chatsRef],
  );

  if (miniMode) {
    return (
      <MiniHud
        state={recorderState}
        streaming={anyStreaming}
        hasError={activeError !== null}
        unreadAnswer={unreadAnswer}
        expandCombo={effectiveCombo(settings.hotkeys, "toggle_window")}
        onExpand={expand}
      />
    );
  }

  return (
    <div
      className="app-shell relative flex h-screen overflow-hidden rounded-[var(--window-radius)]"
      style={{ gap: SHELL_COLUMN_GAP_PX, padding: SHELL_PADDING_PX }}
      onMouseDown={onShellDragStart}
    >
      <LiquidMetalBorder active={activityFrame} />
      <div
        className="flex shrink-0 flex-col gap-2.5"
        style={{ width: chatColumnWidthPx(settings.window_width) }}
      >
        <AppHeader
          recorderState={recorderState}
          hotkeys={settings.hotkeys}
          update={update}
          chats={chats.chats}
          activeId={activeId}
          streaming={stream.streaming}
          unread={unread}
          mode={mode}
          canCopy={canCopy}
          canTeleprompt={teleprompter.canTeleprompt}
          contextUsage={contextUsage}
          screenShareVisible={settings.screen_share_visible}
          onSelectChat={chats.selectChat}
          onRemoveChat={removeChatWithUndo}
          onSelectMode={setMode}
          onNewChat={createChat}
          onDuplicateChat={duplicateActiveChat}
          onToggleScreenShare={toggleScreenShareVisible}
          onOpenModelMenu={openModelMenu}
          onCopy={copyLastAnswer}
          onOpenTeleprompter={teleprompter.show}
          onStop={leaveToLauncher}
          onCollapse={collapse}
          onOpenUpdate={openUpdate}
        />

        {notesMode ? (
          <NotesPanel
            library={contextLibrary.library}
            index={notesIndex}
            addDoc={contextLibrary.addDoc}
            selectedDocIds={active.libraryDocIds}
            onToggleDoc={toggleLibraryDoc}
            onLeave={revealChat}
          />
        ) : (
          <>
            <AnswerPanel
              messages={active.messages}
              chatId={activeId}
              partial={partial}
              streaming={activeStreaming}
              streamStartedAt={stream.startedAt[activeId]}
              scrollStep={settings.scroll_step}
              scrollModifier={effectiveCombo(settings.hotkeys, "scroll_chat")}
              recordCombo={effectiveCombo(settings.hotkeys, "record")}
              screenshotCombo={effectiveCombo(settings.hotkeys, "screenshot")}
              onTogglePreview={togglePreview}
              onCopyMessage={copyMessage}
              onRemoveMessage={removeMessage}
              onResendMessage={resendFromMessage}
            />

            <Composer
              chat={active}
              onPatch={chats.patchChat}
              onRemoveAttachment={removeDraftAttachment}
              onPaste={pasteIntoDraft}
              onSend={doSend}
              onStop={stopActiveStream}
              onClearHistory={clearHistoryWithUndo}
              onRetry={answerRetry ?? retry}
              onRestoreFocus={focusPromptSoon}
              streaming={activeStreaming}
              showRetry={answerRetry !== null || showRetry}
              retryLabel={
                answerRetry !== null
                  ? tr("hud.composer.retryAnswer")
                  : tr("hud.composer.retryTranscription")
              }
              presets={presets}
              library={contextLibrary.library}
              models={models}
              modelProvidersMissingKey={lockedAnswerProviders}
              onCaptureRegion={screenshot.capture}
              promptRef={promptRef}
              quickActions={quickActions}
              quickActionCombo={quickActionCombo}
              onQuickAction={runQuickAction}
            />
          </>
        )}
      </div>

      {previewOpen && <PreviewPanel html={previewHtml} onClose={closePreview} />}

      <ModelCommandMenu
        open={modelMenuOpen}
        onOpenChange={setModelMenuOpen}
        onRestoreFocus={focusPromptSoon}
        sttProvider={settings.stt_provider}
        activeSttModelId={settings.openrouter_stt_model}
        sttCatalog={sttCatalog}
        onSelectSttModel={selectOpenrouterSttModel}
        providersMissingKey={lockedSttProviders}
        onSwitchSttProvider={switchSttProvider}
        models={models}
        modelProvidersMissingKey={lockedAnswerProviders}
        activeModelId={active.model}
        modelsPending={modelsPending}
        onSelectModel={selectModel}
      />

      {teleprompter.open && (
        <Teleprompter
          text={teleprompter.text}
          initialSpeed={settings.teleprompter_speed}
          initialFontSize={settings.teleprompter_font_size}
          initialOffset={teleprompter.initialOffset}
          closeCombo={effectiveCombo(settings.hotkeys, "teleprompter_close")}
          pauseCombo={effectiveCombo(settings.hotkeys, "teleprompter_pause")}
          onPersist={teleprompter.persist}
          onClose={teleprompter.close}
        />
      )}

      {connectivity.offline && <ConnectivityOverlay onRetry={connectivity.retry} />}

      {updater.info && (
        <UpdateDialog
          open={updateOpen}
          info={updater.info}
          status={updater.status}
          progress={updater.progress}
          error={updater.error}
          currentVersion={updater.currentVersion}
          onClose={closeUpdate}
          onInstall={updater.install}
          onSkip={skipUpdate}
        />
      )}
    </div>
  );
}
