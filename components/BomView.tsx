"use client";

import { buildBom, typeLabel } from "@/lib/bom";
import { formatMm } from "@/lib/config";
import { CabinetModel } from "@/lib/model";
import { NestingResult } from "@/lib/nesting";

export default function BomView({
  model,
  nesting,
}: {
  model: CabinetModel;
  nesting: NestingResult;
}) {
  const rows = buildBom(model, nesting);
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-neutral-200">
        <table className="w-full text-left text-sm">
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-500">
            <tr>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Maat (mm)</th>
              <th className="px-3 py-2 text-right">Aantal</th>
              <th className="px-3 py-2">Plaat</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.ids[0]} className="border-t border-neutral-100">
                <td className="px-3 py-2">
                  <span className="font-medium">{typeLabel(r.type)}</span>
                  <span className="block text-xs text-neutral-400">
                    {r.ids.join(", ")}
                  </span>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {formatMm(r.length)} × {formatMm(r.width)} × {formatMm(r.thickness)}
                </td>
                <td className="px-3 py-2 text-right">{r.qty}</td>
                <td className="px-3 py-2">{r.sheets}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold">Hardware</h3>
        <ul className="space-y-1 text-sm">
          {model.hardware.map((h) => (
            <li key={h.name} className="flex justify-between border-b border-neutral-100 py-1">
              <span>{h.name}</span>
              <span className="text-neutral-500">
                {h.qty} {h.unit}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
