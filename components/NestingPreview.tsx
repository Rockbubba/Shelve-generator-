"use client";

import { formatMm } from "@/lib/config";
import { NestedSheet, NestingResult, Placement } from "@/lib/nesting";
import { panelContour } from "@/lib/dxf";
import { Operation } from "@/lib/model";

/** Kleur per bewerkingstype, gelijk aan de DXF-laagkleuren. */
function opColor(layer: Operation["layer"]): string {
  if (layer.startsWith("DADO")) return "#dc2626";
  if (layer.startsWith("BOOR")) return "#2563eb";
  if (layer.startsWith("CABINEO")) return "#9333ea";
  if (layer.startsWith("RUG")) return "#16a34a";
  return "#666";
}

/**
 * Bewerkingen van één geplaatst onderdeel, in plaatcoördinaten en gespiegeld
 * voor SVG (y omlaag). Side-B-bewerkingen (tweede zijde) zijn gestippeld.
 */
function PlacementOps({ pl, sheetW }: { pl: Placement; sheetW: number }) {
  return (
    <>
      {pl.panel.ops.map((op, i) => {
        if (op.kind === "text") return null;
        const dash = op.side === "B" ? "14 10" : undefined;
        const color = opColor(op.layer);
        if (op.kind === "rect") {
          const yLow =
            op.side === "B" ? pl.width - op.y - op.h : op.y;
          return (
            <rect
              key={i}
              x={pl.x + op.x}
              y={sheetW - (pl.y + yLow + op.h)}
              width={op.w}
              height={op.h}
              fill={color}
              fillOpacity={0.25}
              stroke={color}
              strokeWidth={2}
              strokeDasharray={dash}
            />
          );
        }
        const cy = op.side === "B" ? pl.width - op.cy : op.cy;
        return (
          <circle
            key={i}
            cx={pl.x + op.cx}
            cy={sheetW - (pl.y + cy)}
            r={Math.max(op.diameter / 2, 9)}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeDasharray={dash}
          />
        );
      })}
    </>
  );
}

function SheetSvg({ sheet }: { sheet: NestedSheet }) {
  const { sheetLength: L, sheetWidth: W } = sheet;
  return (
    <svg
      viewBox={`-10 -10 ${L + 20} ${W + 20}`}
      className="w-full"
      role="img"
      aria-label={`Plaat ${sheet.index + 1}`}
    >
      <rect x={0} y={0} width={L} height={W} fill="#fafafa" stroke="#999" strokeWidth={4} />
      {sheet.placements.map((pl) => {
        const pts = panelContour(pl.panel)
          .map(([x, y]) => `${pl.x + x},${W - (pl.y + y)}`)
          .join(" ");
        return (
          <g key={pl.panel.id}>
            <polygon
              points={pts}
              fill={pl.panel.type === "staander" ? "#dbeafe" : pl.panel.type === "rug" ? "#fef3c7" : "#dcfce7"}
              stroke="#333"
              strokeWidth={3}
            />
            <PlacementOps pl={pl} sheetW={W} />
            <text
              x={pl.x + pl.length / 2}
              y={W - (pl.y + pl.width / 2)}
              fontSize={Math.min(60, pl.width / 2)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#333"
              opacity={0.75}
            >
              {pl.panel.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function Legend() {
  const items: [string, string][] = [
    ["#dc2626", "dado"],
    ["#2563eb", "boring"],
    ["#16a34a", "rugsponning"],
    ["#9333ea", "Cabineo"],
  ];
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
      {items.map(([color, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
          {label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1">
        <svg width="18" height="6" aria-hidden>
          <line x1="0" y1="3" x2="18" y2="3" stroke="#666" strokeWidth="2" strokeDasharray="4 3" />
        </svg>
        tweede zijde
      </span>
    </div>
  );
}

export default function NestingPreview({
  nesting,
  onDownload,
}: {
  nesting: NestingResult;
  onDownload: (material: "plaat18" | "hdf4", index: number) => void;
}) {
  const all = [
    ...nesting.sheets.map((s) => ({ sheet: s, label: `Plaat ${s.index + 1} — 18 mm` })),
    ...nesting.hdfSheets.map((s) => ({ sheet: s, label: `HDF ${s.index + 1} — 4 mm` })),
  ];
  if (all.length === 0) {
    return <p className="text-sm text-neutral-500">Geen platen te nesten.</p>;
  }
  return (
    <div className="snap-row -mx-4 flex gap-3 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
      {all.map(({ sheet, label }) => (
        <div
          key={`${sheet.material}-${sheet.index}`}
          className="snap-card w-[85vw] max-w-sm shrink-0 rounded-2xl border border-neutral-200 p-3 lg:w-full lg:max-w-none"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold">{label}</span>
            <span className="text-xs text-neutral-500">
              {formatMm(sheet.sheetLength)} × {formatMm(sheet.sheetWidth)}
            </span>
          </div>
          <SheetSvg sheet={sheet} />
          <Legend />
          <button
            type="button"
            className="btn-touch mt-2 w-full rounded-xl bg-neutral-900 px-4 py-2 text-sm font-medium text-white active:bg-neutral-700"
            onClick={() => onDownload(sheet.material, sheet.index)}
          >
            Download DXF
          </button>
        </div>
      ))}
    </div>
  );
}
