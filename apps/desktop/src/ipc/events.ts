import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { EventMap } from "./types";

export type Unlisten = () => void;

const noopUnlisten: Unlisten = () => undefined;

export interface LogicalWindowSize {
  width: number;
  height: number;
}

export type FileDropEvent =
  | { type: "over"; x: number; y: number }
  | { type: "drop"; paths: string[]; x: number; y: number }
  | { type: "leave" };

export function onFileDrop(handler: (event: FileDropEvent) => void): Unlisten {
  let live = true;
  let off: Unlisten = noopUnlisten;
  const scale = window.devicePixelRatio || 1;
  void getCurrentWebview()
    .onDragDropEvent((event) => {
      if (!live) return;
      const payload = event.payload;
      if (payload.type === "over") {
        handler({ type: "over", x: payload.position.x / scale, y: payload.position.y / scale });
      } else if (payload.type === "drop") {
        handler({
          type: "drop",
          paths: payload.paths,
          x: payload.position.x / scale,
          y: payload.position.y / scale,
        });
      } else {
        handler({ type: "leave" });
      }
    })
    .then((unlisten) => {
      if (live) off = unlisten;
      else unlisten();
    });
  return () => {
    live = false;
    off();
  };
}

/**
 * Масштаб берётся синхронно из `devicePixelRatio` (в вебвью он равен scale
 * factor окна), а не через IPC `scaleFactor()`: на Windows `WM_SIZE` приходит
 * на каждый пиксель протяжки, и invoke на каждое событие шёл бы до
 * rAF-коалесинга; к тому же N параллельных ответов не обязаны приходить по
 * порядку, и последний размер мог оказаться не последним.
 */
export function onWindowResized(handler: (size: LogicalWindowSize) => void): Unlisten {
  let live = true;
  let off: Unlisten = noopUnlisten;
  void getCurrentWindow()
    .onResized(({ payload }) => {
      if (!live) return;
      const scale = window.devicePixelRatio || 1;
      handler({ width: payload.width / scale, height: payload.height / scale });
    })
    .then((unlisten) => {
      if (live) off = unlisten;
      else unlisten();
    });
  return () => {
    live = false;
    off();
  };
}

export function onEvent<K extends keyof EventMap>(
  name: K,
  handler: (payload: EventMap[K]) => void,
): Unlisten {
  let live = true;
  let off: Unlisten = noopUnlisten;
  void listen<EventMap[K]>(name, (e) => {
    if (!live) return;
    handler(e.payload);
  }).then((unlisten) => {
    if (live) off = unlisten;
    else unlisten();
  });
  return () => {
    live = false;
    off();
  };
}
