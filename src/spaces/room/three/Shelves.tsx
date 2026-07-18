import { useMemo } from "react";
import * as THREE from "three";
import { spineColor } from "./materials";

/**
 * Tall shelves in shadow. Books are a single InstancedMesh — never thousands
 * of unique meshes (docs/PRODUCT.md performance). Purely atmospheric depth;
 * individual books are not interactive here (that's the Stacks' job).
 */
export function Shelves({ count = 140 }: { count?: number }) {
  const { geometry, instances } = useMemo(() => {
    const geometry = new THREE.BoxGeometry(0.18, 1.0, 0.7);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const instances: { matrix: THREE.Matrix4; color: THREE.Color }[] = [];
    const rows = 6;
    const perRow = Math.ceil(count / rows);
    let i = 0;
    for (let row = 0; row < rows; row++) {
      let x = -4.2;
      for (let c = 0; c < perRow && i < count; c++) {
        const h = 0.85 + Math.random() * 0.4;
        const w = 0.14 + Math.random() * 0.12;
        dummy.position.set(x + w / 2, -1.4 + row * 1.15 + h / 2, -3.2 + Math.random() * 0.05);
        dummy.scale.set(w / 0.18, h, 1);
        dummy.rotation.z = Math.random() < 0.08 ? 0.12 : 0;
        dummy.updateMatrix();
        color.set(spineColor(Math.floor(Math.random() * 8)));
        instances.push({ matrix: dummy.matrix.clone(), color: color.clone() });
        x += w + 0.015;
        i++;
      }
    }
    return { geometry, instances };
  }, [count]);

  return (
    <group>
      {/* shelf boards */}
      {[0, 1, 2, 3, 4, 5].map((r) => (
        <mesh key={r} position={[-0.5, -1.45 + r * 1.15, -3.35]} receiveShadow>
          <boxGeometry args={[9, 0.08, 0.85]} />
          <meshStandardMaterial color="#241811" roughness={0.85} />
        </mesh>
      ))}
      <instancedMesh
        args={[geometry, undefined, instances.length]}
        castShadow
        ref={(mesh) => {
          if (!mesh) return;
          instances.forEach((inst, idx) => {
            mesh.setMatrixAt(idx, inst.matrix);
            mesh.setColorAt(idx, inst.color);
          });
          mesh.instanceMatrix.needsUpdate = true;
          if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        }}
      >
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
}
