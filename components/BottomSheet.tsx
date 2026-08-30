"use client";

/**
 * Mobiele bottom sheet met drie snap-punten: ingeklapt (alleen samenvatting),
 * half en volledig. Slepen via de handle; op desktop wordt dit component
 * niet gebruikt.
 */

import { ReactNode, useCallback, useEffect, useRef, useState } from "react";

export type SheetSnap = "collapsed" | "half" | "full";

const SNAP_HEIGHTS: Record<SheetSnap, number> = {
  collapsed: 0.14,
  half: 0.48,
  full: 0.86,
};

export default function BottomSheet({
  snap,
  onSnapChange,
  peek,
  footer,
  children,
}: {
  snap: SheetSnap;
  onSnapChange: (s: SheetSnap) => void;
  /** Altijd zichtbare kop (yield + platenteller). */
  peek: ReactNode;
  /** Sticky navigatie onder het scrollgebied. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  const [viewportH, setViewportH] = useState(0);
  const [dragOffset, setDragOffset] = useState(0);
  const dragState = useRef<{ startY: number; startHeight: number } | null>(null);

  useEffect(() => {
    const update = () => setViewportH(window.innerHeight);
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const currentHeight =
    viewportH * SNAP_HEIGHTS[snap] - dragOffset;

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      dragState.current = {
        startY: e.clientY,
        startHeight: viewportH * SNAP_HEIGHTS[snap],
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [snap, viewportH],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragState.current) return;
    setDragOffset(e.clientY - dragState.current.startY);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragState.current) return;
      const height = dragState.current.startHeight - (e.clientY - dragState.current.startY);
      dragState.current = null;
      setDragOffset(0);
      const fraction = height / (viewportH || 1);
      let best: SheetSnap = "collapsed";
      let bestDist = Infinity;
      (Object.keys(SNAP_HEIGHTS) as SheetSnap[]).forEach((s) => {
        const d = Math.abs(SNAP_HEIGHTS[s] - fraction);
        if (d < bestDist) {
          bestDist = d;
          best = s;
        }
      });
      onSnapChange(best);
    },
    [onSnapChange, viewportH],
  );

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 flex flex-col rounded-t-3xl bg-white shadow-[0_-8px_30px_rgba(0,0,0,0.12)] lg:hidden"
      style={{
        height: Math.max(viewportH * SNAP_HEIGHTS.collapsed, currentHeight),
        transition: dragState.current || dragOffset !== 0 ? "none" : "height 0.25s ease",
      }}
    >
      <div
        className="shrink-0 cursor-grab touch-none px-4 pt-2"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={() =>
          onSnapChange(snap === "collapsed" ? "half" : snap === "half" ? "full" : "half")
        }
      >
        <div className="mx-auto h-1.5 w-10 rounded-full bg-neutral-300" />
        <div className="pb-2 pt-2">{peek}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {children}
      </div>
      {footer ? (
        <div className="shrink-0 border-t border-neutral-100 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-2">
          {footer}
        </div>
      ) : null}
    </div>
  );
}
