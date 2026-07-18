/** Shared IPC data shapes (mirror src-tauri/src/db/repo.rs). */

export type BookStatus = "shelf" | "desk" | "paused" | "completed" | "reference";
export type DeskRole = "current" | "companion" | "short";
export type ReadingMode = "story" | "study" | "contemplative";
export type EngineType = "epub" | "pdf" | "text";

export interface LibraryRoot {
  id: number;
  canonicalPath: string;
  displayName: string;
  lastScanAt: string | null;
}

export interface BookSummary {
  id: string;
  title: string;
  authors: string[];
  language: string | null;
  sourceFormat: string;
  readingFormat: EngineType;
  status: BookStatus;
  deskRole: DeskRole | null;
  coverCachePath: string | null;
  canonicalPath: string;
  missing: boolean;
  lastOpenedAt: string | null;
}

export interface SavedLocation {
  engineType: EngineType;
  locatorJson: string;
  sectionTitle: string | null;
  pageIndex: number | null;
  updatedAt?: string | null;
}

export interface BookDetail extends BookSummary {
  description: string | null;
  series: string | null;
  readingMode: ReadingMode;
  addedAt: string;
  location: SavedLocation | null;
}

export interface DeskConflict {
  role: DeskRole;
  occupantId: string;
  occupantTitle: string;
}

export interface AppStatus {
  appVersion: string;
  dbSchemaVersion: number;
  dbPath: string;
  bookCount: number;
  hasRoots: boolean;
  resumeRequested: boolean;
  lastLocationBookId: string | null;
}

export type ScanEvent =
  | { phase: "started"; rootId: number }
  | { phase: "progress"; rootId: number; found: number; processed: number }
  | {
      phase: "done";
      rootId: number;
      found: number;
      added: number;
      relinked: number;
      missing: number;
    }
  | { phase: "failed"; rootId: number; message: string };
