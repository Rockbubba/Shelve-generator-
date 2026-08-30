/**
 * Onderdelenlijst (BOM): panelen gegroepeerd per identieke maat + type,
 * met plaatnummers uit de nesting, plus hardware-telling. CSV-export.
 */

import { formatMm } from "./config";
import { CabinetModel, Panel, PanelType } from "./model";
import { NestingResult } from "./nesting";

export interface BomRow {
  ids: string[];
  type: PanelType;
  material: string;
  length: number;
  width: number;
  thickness: number;
  qty: number;
  sheets: string;
}

const TYPE_LABELS: Record<PanelType, string> = {
  staander: "Staander",
  plank: "Plank",
  plint: "Plint",
  rug: "Rugpaneel (HDF)",
};

export function typeLabel(t: PanelType): string {
  return TYPE_LABELS[t];
}

export function buildBom(model: CabinetModel, nesting: NestingResult): BomRow[] {
  // Plaatnummer per onderdeel-ID.
  const sheetOf = new Map<string, string>();
  for (const sheet of nesting.sheets) {
    for (const pl of sheet.placements) {
      sheetOf.set(pl.panel.id, `P${sheet.index + 1}`);
    }
  }
  for (const sheet of nesting.hdfSheets) {
    for (const pl of sheet.placements) {
      sheetOf.set(pl.panel.id, `H${sheet.index + 1}`);
    }
  }

  const groups = new Map<string, { rowPanels: Panel[] }>();
  for (const p of model.panels) {
    const key = [p.type, p.material, p.length, p.width, p.thickness].join("|");
    const g = groups.get(key) ?? { rowPanels: [] };
    g.rowPanels.push(p);
    groups.set(key, g);
  }

  const rows: BomRow[] = [];
  for (const { rowPanels } of groups.values()) {
    const first = rowPanels[0];
    const sheets = Array.from(
      new Set(rowPanels.map((p) => sheetOf.get(p.id) ?? "—")),
    ).join(", ");
    rows.push({
      ids: rowPanels.map((p) => p.id),
      type: first.type,
      material: first.material === "hdf4" ? "HDF 4 mm" : "Plaat 18 mm",
      length: first.length,
      width: first.width,
      thickness: first.thickness,
      qty: rowPanels.length,
      sheets,
    });
  }

  const order: PanelType[] = ["staander", "plank", "plint", "rug"];
  rows.sort(
    (a, b) => order.indexOf(a.type) - order.indexOf(b.type) || b.length - a.length,
  );
  return rows;
}

export function bomToCsv(model: CabinetModel, nesting: NestingResult): string {
  const rows = buildBom(model, nesting);
  const lines: string[] = [];
  lines.push("ID's;Type;Materiaal;Lengte (mm);Breedte (mm);Dikte (mm);Aantal;Plaat");
  for (const r of rows) {
    lines.push(
      [
        r.ids.join(" "),
        typeLabel(r.type),
        r.material,
        formatMm(r.length),
        formatMm(r.width),
        formatMm(r.thickness),
        r.qty,
        r.sheets,
      ].join(";"),
    );
  }
  lines.push("");
  lines.push("Hardware;Aantal;Eenheid");
  for (const h of model.hardware) {
    lines.push([h.name, h.qty, h.unit].join(";"));
  }
  return lines.join("\r\n");
}
