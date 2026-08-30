"use client";

import { formatMm } from "@/lib/config";
import { NestedSheet, NestingResult } from "@/lib/nesting";
import { panelContour } from "@/lib/dxf";

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
            <text
              x={pl.x + pl.length / 2}
              y={W - (pl.y + pl.width / 2)}
              fontSize={Math.min(60, pl.width / 2)}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#333"
            >
              {pl.panel.id}
            </text>
          </g>
        );
      })}
    </svg>
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
