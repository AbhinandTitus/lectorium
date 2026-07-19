import { useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import type { BookSummary } from "../../services/types";
import type { RoomQuality } from "../../services/library";
import { RoomScene } from "./three/RoomScene";
import "./room3d.css";

/**
 * The 3D Reading Room canvas. Demand-driven rendering (only repaints on
 * interaction/hover/invalidate), paused when the window loses focus, and
 * crossfaded out on book open before the Reader mounts. On WebGL failure the
 * caller falls back to the static room.
 */
export function Room3D({
  current,
  companions,
  quality,
  quietNight,
  onOpen,
}: {
  current: BookSummary | null;
  companions: BookSummary[];
  quality: RoomQuality;
  quietNight: boolean;
  onOpen: (bookId: string) => void;
}) {
  const [focused, setFocused] = useState(!document.hidden);
  const [opening, setOpening] = useState<string | null>(null);
  const openTimer = useRef<number | null>(null);

  useEffect(() => {
    const onVis = () => setFocused(!document.hidden);
    const onBlur = () => setFocused(false);
    const onFocus = () => setFocused(true);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      if (openTimer.current) window.clearTimeout(openTimer.current);
    };
  }, []);

  const handleOpen = (bookId: string) => {
    // ~600ms restrained transition, then crossfade out and mount the Reader
    setOpening(bookId);
    openTimer.current = window.setTimeout(() => onOpen(bookId), 600);
  };

  // Quiet Night / blur / reduced-motion → freeze decorative motion (demand
  // rendering already means "static" costs ~0 GPU, but we also stop invalidating).
  const frameloop = !focused || quietNight ? "never" : "demand";

  return (
    <div className={`room3d${opening ? " is-opening" : ""}`}>
      <Canvas
        frameloop={frameloop}
        dpr={quality === "high" ? [1, 2] : 1}
        shadows={quality === "high"}
        gl={{ antialias: quality === "high", powerPreference: "low-power", alpha: false }}
        camera={{ position: [0, 1.6, 6.2], fov: 42, near: 0.1, far: 40 }}
        onCreated={({ camera }) => camera.lookAt(0, -0.6, 0)}
      >
        <RoomScene
          current={current}
          companions={companions}
          quality={quality}
          onOpen={handleOpen}
        />
      </Canvas>
      {/* crossfade veil: warm, never a white flash */}
      <div className="room3d-veil" aria-hidden="true" />
    </div>
  );
}
