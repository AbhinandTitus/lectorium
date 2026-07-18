import * as THREE from "three";

/**
 * Warm, restrained material palette for the nocturnal study — walnut, cloth,
 * paper, aged brass. No emissive bloom; lighting is soft and low-key.
 */
export const MAT = {
  walnut: new THREE.MeshStandardMaterial({ color: "#3a2a1c", roughness: 0.72, metalness: 0.05 }),
  walnutDark: new THREE.MeshStandardMaterial({ color: "#2a1d13", roughness: 0.8, metalness: 0.04 }),
  brass: new THREE.MeshStandardMaterial({ color: "#8a6a2f", roughness: 0.35, metalness: 0.85 }),
  lampShade: new THREE.MeshStandardMaterial({
    color: "#b98a4a",
    roughness: 0.6,
    metalness: 0.1,
    emissive: new THREE.Color("#5a3d1e"),
    emissiveIntensity: 0.6,
  }),
  cloth: new THREE.MeshStandardMaterial({ color: "#4a3320", roughness: 0.95, metalness: 0.0 }),
  pages: new THREE.MeshStandardMaterial({ color: "#d8cbb0", roughness: 0.9 }),
  wallShadow: new THREE.MeshStandardMaterial({ color: "#171310", roughness: 1 }),
} as const;

/** Deterministic warm spine colors for shelf/companion books without covers. */
const SPINE_COLORS = [
  "#5a3b2a",
  "#3c4438",
  "#4e3131",
  "#333d4a",
  "#4a4030",
  "#40324a",
  "#2f4441",
  "#54452b",
];

export function spineColor(seed: number): string {
  return SPINE_COLORS[Math.abs(seed) % SPINE_COLORS.length];
}

export function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h;
}

export function disposeMaterials(): void {
  for (const m of Object.values(MAT)) m.dispose();
}
