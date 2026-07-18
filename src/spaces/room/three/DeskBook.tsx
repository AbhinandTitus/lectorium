import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { BookSummary } from "../../../services/types";
import { bookCoverUrl, inTauri } from "../../../services/library";
import { hashString, MAT, spineColor } from "./materials";

/**
 * The current book resting on the desk, cover-up. The real cover texture is
 * loaded imperatively and falls back to a coherent spine color if it cannot
 * load — a cover failure must never throw (that would crash the R3F Canvas).
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
  const spine = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: spineColor(hashString(book.title)),
        roughness: 0.7,
      }),
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
      {/* cover face: real texture when it loads, spine color otherwise */}
      <CoverFace
        bookId={book.id}
        hasCover={inTauri() && Boolean(book.coverCachePath)}
        spine={spine}
      />
      {/* spine strip */}
      <mesh position={[-0.68, 0, 0]} material={spine}>
        <boxGeometry args={[0.03, 2.0, 0.26]} />
      </mesh>
    </group>
  );
}

function CoverFace({
  bookId,
  hasCover,
  spine,
}: {
  bookId: string;
  hasCover: boolean;
  spine: THREE.MeshStandardMaterial;
}) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    if (!hasCover) return;
    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.load(
      bookCoverUrl(bookId),
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setTexture(tex);
      },
      undefined,
      // onError: silently keep the spine-color fallback — never throw
      () => {
        if (!cancelled) setTexture(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [bookId, hasCover]);

  useEffect(() => () => texture?.dispose(), [texture]);

  return (
    <mesh position={[0, 0, 0.135]} material={texture ? undefined : spine}>
      <boxGeometry args={[1.36, 2.01, 0.02]} />
      {texture && <meshStandardMaterial map={texture} roughness={0.55} />}
    </mesh>
  );
}
