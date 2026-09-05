import type { DemoMessageSeed, FollowUps } from "@/i18n/demo-types";

export type AppTheme = "gray" | "black";

export type DemoMessage = DemoMessageSeed;

/** Параметры запроса чата — то, что в приложении лежит в `Chat` и правится через `patchChat`. */
export interface DemoChatParams {
  model: string;
  presetId: string;
  thinking: boolean;
  webSearch: boolean;
  context: string;
  libraryDocIds: string[];
}

export interface DemoChat extends DemoChatParams {
  id: string;
  title: string;
  messages: DemoMessage[];
  draft: string;
  /** Тема последнего ответа — по ней отвечают быстрые действия. */
  followUps: FollowUps | null;
}
