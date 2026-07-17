import { create } from "zustand";

/** The four spaces. Settings is a sheet, not a destination. */
export type Space = "room" | "reader" | "stacks" | "commonplace";

interface NavigationState {
  space: Space;
  goTo: (space: Space) => void;
}

export const useNavigation = create<NavigationState>((set) => ({
  space: "room",
  goTo: (space) => set({ space }),
}));
