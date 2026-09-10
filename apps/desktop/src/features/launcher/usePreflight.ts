import { useCallback, useEffect, useRef, useState } from "react";
import { useLatestRef } from "@/hooks/useLatestRef";
import type { ErrorCode, PreflightProgress, PreflightReport } from "@/ipc/bindings";
import { cancelPreflight, runPreflight } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import type { Settings } from "@/ipc/types";

/** In-memory comparison only. Never serialized into a diagnostic report. */
function configuration(settings: Settings, model: string): string {
  return JSON.stringify([
    model,
    settings.capture_system_audio,
    settings.capture_microphone,
    settings.capture_device_uid,
    settings.microphone_device_uid,
    settings.stt_provider,
    settings.stt_language,
    settings.stt_translate,
    settings.openrouter_stt_model,
    settings.access_token,
    settings.anthropic_api_key,
    settings.openai_api_key,
    settings.xai_api_key,
    settings.groq_api_key,
    settings.deepgram_api_key,
    settings.openrouter_api_key,
    settings.xclis_api_key,
  ]);
}

export function usePreflight(
  settings: Settings,
  model: string,
  visible: boolean,
  prepare: () => Promise<boolean>,
) {
  const [report, setReport] = useState<PreflightReport | null>(null);
  const [progress, setProgress] = useState<PreflightProgress | null>(null);
  const [error, setError] = useState<ErrorCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [stale, setStale] = useState(false);
  const active = useRef<string | null>(null);
  const cancelRequested = useRef(false);
  const prepareRef = useLatestRef(prepare);
  const config = configuration(settings, model);
  const configRef = useLatestRef(config);
  const previousConfig = useRef(config);

  const abandon = useCallback(() => {
    const id = active.current;
    active.current = null;
    if (id !== null) void cancelPreflight(id).catch(() => undefined);
  }, []);

  const cancel = useCallback(async () => {
    const id = active.current;
    if (id === null) return;
    cancelRequested.current = true;
    setCancelling(true);
    try {
      await cancelPreflight(id);
    } catch {
      if (active.current === id) {
        setCancelling(false);
        setError("internal");
      }
    }
  }, []);

  useEffect(
    () =>
      onEvent("preflight-progress", (event) => {
        if (active.current === event.runId) setProgress(event);
      }),
    [],
  );

  useEffect(() => {
    if (config === previousConfig.current) return;
    previousConfig.current = config;
    if (active.current !== null) void cancel();
    setReport(null);
    setProgress(null);
    setError(null);
    setStale((wasStale) => wasStale || report !== null || active.current !== null);
  }, [config, cancel, report]);

  useEffect(() => {
    if (visible || active.current === null) return;
    void cancel();
  }, [visible, cancel]);
  useEffect(() => abandon, [abandon]);

  const run = async () => {
    if (active.current !== null) return;
    // Read through a function after each await: cancellation can change the ref
    // while TypeScript retains its earlier assignment-based narrowing.
    const isCancelled = (): boolean => cancelRequested.current;
    const id = crypto.randomUUID();
    const snapshot = config;
    active.current = id;
    cancelRequested.current = false;
    setBusy(true);
    setCancelling(false);
    setReport(null);
    setError(null);
    setStale(false);
    setProgress({ runId: id, phase: "preparing", remainingMs: 0, levels: [] });
    try {
      if (
        !(await prepareRef.current()) ||
        active.current !== id ||
        isCancelled() ||
        configRef.current !== snapshot
      )
        return;
      const result = await runPreflight(id, model);
      if (active.current === id && !isCancelled() && configRef.current === snapshot)
        setReport(result);
    } catch (failure) {
      if (active.current === id) {
        setError(
          typeof failure === "object" &&
            failure !== null &&
            "code" in failure &&
            failure.code === "cancelled"
            ? "cancelled"
            : "internal",
        );
      }
    } finally {
      if (active.current === id) {
        if (isCancelled()) setError("cancelled");
        active.current = null;
        setBusy(false);
        setCancelling(false);
        setProgress(null);
      }
    }
  };

  return { report, progress, error, busy, cancelling, stale, run, cancel };
}

export type PreflightApi = ReturnType<typeof usePreflight>;
