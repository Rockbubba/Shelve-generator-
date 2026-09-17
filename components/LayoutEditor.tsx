"use client";

/**
 * Compacte vooraanzicht-editor voor de vakindeling: kolommen en planken als
 * schema. Tik op een tussenplank om hem te selecteren, sleep hem omhoog/
 * omlaag (snapt op 10 mm) om de vakhoogtes per kolom te veranderen.
 * Binnenstaanders en tussenschotten slepen horizontaal. Tik in een leeg vak
 * om het te selecteren (tussenschotten toevoegen). Weggelaten planken staan
 * gestippeld; tikken zet ze terug (via de bovenliggende handler die de
 * sleutel herkent).
 */

import { useRef, useState } from "react";
import { CabinetModel } from "@/lib/model";

export default function LayoutEditor({
  model,
  offsets,
  columnOffsets,
  dividerOffsets,
  selected,
  onSelect,
  onOffsetChange,
  onColumnOffsetChange,
  onDividerOffsetChange,
  onRestore,
}: {
  model: CabinetModel;
  offsets: Record<string, number>;
  columnOffsets: Record<string, number>;
  dividerOffsets: Record<string, number>;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onOffsetChange: (key: string, offset: number) => void;
  onColumnOffsetChange: (index: number, offset: number) => void;
  /** key zonder `div:`-prefix (= cellKey:k). */
  onDividerOffsetChange: (key: string, offset: number) => void;
  onRestore?: (key: string) => void;
}) {
  const W = model.snappedWidth;
  const H = model.config.height;
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{
    key: string;
    kind: "shelf" | "col" | "div";
    startPx: number;
    startOffset: number;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const mmPerPx = (axis: "x" | "y") => {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return 1;
    return axis === "y" ? (box.height > 0 ? H / box.height : 1) : box.width > 0 ? W / box.width : 1;
  };

  const staanders = model.panels.filter((p) => p.type === "staander");
  const planken = model.panels.filter((p) => p.type === "plank");
  const schotten = model.panels.filter((p) => p.type === "schot");

  return (
    <svg
      ref={svgRef}
      viewBox={`-6 -6 ${W + 12} ${H + 12}`}
      className="w-full touch-none rounded-xl border border-neutral-200 bg-neutral-50"
      style={{ maxHeight: 260 }}
      role="img"
      aria-label="Vakindeling vooraanzicht"
      onPointerMove={(e) => {
        if (!drag.current) return;
        if (drag.current.kind === "shelf") {
          const dyMm = -(e.clientY - drag.current.startPx) * mmPerPx("y");
          const snapped = Math.round(dyMm / 10) * 10;
          onOffsetChange(drag.current.key, drag.current.startOffset + snapped);
          return;
        }
        const dxMm = (e.clientX - drag.current.startPx) * mmPerPx("x");
        const snapped = Math.round(dxMm / 10) * 10;
        if (drag.current.kind === "col") {
          onColumnOffsetChange(
            Number(drag.current.key.replace("col:", "")),
            drag.current.startOffset + snapped,
          );
        } else {
          onDividerOffsetChange(
            drag.current.key.replace("div:", ""),
            drag.current.startOffset + snapped,
          );
        }
      }}
      onPointerUp={() => {
        drag.current = null;
        setDragging(false);
      }}
      onPointerLeave={() => {
        drag.current = null;
        setDragging(false);
      }}
    >
      {/* Vakken: onzichtbaar tikvlak, gemarkeerd als geselecteerd. */}
      {model.cells.map((c) => {
        const key = `cell:${c.key}`;
        const isSel = key === selected;
        return (
          <rect
            key={key}
            x={c.x}
            y={H - (c.y + c.h)}
            width={c.w}
            height={c.h}
            fill={isSel ? "#dbeafe" : "transparent"}
            stroke={isSel ? "#2563eb" : "none"}
            strokeWidth={4}
            style={{ cursor: "pointer" }}
            onPointerDown={(e) => {
              e.preventDefault();
              onSelect(isSel ? null : key);
            }}
          />
        );
      })}
      {staanders.map((s) => {
        const movable = Boolean(s.staanderKey);
        const isSel = movable && s.staanderKey === selected;
        return (
          <rect
            key={s.id}
            x={s.place.x}
            y={H - (s.place.y + s.place.h)}
            width={Math.max(s.place.w, 14)}
            height={s.place.h}
            fill={isSel ? "#2563eb" : movable ? "#a3a3a3" : "#d4d4d4"}
            style={{ cursor: movable ? (dragging ? "grabbing" : "ew-resize") : "default" }}
            onPointerDown={(e) => {
              if (!s.staanderKey) return;
              e.preventDefault();
              (e.currentTarget as SVGRectElement).setPointerCapture?.(e.pointerId);
              onSelect(s.staanderKey);
              const idx = s.staanderKey.replace("col:", "");
              drag.current = {
                key: s.staanderKey,
                kind: "col",
                startPx: e.clientX,
                startOffset: columnOffsets[idx] ?? 0,
              };
              setDragging(true);
            }}
          />
        );
      })}
      {planken.map((p) => {
        const selectable = Boolean(p.shelfKey);
        const isSel = selectable && p.shelfKey === selected;
        return (
          <rect
            key={p.id}
            x={p.place.x}
            y={H - (p.place.y + p.place.h)}
            width={p.place.w}
            height={Math.max(p.place.h, 14)}
            fill={isSel ? "#2563eb" : selectable ? "#737373" : "#a3a3a3"}
            style={{ cursor: selectable ? (dragging ? "grabbing" : "grab") : "default" }}
            onPointerDown={(e) => {
              if (!p.shelfKey) return;
              e.preventDefault();
              (e.currentTarget as SVGRectElement).setPointerCapture?.(e.pointerId);
              onSelect(p.shelfKey);
              drag.current = {
                key: p.shelfKey,
                kind: "shelf",
                startPx: e.clientY,
                startOffset: offsets[p.shelfKey] ?? 0,
              };
              setDragging(true);
            }}
          />
        );
      })}
      {schotten.map((d) => {
        const isSel = d.dividerKey === selected;
        const raw = d.dividerKey!.replace("div:", "");
        return (
          <rect
            key={d.id}
            x={d.place.x}
            y={H - (d.place.y + d.place.h)}
            width={Math.max(d.place.w, 14)}
            height={d.place.h}
            fill={isSel ? "#2563eb" : "#8b5cf6"}
            style={{ cursor: dragging ? "grabbing" : "ew-resize" }}
            onPointerDown={(e) => {
              e.preventDefault();
              (e.currentTarget as SVGRectElement).setPointerCapture?.(e.pointerId);
              onSelect(d.dividerKey!);
              drag.current = {
                key: d.dividerKey!,
                kind: "div",
                startPx: e.clientX,
                startOffset: dividerOffsets[raw] ?? 0,
              };
              setDragging(true);
            }}
          />
        );
      })}
      {model.ghostShelves.map((g) => (
        <rect
          key={g.key}
          x={g.place.x}
          y={H - (g.place.y + g.place.h)}
          width={g.place.w}
          height={Math.max(g.place.h, 14)}
          fill="none"
          stroke="#2563eb"
          strokeWidth={4}
          strokeDasharray="18 12"
          style={{ cursor: "pointer" }}
          onPointerDown={(e) => {
            e.preventDefault();
            onRestore?.(g.key);
          }}
        />
      ))}
    </svg>
  );
}
