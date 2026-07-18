import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppStatus,
  BookDetail,
  BookSummary,
  DeskConflict,
  DeskRole,
  LibraryRoot,
  SavedLocation,
  ScanEvent,
} from "./types";

export function inTauri(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export async function fetchAppStatus(): Promise<AppStatus | null> {
  if (!inTauri()) return null;
  return invoke<AppStatus>("app_status");
}

/** Ask the user for a library folder; returns the created root, or null if cancelled. */
export async function chooseAndAddLibraryRoot(): Promise<LibraryRoot | null> {
  const path = await openDialog({
    directory: true,
    multiple: false,
    title: "Choose a book folder",
  });
  if (typeof path !== "string") return null;
  return invoke<LibraryRoot>("add_library_root", { path });
}

export async function listLibraryRoots(): Promise<LibraryRoot[]> {
  return invoke<LibraryRoot[]>("list_library_roots");
}

export async function rescanLibrary(): Promise<void> {
  await invoke("rescan_library");
}

export interface BookQuery {
  search?: string;
  status?: string;
  format?: string;
  limit?: number;
  offset?: number;
}

export async function listBooks(query: BookQuery = {}): Promise<BookSummary[]> {
  return invoke<BookSummary[]>("list_books", { query });
}

export async function deskBooks(): Promise<BookSummary[]> {
  return invoke<BookSummary[]>("desk_books");
}

export async function getBook(bookId: string): Promise<BookDetail> {
  return invoke<BookDetail>("get_book", { bookId });
}

export async function setDeskRole(
  bookId: string,
  role: DeskRole | null,
  replace = false,
): Promise<DeskConflict | null> {
  const result = await invoke<{ ok?: boolean; conflict?: DeskConflict }>("set_desk_role", {
    bookId,
    role,
    replace,
  });
  return result.conflict ?? null;
}

export async function setBookStatus(bookId: string, status: string): Promise<void> {
  await invoke("set_book_status", { bookId, status });
}

export async function saveLocation(bookId: string, location: SavedLocation): Promise<void> {
  await invoke("save_location", { bookId, location });
}

export async function markOpened(bookId: string): Promise<void> {
  await invoke("mark_opened", { bookId });
}

export async function relinkBook(bookId: string, newPath: string): Promise<void> {
  await invoke("relink_book", { bookId, newPath });
}

/** Pick a single file to relink a missing book. */
export async function chooseRelinkFile(): Promise<string | null> {
  const path = await openDialog({ directory: false, multiple: false, title: "Find this file" });
  return typeof path === "string" ? path : null;
}

export function onScanEvent(handler: (ev: ScanEvent) => void): Promise<UnlistenFn> {
  return listen<ScanEvent>("library:scan", (e) => handler(e.payload));
}

/** URL for streaming a book's bytes through the scoped protocol. */
export function bookFileUrl(bookId: string): string {
  // WebView2 maps custom schemes to http://{scheme}.localhost/
  return `http://book.localhost/file/${bookId}`;
}

export function bookCoverUrl(bookId: string): string {
  return `http://book.localhost/cover/${bookId}`;
}

export type RoomQuality = "high" | "low" | "flat";

export interface StoredSettings {
  version: 1;
  theme: "paper" | "ember";
  typographyPreset: "focus" | "open" | "air";
  directResume: boolean;
  onboarded: boolean;
  /** chosen by "Make the page fit me"; overrides the preset font */
  calibratedFont: string | null;
  calibratedFontLabel: string | null;
  /** 3D Room quality; "flat" forces the static room */
  roomQuality: RoomQuality;
}

export const defaultSettings: StoredSettings = {
  version: 1,
  theme: "ember",
  typographyPreset: "open",
  directResume: false,
  onboarded: false,
  calibratedFont: null,
  calibratedFontLabel: null,
  roomQuality: "high",
};

export async function loadSettings(): Promise<StoredSettings> {
  if (!inTauri()) return defaultSettings;
  const raw = await invoke<string | null>("get_settings");
  if (!raw) return defaultSettings;
  try {
    return { ...defaultSettings, ...(JSON.parse(raw) as Partial<StoredSettings>) };
  } catch {
    return defaultSettings;
  }
}

export async function persistSettings(settings: StoredSettings): Promise<void> {
  if (!inTauri()) return;
  await invoke("save_settings", {
    payload: { version: settings.version, json: JSON.stringify(settings) },
  });
}
