import { create } from "zustand";
import type { AppStatus, BookSummary, ScanEvent } from "../services/types";
import * as lib from "../services/library";
import type { StoredSettings } from "../services/library";

interface LibraryState {
  status: AppStatus | null;
  settings: StoredSettings;
  desk: BookSummary[];
  scanning: boolean;
  scanNote: string | null;
  /** bump to tell Stacks to refresh its current query */
  refreshTick: number;

  bootstrap: () => Promise<void>;
  refreshDesk: () => Promise<void>;
  updateSettings: (patch: Partial<StoredSettings>) => Promise<void>;
  handleScanEvent: (ev: ScanEvent) => void;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  status: null,
  settings: lib.defaultSettings,
  desk: [],
  scanning: false,
  scanNote: null,
  refreshTick: 0,

  bootstrap: async () => {
    const [status, settings] = await Promise.all([lib.fetchAppStatus(), lib.loadSettings()]);
    set({ status, settings });
    if (status) {
      const desk = await lib.deskBooks();
      set({ desk });
      await lib.onScanEvent((ev) => get().handleScanEvent(ev));
    }
  },

  refreshDesk: async () => {
    if (!lib.inTauri()) return;
    set({ desk: await lib.deskBooks() });
  },

  updateSettings: async (patch) => {
    const settings = { ...get().settings, ...patch };
    set({ settings });
    await lib.persistSettings(settings);
  },

  handleScanEvent: (ev) => {
    switch (ev.phase) {
      case "started":
        set({ scanning: true, scanNote: "Looking through the shelves…" });
        break;
      case "progress":
        set({ scanning: true, scanNote: `Reading spines… ${ev.processed} of ${ev.found}` });
        break;
      case "done": {
        const parts: string[] = [];
        if (ev.added > 0) parts.push(`${ev.added} new`);
        if (ev.relinked > 0) parts.push(`${ev.relinked} found again`);
        set({
          scanning: false,
          scanNote: parts.length > 0 ? `Shelves ready — ${parts.join(", ")}.` : null,
          refreshTick: get().refreshTick + 1,
        });
        void get().refreshDesk();
        void lib.fetchAppStatus().then((status) => set({ status }));
        break;
      }
      case "failed":
        set({ scanning: false, scanNote: ev.message });
        break;
    }
  },
}));
