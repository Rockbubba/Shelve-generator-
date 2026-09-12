"use client";

import { useEffect, useRef } from "react";
import { CabinetModel } from "@/lib/model";
import { CabinetScene } from "@/lib/render/scene";

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
  const sceneRef = useRef<CabinetScene | null>(null);
  const tapRef = useRef(onCellTap);
  tapRef.current = onCellTap;
  const shelfTapRef = useRef(onShelfTap);
  shelfTapRef.current = onShelfTap;

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new CabinetScene(
      containerRef.current,
      (key) => tapRef.current(key),
      (key) => shelfTapRef.current(key),
    );
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateModel(model, selectedShelf);
  }, [model, selectedShelf]);

  return <div ref={containerRef} className="h-full w-full" />;
}
