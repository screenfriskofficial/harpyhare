import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { loadChats, saveChats } from "@/ipc/commands";
import {
  CHAT_LIMIT,
  chatTitle,
  createChat,
  deserializeChats,
  serializeChats,
  type Chat,
  type ChatPatch,
} from "@/lib/chats";
import {
  acceptedNewAttachments,
  ATTACHMENT_LIMIT,
  downscaleFactor,
  extractImageItems,
  NO_DOWNSCALE,
  toImagePayload,
  type Attachment,
  type ImagePayload,
} from "@/lib/composer";
import { DEFAULT_MODEL } from "@/lib/models";

const SAVE_DEBOUNCE_MS = 500;
const DOWNSCALE_JPEG_QUALITY = 0.85;
const DOWNSCALE_MEDIA_TYPE = "image/jpeg";
const MIN_CANVAS_SIDE_PX = 1;
const FILE_READ_ERROR = "Ошибка чтения файла";
const NO_CANVAS_CONTEXT_ERROR = "2D-контекст канваса недоступен";

const EMPTY_CHAT: Chat = {
  id: "",
  title: "",
  messages: [],
  draft: "",
  draftAttachments: [],
  titlePinned: false,
  presetId: "",
  thinkingEnabled: false,
  model: DEFAULT_MODEL,
  webSearch: false,
  context: "",
  libraryDocIds: [],
  lastInputTokens: 0,
};

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      resolve(fr.result as string);
    };
    fr.onerror = () => {
      reject(new Error(fr.error?.message ?? FILE_READ_ERROR));
    };
    fr.readAsDataURL(file);
  });
}

function scaledSidePx(sidePx: number, factor: number): number {
  return Math.max(MIN_CANVAS_SIDE_PX, Math.round(sidePx * factor));
}

async function downscaleToJpegDataUrl(file: File, factor: number): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = scaledSidePx(bitmap.width, factor);
  canvas.height = scaledSidePx(bitmap.height, factor);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(NO_CANVAS_CONTEXT_ERROR);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(DOWNSCALE_MEDIA_TYPE, DOWNSCALE_JPEG_QUALITY);
}

async function fileToAttachment(file: File): Promise<Attachment> {
  const factor = downscaleFactor(file.size);
  if (factor === NO_DOWNSCALE) {
    const dataUrl = await readAsDataUrl(file);
    return { payload: toImagePayload(dataUrl, file.type), preview: dataUrl };
  }
  const dataUrl = await downscaleToJpegDataUrl(file, factor);
  return { payload: toImagePayload(dataUrl, DOWNSCALE_MEDIA_TYPE), preview: dataUrl };
}

async function fileToAttachmentOrNull(file: File): Promise<Attachment | null> {
  try {
    return await fileToAttachment(file);
  } catch {
    return null;
  }
}

const DATA_URL_BASE64_MARKER = ";base64,";
const SCREENSHOT_FILE_NAME = "screenshot";

function dataUrlToFile(dataUrl: string, mediaType: string): File {
  const markerIdx = dataUrl.indexOf(DATA_URL_BASE64_MARKER);
  const base64 =
    markerIdx >= 0 ? dataUrl.slice(markerIdx + DATA_URL_BASE64_MARKER.length) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], SCREENSHOT_FILE_NAME, { type: mediaType });
}

function useInitialChatsLoad(
  setChats: Dispatch<SetStateAction<Chat[]>>,
  setActiveId: Dispatch<SetStateAction<string>>,
  loaded: RefObject<boolean>,
): void {
  useEffect(() => {
    let live = true;
    void loadChats().then((json) => {
      if (!live) return;
      const initial = deserializeChats(json) ?? [createChat(1)];
      const first = initial[0];
      if (!first) return;
      setChats(initial);
      setActiveId(first.id);
      loaded.current = true;
    });
    return () => {
      live = false;
    };
  }, [setChats, setActiveId, loaded]);
}

function useDebouncedChatsSave(chats: Chat[], loaded: RefObject<boolean>): void {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!loaded.current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveChats(serializeChats(chats));
    }, SAVE_DEBOUNCE_MS);
    return () => {
      clearTimeout(saveTimer.current);
    };
  }, [chats, loaded]);
}

export interface ChatsApi {
  chats: Chat[];
  activeId: string;
  active: Chat;
  newChat: () => void;
  removeChat: (id: string) => void;
  patchChat: (id: string, patch: ChatPatch) => void;
  selectChat: (id: string) => void;
  addDraftAttachments: (id: string, items: DataTransferItemList) => Promise<void>;
  addDraftImage: (id: string, dataUrl: string, mediaType: string) => Promise<void>;
  removeDraftAttachment: (id: string, index: number) => void;
  appendUserMessage: (id: string, text: string, images: ImagePayload[]) => void;
  appendAssistantMessage: (id: string, text: string) => void;
  removeMessage: (id: string, index: number) => void;
  truncateMessages: (id: string, count: number) => void;
  clearMessages: (id: string) => void;
}

export function useChats(): ChatsApi {
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const loaded = useRef(false);

  useInitialChatsLoad(setChats, setActiveId, loaded);
  useDebouncedChatsSave(chats, loaded);

  const effectiveActiveId = activeId || (chats[0]?.id ?? "");

  const patch = useCallback((id: string, fn: (c: Chat) => Chat) => {
    setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }, []);

  const newChat = useCallback(() => {
    if (chats.length >= CHAT_LIMIT) return;
    const id = crypto.randomUUID();
    setChats((prev) =>
      prev.length >= CHAT_LIMIT ? prev : [...prev, createChat(prev.length + 1, id)],
    );
    setActiveId(id);
  }, [chats.length]);

  const removeChat = useCallback((id: string) => {
    setChats((prev) => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex((c) => c.id === id);
      const next = prev.filter((c) => c.id !== id);
      setActiveId((cur) => {
        if (cur !== id) return cur;
        const neighbor = next[Math.min(idx, next.length - 1)];
        return neighbor ? neighbor.id : cur;
      });
      return next;
    });
  }, []);

  const patchChat = useCallback(
    (id: string, fields: ChatPatch) => {
      patch(id, (c) => ({ ...c, ...fields }));
    },
    [patch],
  );

  const selectChat = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  const draftAttachmentCount = useCallback((id: string): number => {
    let count = 0;
    setChats((prev) => {
      count = prev.find((c) => c.id === id)?.draftAttachments.length ?? 0;
      return prev;
    });
    return count;
  }, []);

  const appendDraftAttachment = useCallback(
    (id: string, att: Attachment) => {
      patch(id, (c) =>
        c.draftAttachments.length >= ATTACHMENT_LIMIT
          ? c
          : { ...c, draftAttachments: [...c.draftAttachments, att] },
      );
    },
    [patch],
  );

  const addDraftAttachments = useCallback(
    async (id: string, items: DataTransferItemList) => {
      const files = extractImageItems(items);
      if (files.length === 0) return;
      const slots = acceptedNewAttachments(draftAttachmentCount(id), files.length);
      for (const file of files.slice(0, slots)) {
        const att = await fileToAttachmentOrNull(file);
        if (att) appendDraftAttachment(id, att);
      }
    },
    [draftAttachmentCount, appendDraftAttachment],
  );

  const addDraftImage = useCallback(
    async (id: string, dataUrl: string, mediaType: string) => {
      if (acceptedNewAttachments(draftAttachmentCount(id), 1) < 1) return;
      const att = await fileToAttachmentOrNull(dataUrlToFile(dataUrl, mediaType));
      if (att) appendDraftAttachment(id, att);
    },
    [draftAttachmentCount, appendDraftAttachment],
  );

  const removeDraftAttachment = useCallback(
    (id: string, index: number) => {
      patch(id, (c) => ({
        ...c,
        draftAttachments: c.draftAttachments.filter((_, i) => i !== index),
      }));
    },
    [patch],
  );

  const appendUserMessage = useCallback((id: string, text: string, images: ImagePayload[]) => {
    setChats((prev) =>
      prev.map((c, i) => {
        if (c.id !== id) return c;
        const isFirst = c.messages.length === 0;
        return {
          ...c,
          title: isFirst && !c.titlePinned ? chatTitle(text, i + 1) : c.title,
          messages: [...c.messages, { role: "user", text, images }],
          draft: "",
          draftAttachments: [],
        };
      }),
    );
  }, []);

  const appendAssistantMessage = useCallback(
    (id: string, text: string) => {
      patch(id, (c) => ({
        ...c,
        messages: [...c.messages, { role: "assistant", text, images: [] }],
      }));
    },
    [patch],
  );

  const removeMessage = useCallback(
    (id: string, index: number) => {
      patch(id, (c) => ({ ...c, messages: c.messages.filter((_, i) => i !== index) }));
    },
    [patch],
  );

  const truncateMessages = useCallback(
    (id: string, count: number) => {
      patch(id, (c) => ({ ...c, messages: c.messages.slice(0, count) }));
    },
    [patch],
  );

  const clearMessages = useCallback(
    (id: string) => {
      patch(id, (c) => ({ ...c, messages: [], lastInputTokens: 0 }));
    },
    [patch],
  );

  const active = chats.find((c) => c.id === effectiveActiveId) ?? chats[0] ?? EMPTY_CHAT;

  return {
    chats,
    activeId: effectiveActiveId,
    active,
    newChat,
    removeChat,
    patchChat,
    selectChat,
    addDraftAttachments,
    addDraftImage,
    removeDraftAttachment,
    appendUserMessage,
    appendAssistantMessage,
    removeMessage,
    truncateMessages,
    clearMessages,
  };
}
