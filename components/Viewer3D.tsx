"use client";

import { useEffect, useRef } from "react";
import { CabinetModel } from "@/lib/model";
import { CabinetScene } from "@/lib/render/scene";

export default function Viewer3D({
  model,
  onCellTap,
}: {
  model: CabinetModel;
  onCellTap: (cellKey: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<CabinetScene | null>(null);
  const tapRef = useRef(onCellTap);
  tapRef.current = onCellTap;

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new CabinetScene(containerRef.current, (key) =>
      tapRef.current(key),
    );
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.updateModel(model);
  }, [model]);

  return <div ref={containerRef} className="h-full w-full" />;
}
