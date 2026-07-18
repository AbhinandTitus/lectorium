import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { AnnotationKind } from "./annotations";

export interface CommonplaceEntry {
  id: string;
  bookId: string;
  bookTitle: string;
  bookAuthors: string[];
  kind: AnnotationKind;
  exactQuote: string | null;
  note: string | null;
  commonplaceHeading: string | null;
  sectionTitle: string | null;
  startLocatorJson: string;
  engineType: "epub" | "pdf" | "text";
  createdAt: string;
  linkedIds: string[];
}

export interface CommonplaceQuery {
  search?: string;
  heading?: string;
  kind?: string;
  bookId?: string;
}

export interface VocabularyEntry {
  id: string;
  bookId: string;
  normalizedWord: string;
  displayedWord: string;
  sentence: string;
  definition: string | null;
  locatorJson: string;
  note: string | null;
  createdAt?: string | null;
}

export interface RecallItem {
  annotationId: string;
  bookId: string;
  cue: string;
  kind: AnnotationKind;
  bookTitle: string;
  exactQuote: string | null;
  note: string | null;
}

export async function listCommonplace(query: CommonplaceQuery = {}): Promise<CommonplaceEntry[]> {
  return invoke<CommonplaceEntry[]>("list_commonplace", { query });
}

export async function listHeadings(): Promise<string[]> {
  return invoke<string[]>("list_headings");
}

export async function linkEntries(fromId: string, toId: string): Promise<void> {
  await invoke("link_entries", { fromId, toId });
}

export async function unlinkEntries(fromId: string, toId: string): Promise<void> {
  await invoke("unlink_entries", { fromId, toId });
}

export async function listVocabulary(): Promise<VocabularyEntry[]> {
  return invoke<VocabularyEntry[]>("list_vocabulary");
}

export async function addVocabulary(entry: VocabularyEntry): Promise<void> {
  await invoke("add_vocabulary", { entry });
}

export async function recallAvailable(limit = 20): Promise<RecallItem[]> {
  return invoke<RecallItem[]>("recall_available", { limit });
}

export async function recordRecall(
  annotationId: string,
  response: string | null,
  remembered: boolean,
): Promise<void> {
  await invoke("record_recall", { annotationId, response, remembered });
}

/** Choose a folder and export the Commonplace as Markdown + JSON. */
export async function exportCommonplace(): Promise<string | null> {
  const dir = await openDialog({ directory: true, multiple: false, title: "Export to folder" });
  if (typeof dir !== "string") return null;
  return invoke<string>("export_commonplace", { dir });
}
