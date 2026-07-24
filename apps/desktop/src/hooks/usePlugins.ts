import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { PluginDescriptor } from "@/ipc/bindings";
import { listPlugins } from "@/ipc/commands";
import { onEvent } from "@/ipc/events";
import { queryKeys } from "@/lib/query-client";

export function usePlugins(
  onImage: (dataUrl: string, mediaType: string) => void,
): PluginDescriptor[] {
  const query = useQuery({
    queryKey: queryKeys.plugins,
    queryFn: listPlugins,
    staleTime: Infinity,
  });

  const onImageRef = useRef(onImage);
  useEffect(() => {
    onImageRef.current = onImage;
  }, [onImage]);

  useEffect(
    () =>
      onEvent("plugin-result", (p) => {
        if (p.kind === "image" && p.dataBase64 !== null && p.mediaType !== null) {
          onImageRef.current(`data:${p.mediaType};base64,${p.dataBase64}`, p.mediaType);
        }
      }),
    [],
  );

  const qc = useQueryClient();
  useEffect(
    () =>
      onEvent("plugins-changed", () => {
        void qc.invalidateQueries({ queryKey: queryKeys.plugins });
      }),
    [qc],
  );

  return query.data ?? [];
}
