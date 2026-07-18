/**
 * Fetches book bytes from the local scoped `book://` protocol ONLY.
 * This module is on the eslint network allowlist because the protocol is
 * served by our own Rust process (ADR 0005) — it is not a network call.
 * Nothing here may ever be pointed at a remote origin.
 */

const LOCAL_BOOK_ORIGIN = "http://book.localhost";

function assertLocal(url: string): void {
  if (!url.startsWith(`${LOCAL_BOOK_ORIGIN}/`)) {
    throw new Error("bookData only reads from the local book protocol.");
  }
}

export async function fetchBookBytes(url: string): Promise<ArrayBuffer> {
  assertLocal(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`book protocol responded ${response.status}`);
  }
  return response.arrayBuffer();
}

export async function fetchBookText(url: string): Promise<string> {
  assertLocal(url);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`book protocol responded ${response.status}`);
  }
  return response.text();
}
