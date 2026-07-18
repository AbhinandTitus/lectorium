import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { inTauri } from "./library";

export interface BackupInfo {
  path: string;
  name: string;
  bytes: number;
}

export interface ImportReport {
  importedEntries: number;
  importedVocabulary: number;
  skippedNoBook: number;
  skippedDuplicate: number;
}

export async function backupNow(): Promise<string> {
  return invoke<string>("backup_now");
}

export async function listBackups(): Promise<BackupInfo[]> {
  if (!inTauri()) return [];
  return invoke<BackupInfo[]>("list_backups");
}

export async function restoreBackup(path: string): Promise<void> {
  await invoke("restore_backup", { path });
}

/** Choose an exported commonplace.json; Rust reads and imports it. */
export async function importReadingData(): Promise<ImportReport | null> {
  const path = await openDialog({
    directory: false,
    multiple: false,
    title: "Import reading data (commonplace.json)",
    filters: [{ name: "Lectorium export", extensions: ["json"] }],
  });
  if (typeof path !== "string") return null;
  return invoke<ImportReport>("import_reading_data", { path });
}
