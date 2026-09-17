"use client";

import { useEffect, useRef, useState } from "react";
import { CabinetModel } from "@/lib/model";
import { CabinetScene, VIEW_CUBE_SIZE, ViewName } from "@/lib/render/scene";

const VIEW_LABELS: Record<ViewName, string> = {
  voor: "Vooraanzicht",
  achter: "Achteraanzicht",
  links: "Linker zijaanzicht",
  rechts: "Rechter zijaanzicht",
  boven: "Bovenaanzicht",
  onder: "Onderaanzicht",
  standaard: "Standaardaanzicht",
};

export default function Viewer3D({
  model,
  onCellTap,
  onShelfTap,
  selectedShelf = null,
}: {
  model: CabinetModel;
  onCellTap: (cellKey: string) => void;
  onShelfTap: (shelfKey: string) => void;
  selectedShelf?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cubeRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CabinetScene | null>(null);
  const tapRef = useRef(onCellTap);
  tapRef.current = onCellTap;
  const shelfTapRef = useRef(onShelfTap);
  shelfTapRef.current = onShelfTap;
  const cubeDown = useRef<{ x: number; y: number } | null>(null);
  const [viewNote, setViewNote] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new CabinetScene(
      containerRef.current,
      (key) => tapRef.current(key),
      (key) => shelfTapRef.current(key),
    );
    sceneRef.current = scene;
    scene.setCubeElement(cubeRef.current);
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateModel(model, selectedShelf);
  }, [model, selectedShelf]);

  useEffect(() => {
    if (!viewNote) return;
    const t = setTimeout(() => setViewNote(null), 1400);
    return () => clearTimeout(t);
  }, [viewNote]);

  /** Pointerpositie in de kubus-overlay → genormaliseerd (−1…1, y omhoog). */
  const cubeNdc = (e: React.PointerEvent) => {
    const rect = cubeRef.current!.getBoundingClientRect();
    return {
      nx: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      ny: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  };

  const pickView = (view: ViewName) => {
    sceneRef.current?.setView(view);
    setViewNote(VIEW_LABELS[view]);
  };

  return (
    <div className="relative h-full w-full">
      <div
        ref={containerRef}
        className="h-full w-full"
        style={{ background: "linear-gradient(180deg, #ffffff 0%, #f5f6f8 60%, #e9ebee 100%)" }}
      />

      {/* Aanzichtenkubus: de kubus zelf wordt door de scene in deze hoek
          gerenderd; deze overlay vangt alleen de aanraking af zodat
          OrbitControls er niets van merkt. */}
      <div
        ref={cubeRef}
        role="group"
        aria-label="Aanzicht kiezen"
        title="Tik op een vlak voor dat aanzicht"
        className="absolute bottom-1 left-1 z-10 cursor-pointer select-none lg:bottom-2 lg:left-2"
        style={{ width: VIEW_CUBE_SIZE, height: VIEW_CUBE_SIZE, touchAction: "none" }}
        onPointerDown={(e) => {
          cubeDown.current = { x: e.clientX, y: e.clientY };
          e.stopPropagation();
        }}
        onPointerMove={(e) => {
          if (e.pointerType === "mouse") {
            const { nx, ny } = cubeNdc(e);
            sceneRef.current?.cubeHoverAt(nx, ny);
          }
        }}
        onPointerLeave={() => sceneRef.current?.cubeHoverEnd()}
        onPointerUp={(e) => {
          const down = cubeDown.current;
          cubeDown.current = null;
          if (!down) return;
          const dx = e.clientX - down.x;
          const dy = e.clientY - down.y;
          if (dx * dx + dy * dy > 64) return;
          const { nx, ny } = cubeNdc(e);
          const view = sceneRef.current?.cubeTapAt(nx, ny) ?? null;
          if (view) setViewNote(VIEW_LABELS[view]);
        }}
      >
        {/* Toetsenbord/screenreader-alternatief voor de vlakken. */}
        <span className="sr-only">
          {(["voor", "achter", "links", "rechts", "boven", "onder"] as ViewName[]).map((v) => (
            <button key={v} type="button" onClick={() => pickView(v)}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </span>
      </div>

      {/* Terug naar het standaard (schuine) aanzicht. */}
      <button
        type="button"
        onClick={() => pickView("standaard")}
        aria-label="Standaardaanzicht"
        title="Standaardaanzicht"
        className="btn-touch absolute bottom-8 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/90 text-neutral-700 shadow ring-1 ring-neutral-200 backdrop-blur hover:bg-white active:scale-95 lg:bottom-9"
        style={{ left: VIEW_CUBE_SIZE + 6 }}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 4v5h5" />
        </svg>
      </button>

      {viewNote && (
        <p
          className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-neutral-900/80 px-3 py-1 text-xs font-medium text-white"
          role="status"
        >
          {viewNote}
        </p>
      )}
    </div>
  );
}
