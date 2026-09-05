import { useCallback, useEffect, useRef, useState } from "react";
import { probeConnectivity } from "@/ipc/commands";

const PROBE_INTERVAL_MS = 4000;

export interface Connectivity {
  offline: boolean;
  reportNetworkError: () => void;
  retry: () => void;
}

/**
 * Немедленную пробу при переходе в offline запускает ОДИН источник — эффект
 * на `offline`. `reportNetworkError` и событие `offline` только поднимают флаг:
 * каждая проба собирает в Rust отдельный HTTP-клиент с 5-секундным таймаутом,
 * и вторая на тот же переход была бы чистой платой.
 */
export function useConnectivity(): Connectivity {
  const [offline, setOffline] = useState(() => !navigator.onLine);
  const probeGen = useRef(0);

  const check = useCallback(async () => {
    const gen = ++probeGen.current;
    try {
      const reachable = await probeConnectivity();
      if (gen !== probeGen.current) return;
      setOffline(!reachable);
    } catch {
      if (gen !== probeGen.current) return;
      setOffline(true);
    }
  }, []);

  const retry = useCallback(() => {
    void check();
  }, [check]);

  const reportNetworkError = useCallback(() => {
    setOffline(true);
  }, []);

  useEffect(() => {
    // На старте в offline пробу делает эффект ниже — иначе их было бы две.
    if (navigator.onLine) void check();
    const onOnline = () => void check();
    const onOffline = () => {
      setOffline(true);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [check]);

  useEffect(() => {
    if (!offline) return;
    void check();
    const timer = setInterval(() => void check(), PROBE_INTERVAL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [offline, check]);

  return { offline, reportNetworkError, retry };
}
