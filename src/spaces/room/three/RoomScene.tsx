import { Suspense, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { BookSummary } from "../../../services/types";
import type { RoomQuality } from "../../../services/library";
import { hashString, MAT, spineColor } from "./materials";
import { DeskBook } from "./DeskBook";
import { Shelves } from "./Shelves";

/**
 * The nocturnal study, built from procedural geometry (a clear seam to swap
 * in optimized GLB/KTX2 assets later). Fixed elevated camera; a shaded amber
 * lamp is the only warm source; soft shadows, no bloom. Rendering is
 * demand-driven — the canvas only repaints on interaction/hover.
 */
export function RoomScene({
  current,
  companions,
  quality,
  onOpen,
}: {
  current: BookSummary | null;
  companions: BookSummary[];
  quality: RoomQuality;
  onOpen: (bookId: string) => void;
}) {
  const { gl, invalidate } = useThree();

  useEffect(() => {
    gl.setClearColor(new THREE.Color("#100d0a"), 1);
    // repaint once after mount so the first frame is correct under demand
    invalidate();
  }, [gl, invalidate]);

  const highDetail = quality === "high";

  return (
    <>
      {/* key: warm shaded lamp; soft fill so shadows are not crushed */}
      <ambientLight intensity={0.32} color="#6a5238" />
      <spotLight
        position={[1.9, 3.2, 1.9]}
        angle={0.8}
        penumbra={0.85}
        intensity={48}
        distance={13}
        color="#e0a457"
        castShadow={highDetail}
        shadow-mapSize-width={highDetail ? 1024 : 512}
        shadow-mapSize-height={highDetail ? 1024 : 512}
        shadow-bias={-0.0005}
      />
      {/* soft warm glow just above the current book */}
      <pointLight position={[0.2, 0.4, 1.2]} intensity={5} distance={5} color="#c98a45" />
      <pointLight position={[-3, 1.5, 2]} intensity={3.5} distance={9} color="#4a3a22" />

      {/* desk */}
      <mesh position={[0, -1.15, 0.4]} receiveShadow material={MAT.walnut}>
        <boxGeometry args={[7.5, 0.35, 3.6]} />
      </mesh>
      <mesh position={[0, -1.9, 0.4]} material={MAT.walnutDark}>
        <boxGeometry args={[7.2, 1.2, 3.2]} />
      </mesh>

      {/* lamp: brass stem + shade angled over the current book */}
      <group position={[2.2, -0.98, 0.9]}>
        <mesh material={MAT.brass}>
          <cylinderGeometry args={[0.045, 0.06, 1.5, 12]} />
        </mesh>
        {/* elbow toward the book */}
        <mesh position={[-0.25, 0.72, 0]} rotation={[0, 0, 0.5]} material={MAT.brass}>
          <cylinderGeometry args={[0.045, 0.045, 0.7, 12]} />
        </mesh>
        <mesh position={[-0.5, 0.95, 0]} material={MAT.lampShade}>
          <coneGeometry args={[0.42, 0.44, 20, 1, true]} />
        </mesh>
        <mesh position={[0, -0.78, 0]} material={MAT.brass}>
          <cylinderGeometry args={[0.26, 0.26, 0.06, 20]} />
        </mesh>
      </group>

      {/* current book under the lamp */}
      <Suspense fallback={null}>
        {current && (
          <DeskBook book={current} position={[0, -0.92, 0.5]} onOpen={() => onOpen(current.id)} />
        )}
      </Suspense>

      {/* companions on a small side stand */}
      <group position={[-2.6, -0.98, 0.6]}>
        <mesh position={[0, -0.05, 0]} receiveShadow material={MAT.cloth}>
          <boxGeometry args={[1.6, 0.12, 1.2]} />
        </mesh>
        {companions.slice(0, 2).map((b, i) => (
          <CompanionBook key={b.id} book={b} index={i} onOpen={() => onOpen(b.id)} />
        ))}
      </group>

      {/* shadowed shelves for depth */}
      {highDetail && <Shelves />}

      {/* dark back wall / recess */}
      <mesh position={[0, 1, -4]} material={MAT.wallShadow}>
        <planeGeometry args={[16, 10]} />
      </mesh>
    </>
  );
}

function CompanionBook({
  book,
  index,
  onOpen,
}: {
  book: BookSummary;
  index: number;
  onOpen: () => void;
}) {
  const color = spineColor(hashString(book.title + book.id));
  return (
    <group
      position={[-0.3 + index * 0.55, 0.28, 0]}
      rotation={[0, 0.1 - index * 0.2, 0]}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "default")}
    >
      <mesh castShadow receiveShadow>
        <boxGeometry args={[0.34, 0.78, 0.9]} />
        <meshStandardMaterial color={color} roughness={0.7} />
      </mesh>
    </group>
  );
}
