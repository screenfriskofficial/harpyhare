import type { ErrorCode } from "@/ipc/bindings";
import { isRecord } from "./utils";
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

/** A rejection from a Tauri command that returns `Result<_, AppError>` arrives as this shape. */
export function isAppError(value: unknown): value is AppError {
  return (
    isRecord(value) && typeof value["code"] === "string" && typeof value["message"] === "string"
  );
}

export function isRetryable(error: AppError | null): boolean {
  return error !== null && RETRYABLE_CODES.includes(error.code);
}

export function isNetworkError(error: AppError | null): boolean {
  return error?.code === "network";
}

/** The human-readable text of anything thrown or rejected: an `Error`, an `AppError`, a string, or whatever else. */
export function errorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value["message"] === "string") return value["message"];
  return String(value);
}
