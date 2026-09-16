import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { AnswerPanel, type ChatScrollMemory } from "@/components/AnswerPanel";
import { AppHeader } from "@/components/AppHeader";
import { Composer } from "@/components/Composer";
import { ConnectivityOverlay } from "@/components/ConnectivityOverlay";
import { MiniHud } from "@/components/MiniHud";
import { ModelCommandMenu } from "@/components/ModelCommandMenu";
import { PreviewPanel } from "@/components/PreviewPanel";
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
import { useHudModes } from "@/hooks/useHudModes";
import { useHudSettingsActions } from "@/hooks/useHudSettingsActions";
import { useLatestRef } from "@/hooks/useLatestRef";
import { useLeaveToLauncher } from "@/hooks/useLeaveToLauncher";
import { useLockedModelFallback } from "@/hooks/useLockedModelFallback";
import { useMessageClipboard } from "@/hooks/useMessageClipboard";
import { useModels } from "@/hooks/useModels";
import { useNetworkErrorReport } from "@/hooks/useNetworkErrorReport";
import { useNotesIndex } from "@/hooks/useNotesIndex";
import { useOfficialPresets } from "@/hooks/useOfficialPresets";
import { usePipelineKeyterms } from "@/hooks/usePipelineKeyterms";
import { usePipelines } from "@/hooks/usePipelines";
import { usePipelineStreams } from "@/hooks/usePipelineStreams";
import { usePreviewPanel } from "@/hooks/usePreviewPanel";
import { usePromptFocus } from "@/hooks/usePromptFocus";
import { usePttSuspend } from "@/hooks/usePttSuspend";
import { useQuickActionKeys } from "@/hooks/useQuickActionKeys";
import { useRecorder } from "@/hooks/useRecorder";
import { useRegionScreenshot } from "@/hooks/useRegionScreenshot";
import { useSendPipeline } from "@/hooks/useSendPipeline";
import { useSettings } from "@/hooks/useSettings";
import { useSttFeedback } from "@/hooks/useSttFeedback";
import { useSttModels } from "@/hooks/useSttModels";
import { useTeleprompterSession } from "@/hooks/useTeleprompterSession";
import { useTranscriptDelivery } from "@/hooks/useTranscriptDelivery";
import { useUnreadChats } from "@/hooks/useUnreadChats";
import { useUpdateDialog } from "@/hooks/useUpdateDialog";
import { useUpdater } from "@/hooks/useUpdater";
import { useWindowControls } from "@/hooks/useWindowControls";
import { useWindowFrame } from "@/hooks/useWindowFrame";
import { startWindowDrag } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { QuickAction } from "@/ipc/types";
import { modelProvidersMissingKey } from "@/lib/api-keys";
import { lastMessageOf, lastUserMessageIndex } from "@/lib/chat-messages";
import { isRetryable, type AppError } from "@/lib/errors";
import { effectiveCombo } from "@/lib/hotkeys";
import { extractPreviewBlocks, type PreviewContent } from "@/lib/html-blocks";
import { isActivityStatus } from "@/lib/mini-status";
import { defaultModelFor } from "@/lib/models";
import { keyboardLayerOpen } from "@/lib/portalled-layers";
import { mergePresets } from "@/lib/presets";
import { filledQuickActions } from "@/lib/quick-actions";
import {
  CHAT_COLUMN_GAP_PX,
  chatColumnWidthPx,
  clampPreviewWidth,
  SHELL_COLUMN_GAP_PX,
  SHELL_PADDING_PX,
} from "@/lib/shell-layout";

function lastPreviewBlock(markdown: string): PreviewContent | undefined {
  return extractPreviewBlocks(markdown).at(-1);
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
    setPreviewWidth,
    flush: flushSettings,
  } = useSettings();
  const recorderState = useRecorder();
  const reportError = useErrorToasts();
  // Read at chat-creation time, not at render time: a key added mid-session
  // changes what the next chat opens on without a reload.
  const settingsRef = useLatestRef(settings);
  const {
    models,
    pending: modelsPending,
    refreshing: modelsRefreshing,
    refresh: refreshModels,
  } = useModels();
  const modelsRef = useLatestRef(models);
  const newChatModel = useCallback(
    () => defaultModelFor(modelProvidersMissingKey(settingsRef.current), modelsRef.current),
    [settingsRef, modelsRef],
  );
  const chats = useChats(newChatModel);
  const chatsRef = useLatestRef(chats);
  const updater = useUpdater();

  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const sttCatalog = useSttModels(modelMenuOpen);
  const {
    miniMode,
    mode,
    notesMode,
    miniModeRef,
    notesModeRef,
    setMode,
    revealChat,
    toggleMode,
    collapse,
    expand,
  } = useHudModes();

  const { sttError, showRetry, clearSttFeedback, retry } = useSttFeedback(recorderState);
  const { previewContent, previewOpen, openPreview, togglePreview, closePreview, viewportMemory } =
    usePreviewPanel();
  // Survives the chat panel's unmount in mini mode and notes — see `AnswerPanel`.
  const chatScrollMemory = useRef<ChatScrollMemory | null>(null);
  // How far the open composer reaches above its slot; the gap between the two goes first.
  const [composerOverflow, setComposerOverflow] = useState(0);
  const ledgerInset = Math.max(0, composerOverflow - CHAT_COLUMN_GAP_PX);
  useWindowFrame({
    windowWidth: settings.window_width,
    windowHeight: settings.window_height,
    previewOpen,
    miniMode,
    ready: !settingsLoading,
    applyNativeWindowSize,
  });
  // The stored width is clamped against the current window here, not re-saved:
  // a narrower window only squeezes the panel until the window grows again.
  const previewWidth = previewOpen
    ? clampPreviewWidth(settings.preview_width, settings.window_width)
    : null;

  const officialPresets = useOfficialPresets();
  const presets = useMemo(
    () => mergePresets(officialPresets, settings.prompt_presets),
    [officialPresets, settings.prompt_presets],
  );
  const presetsRef = useLatestRef(presets);

  const contextLibrary = useContextLibrary();
  const pipelines = usePipelines();
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
      const block = lastPreviewBlock(text);
      if (block !== undefined) openPreview(block);
    },
    [chatsRef, settingsRef, miniModeRef, notesModeRef, markUnread, openPreview],
  );

  const legacyStream = useClaudeStream(onAssistantDone);
  const {
    stream,
    running: pipelineRunning,
    cancelAll: cancelPipelines,
  } = usePipelineStreams(
    legacyStream,
    pipelines,
    chatsRef,
    libraryRef,
    presetsRef,
    onAssistantDone,
    reportError,
  );
  const streamRef = useLatestRef(stream);

  const { dispatchSendTo, dispatchQuickAction, doSend, resendFromMessage } = useSendPipeline(
    chatsRef,
    streamRef,
    presetsRef,
    clearAllErrors,
  );

  useTranscriptDelivery({
    chatsRef,
    settingsRef,
    recorderState,
    dispatchSendTo,
    clearSttFeedback,
    revealChat,
  });

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
  useComboKey(effectiveCombo(settings.hotkeys, "toggle_mode"), modeSwitchAvailable, toggleMode);

  const notesIndex = useNotesIndex(contextLibrary.library.docs, notesMode);

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

  const anyStreaming = Object.values(stream.streaming).some(Boolean);
  const activityFrame = isActivityStatus(recorderState, anyStreaming);
  const activeError: AppError | null =
    sttError ?? screenshot.error ?? stream.error[activeId] ?? null;
  useNetworkErrorReport(activeError, connectivity.reportNetworkError);
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

  usePipelineKeyterms(contextLibrary.library, presets, pipelines.library.pipelines, active);
  const { copyMessage, copyLastAnswer } = useMessageClipboard(chatsRef);
  const { lockedAnswerProviders, lockedSttProviders } = useLockedModelFallback({
    settings,
    settingsLoading,
    models,
    chatId: active.id,
    chatModel: active.model,
    patchChat: chats.patchChat,
  });
  const update = useUpdateDialog(updater, skipVersion);

  const onShellDragStart = useCallback((event: MouseEvent<HTMLElement>) => {
    if (event.button === 0 && event.target === event.currentTarget) void startWindowDrag();
  }, []);

  const leaveToLauncher = useLeaveToLauncher({
    flushChats: chats.flush,
    flushLibrary: contextLibrary.flush,
    flushSettings,
    flushPipelines: pipelines.flush,
    cancelPipelines,
  });

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
        style={{ width: chatColumnWidthPx(settings.window_width, previewWidth) }}
      >
        <AppHeader
          recorderState={recorderState}
          hotkeys={settings.hotkeys}
          update={update.badge}
          chats={chats.chats}
          activeId={activeId}
          streaming={stream.streaming}
          unread={unread}
          mode={mode}
          canCopy={canCopy}
          canTeleprompt={teleprompter.canTeleprompt}
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
          onOpenUpdate={update.openUpdate}
        />

        {notesMode ? (
          <NotesPanel
            library={contextLibrary.library}
            index={notesIndex}
            addDoc={contextLibrary.addDoc}
            onLeave={revealChat}
          />
        ) : (
          <div
            className="relative flex min-h-0 flex-1 flex-col"
            style={{ gap: CHAT_COLUMN_GAP_PX }}
          >
            <AnswerPanel
              messages={active.messages}
              chatId={activeId}
              scrollMemory={chatScrollMemory}
              bottomInset={ledgerInset}
              partial={partial}
              streaming={activeStreaming}
              streamStartedAt={stream.startedAt[activeId]}
              streamLabel={
                pipelineRunning[activeId] === undefined
                  ? undefined
                  : tr("hud.pipelines.running", { name: pipelineRunning[activeId] })
              }
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
              onOverflowChange={setComposerOverflow}
              streaming={activeStreaming}
              showRetry={answerRetry !== null || showRetry}
              retryLabel={
                answerRetry !== null
                  ? tr("hud.composer.retryAnswer")
                  : tr("hud.composer.retryTranscription")
              }
              presets={presets}
              pipelines={pipelines.library.pipelines}
              pipelinesReady={pipelines.loaded}
              models={models}
              modelProvidersMissingKey={lockedAnswerProviders}
              onCaptureRegion={screenshot.capture}
              promptRef={promptRef}
              quickActions={quickActions}
              quickActionCombo={quickActionCombo}
              onQuickAction={runQuickAction}
            />
          </div>
        )}
      </div>

      {previewWidth !== null && previewContent && (
        <PreviewPanel
          content={previewContent}
          width={previewWidth}
          windowWidth={settings.window_width}
          resizeStep={settings.resize_step}
          onResize={setPreviewWidth}
          onClose={closePreview}
          viewportMemory={viewportMemory}
        />
      )}

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
        modelsRefreshing={modelsRefreshing}
        onRefreshModels={refreshModels}
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
          open={update.open}
          info={updater.info}
          status={updater.status}
          progress={updater.progress}
          error={updater.error}
          currentVersion={updater.currentVersion}
          onClose={update.closeUpdate}
          onInstall={updater.install}
          onSkip={update.skipUpdate}
        />
      )}
    </div>
  );
}
