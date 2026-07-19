import { create } from "zustand";

/** The four spaces. Settings is a sheet, not a destination. */
export type Space = "room" | "reader" | "stacks" | "commonplace";

interface NavigationState {
  space: Space;
  /** book open in the Reader (null when the Reader is not active) */
  openBookId: string | null;
  /** optional annotation/source locator requested by another space */
  openLocatorJson: string | null;
  goTo: (space: Space) => void;
  openBook: (bookId: string, locatorJson?: string | null) => void;
  closeBook: () => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  space: "room",
  openBookId: null,
  openLocatorJson: null,
  goTo: (space) => set({ space }),
  openBook: (bookId, locatorJson = null) =>
    set({ space: "reader", openBookId: bookId, openLocatorJson: locatorJson }),
  closeBook: () => set({ space: "room", openBookId: null, openLocatorJson: null }),
}));
