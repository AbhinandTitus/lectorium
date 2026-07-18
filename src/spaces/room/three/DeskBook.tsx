import { useMemo } from "react";
import * as THREE from "three";
import { useTexture } from "@react-three/drei";
import type { BookSummary } from "../../../services/types";
import { bookCoverUrl, inTauri } from "../../../services/library";
import { hashString, MAT, spineColor } from "./materials";

/**
 * The current book resting on the desk, cover-up. Uses the real cover
 * texture when available; otherwise a coherent spine color from title/author.
 * A generated spine is derived from the same palette.
 */
export function DeskBook({
  book,
  position,
  onOpen,
}: {
  book: BookSummary;
  position: [number, number, number];
  onOpen: () => void;
}) {
  const hasCover = inTauri() && Boolean(book.coverCachePath);
  const spine = useMemo(
    () =>
      new THREE.MeshStandardMaterial({ color: spineColor(hashString(book.title)), roughness: 0.7 }),
    [book.title],
  );

  return (
    <group
      position={position}
      rotation={[-Math.PI / 2 + 0.06, 0, 0.02]}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "default")}
    >
      {/* book block */}
      <mesh castShadow receiveShadow material={MAT.pages}>
        <boxGeometry args={[1.35, 2.0, 0.26]} />
      </mesh>
      {/* cover face slightly proud of the pages */}
      {hasCover ? (
        <CoverFace bookId={book.id} />
      ) : (
        <mesh position={[0, 0, 0.135]} material={spine}>
          <boxGeometry args={[1.36, 2.01, 0.02]} />
        </mesh>
      )}
      {/* spine strip */}
      <mesh position={[-0.68, 0, 0]} material={spine}>
        <boxGeometry args={[0.03, 2.0, 0.26]} />
      </mesh>
    </group>
  );
}

function CoverFace({ bookId }: { bookId: string }) {
  const texture = useTexture(bookCoverUrl(bookId));
  texture.colorSpace = THREE.SRGBColorSpace;
  return (
    <mesh position={[0, 0, 0.135]}>
      <boxGeometry args={[1.36, 2.01, 0.02]} />
      <meshStandardMaterial map={texture} roughness={0.55} />
    </mesh>
  );
}
