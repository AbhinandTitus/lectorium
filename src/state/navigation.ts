import { create } from "zustand";

/** The four spaces. Settings is a sheet, not a destination. */
export type Space = "room" | "reader" | "stacks" | "commonplace";

interface NavigationState {
  space: Space;
  /** book open in the Reader (null when the Reader is not active) */
  openBookId: string | null;
  goTo: (space: Space) => void;
  openBook: (bookId: string) => void;
  closeBook: () => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  space: "room",
  openBookId: null,
  goTo: (space) => set({ space }),
  openBook: (bookId) => set({ space: "reader", openBookId: bookId }),
  closeBook: () => set({ space: "room", openBookId: null }),
}));
