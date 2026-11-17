// Browser harness: serves the production build under the CSP the packaged
// app enforces, replaces the Rust IPC with an in-memory mock, and serves
// book bytes for the `book://` protocol. This is where packaged-only bugs
// (CSP inside chapter iframes, real layout sizes) become reproducible
// without a Windows machine. It does not exercise Rust; `cargo test` does.

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..");
const distDir = join(repoRoot, "dist");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

const NONCE = "e2e0nonce";

/**
 * Tauri appends a nonce to script-src and style-src in packaged builds.
 * Once a nonce is present, browsers ignore 'unsafe-inline' — which is why
 * injected inline <style> elements silently stop applying in the real app.
 */
export function packagedCsp() {
  const conf = JSON.parse(readFileSync(join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"));
  return conf.app.security.csp
    .split(";")
    .map((directive) => {
      const d = directive.trim();
      if (d.startsWith("script-src") || d.startsWith("style-src")) return `${d} 'nonce-${NONCE}'`;
      return d;
    })
    .join("; ");
}

export async function startServer({ csp = packagedCsp() } = {}) {
  if (!existsSync(join(distDir, "index.html"))) {
    throw new Error("dist/ is missing. Run `corepack pnpm build` before the browser harness.");
  }
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    if (rel === "" || rel.includes("..")) rel = "index.html";
    let file = join(distDir, rel);
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(distDir, "index.html");
    let body = readFileSync(file);
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const headers = { "Content-Type": type, "Cache-Control": "no-store" };
    if (type.startsWith("text/html")) {
      headers["Content-Security-Policy"] = csp;
      body = Buffer.from(
        body
          .toString("utf8")
          .replace(/<style>/g, `<style nonce="${NONCE}">`)
          .replace(/<script /g, `<script nonce="${NONCE}" `),
      );
    }
    res.writeHead(200, headers);
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) };
}

// ---------- in-memory backend ----------

const DEFAULT_SETTINGS = {
  version: 1,
  theme: "ember",
  typographyPreset: "open",
  directResume: false,
  onboarded: true,
  calibratedFont: null,
  calibratedFontLabel: null,
  roomQuality: "flat",
  bedtime: null,
  reminderTime: null,
  epubPublisherStyles: false,
};

export function makeBook(id, title, sourceFormat, bytes, extra = {}) {
  const readingFormat =
    sourceFormat === "epub" ? "epub" : sourceFormat === "pdf" ? "pdf" : "text";
  return {
    bytes,
    record: {
      id,
      title,
      authors: ["Lectorium Fixtures"],
      language: "en",
      sourceFormat,
      readingFormat,
      status: "desk",
      deskRole: null,
      coverCachePath: null,
      canonicalPath: `/library/${id}.${sourceFormat}`,
      missing: false,
      lastOpenedAt: null,
      description: null,
      series: null,
      readingMode: "story",
      addedAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    },
  };
}

/** State that outlives a page reload, the way SQLite outlives a restart. */
export class Backend {
  constructor(books, settings = {}) {
    this.books = new Map(books.map((b) => [b.record.id, b]));
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.locations = new Map();
    this.annotations = [];
    this.saves = [];
    this.calls = [];
    this.kv = new Map();
    /** command name -> (args) => result; lets a scenario add or override */
    this.handlers = new Map();
  }

  detail(id) {
    const book = this.books.get(id);
    if (!book) throw { kind: "other", message: "That book is not in the library." };
    return { ...book.record, location: this.locations.get(id) ?? null };
  }

  invoke(cmd, args) {
    this.calls.push(cmd);
    const custom = this.handlers.get(cmd);
    if (custom) return custom(args, this);
    switch (cmd) {
      case "app_status":
        return {
          appVersion: "e2e",
          dbSchemaVersion: 1,
          dbPath: "",
          bookCount: this.books.size,
          hasRoots: true,
          resumeRequested: false,
          lastLocationBookId: null,
        };
      case "get_settings":
        return JSON.stringify(this.settings);
      case "save_settings":
        this.settings = JSON.parse(args.payload.json);
        return null;
      case "desk_books":
      case "list_books":
        return [...this.books.values()].map((b) => b.record);
      case "get_book":
        return this.detail(args.bookId);
      case "save_location":
        this.locations.set(args.bookId, {
          ...args.location,
          updatedAt: new Date().toISOString(),
        });
        this.saves.push({ bookId: args.bookId, ...args.location });
        return null;
      case "mark_opened":
        return null;
      case "list_annotations":
        return this.annotations.filter((a) => a.bookId === args.bookId);
      case "add_annotation":
        this.annotations.push(args.annotation);
        return null;
      case "delete_annotation":
        this.annotations = this.annotations.filter((a) => a.id !== args.id);
        return null;
      case "plugin:event|listen":
        return 1;
      case "plugin:window|is_fullscreen":
        return false;
      default:
        return null;
    }
  }

  lastSave(bookId) {
    for (let i = this.saves.length - 1; i >= 0; i--) {
      if (this.saves[i].bookId === bookId) return this.saves[i];
    }
    return null;
  }
}

const TAURI_MOCK = `
(() => {
  let seq = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { label: "main", windowLabel: "main" },
    },
    transformCallback(callback) {
      const id = ++seq;
      window["_" + id] = callback;
      return id;
    },
    unregisterCallback() {},
    convertFileSrc: (path) => path,
    invoke: async (cmd, args) => {
      const raw = await window.__e2eInvoke(cmd, JSON.stringify(args ?? {}));
      const reply = JSON.parse(raw);
      if (reply.error) throw reply.error;
      return reply.value;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
})();
`;

export async function launch() {
  const { chromium } = require("playwright");
  return chromium.launch();
}

/**
 * Open the app in a fresh page bound to `backend`. A new page against the
 * same backend is the harness's equivalent of quitting and relaunching.
 */
export async function openApp(browser, server, backend, { viewport, scale = 1 } = {}) {
  const context = await browser.newContext({
    viewport: viewport ?? { width: 1707, height: 912 },
    deviceScaleFactor: scale,
  });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  await page.exposeFunction("__e2eInvoke", (cmd, json) => {
    try {
      return JSON.stringify({ value: backend.invoke(cmd, JSON.parse(json)) ?? null });
    } catch (error) {
      return JSON.stringify({ error });
    }
  });
  await page.addInitScript(TAURI_MOCK);
  await context.route("http://book.localhost/**", (route) => {
    const url = new URL(route.request().url());
    const [, kind, id] = url.pathname.split("/");
    const book = backend.books.get(id);
    const cors = { "Access-Control-Allow-Origin": "*" };
    if (kind !== "file" || !book) {
      return route.fulfill({ status: 404, headers: cors, body: "" });
    }
    const type =
      book.record.sourceFormat === "epub"
        ? "application/epub+zip"
        : book.record.sourceFormat === "pdf"
          ? "application/pdf"
          : "text/plain; charset=utf-8";
    const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers()["range"] ?? "");
    if (range) {
      const start = Number(range[1]);
      const end = range[2] ? Math.min(Number(range[2]), book.bytes.length - 1) : book.bytes.length - 1;
      return route.fulfill({
        status: 206,
        headers: {
          ...cors,
          "Content-Type": type,
          "Accept-Ranges": "bytes",
          "Content-Range": `bytes ${start}-${end}/${book.bytes.length}`,
          "Access-Control-Expose-Headers": "Content-Range, Accept-Ranges, Content-Length",
        },
        body: book.bytes.subarray(start, end + 1),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, "Content-Type": type, "Accept-Ranges": "bytes" },
      body: book.bytes,
    });
  });
  await page.goto(server.url);
  await page.waitForSelector("main");
  return { page, context, problems };
}

/** Enter the Reader for `bookId` through the app's own navigation store. */
export async function openBook(page, title) {
  await page.getByRole("button", { name: "Stacks" }).click();
  await page.getByText(title, { exact: true }).first().click();
  await page.getByRole("button", { name: "Open", exact: true }).click();
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
