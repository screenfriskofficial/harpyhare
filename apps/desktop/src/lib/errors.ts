import type { ErrorCode } from "@/ipc/bindings";
export type { ErrorCode };

export interface AppError {
  code: ErrorCode;
  message: string;
}

const RETRYABLE_CODES: readonly ErrorCode[] = [
  "network",
  "retryable",
  "rateLimited",
  "serviceUnavailable",
  "timeout",
];

export function internalError(message: string): AppError {
  return { code: "internal", message };
}

export function isRetryable(error: AppError | null): boolean {
  return error !== null && RETRYABLE_CODES.includes(error.code);
}

export function isNetworkError(error: AppError | null): boolean {
  return error?.code === "network";
}
