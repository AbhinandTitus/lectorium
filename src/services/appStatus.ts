import { invoke } from "@tauri-apps/api/core";

export interface AppStatus {
  appVersion: string;
  dbSchemaVersion: number;
  dbPath: string;
}

/**
 * Services are the only modules that touch IPC. Outside a Tauri window
 * (vitest, plain browser dev) this resolves to null instead of throwing.
 */
export async function fetchAppStatus(): Promise<AppStatus | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  return invoke<AppStatus>("app_status");
}
