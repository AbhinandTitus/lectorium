import { invoke } from "@tauri-apps/api/core";
import type { ReadingMode } from "./types";

export type AnnotationKind =
  | "highlight"
  | "note"
  | "bookmark"
  | "quote"
  | "idea"
  | "question"
  | "vocabulary"
  | "action"
  | "character"
  | "free";

export interface Annotation {
  id: string;
  bookId: string;
  kind: AnnotationKind;
  startLocatorJson: string;
  endLocatorJson: string | null;
  exactQuote: string | null;
  prefix: string | null;
  suffix: string | null;
  note: string | null;
  colorToken: string | null;
  commonplaceHeading: string | null;
  createdAt?: string | null;
}

export async function addAnnotation(a: Annotation): Promise<void> {
  await invoke("add_annotation", { annotation: a });
}

export async function listAnnotations(bookId: string): Promise<Annotation[]> {
  return invoke<Annotation[]>("list_annotations", { bookId });
}

export async function updateAnnotation(
  id: string,
  note: string | null,
  heading: string | null,
): Promise<void> {
  await invoke("update_annotation", { id, note, heading });
}

export async function deleteAnnotation(id: string): Promise<void> {
  await invoke("delete_annotation", { id });
}

export async function setReadingMode(bookId: string, mode: ReadingMode): Promise<void> {
  await invoke("set_reading_mode", { bookId, mode });
}
