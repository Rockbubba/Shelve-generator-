/**
 * Machinetijd- en kostencalculatie: rekent freespadlengtes, dieptes en
 * boringen door naar minuten op de machine en euro's. De machineparameters
 * zijn bewuste schattingen — pas ze aan op jouw machine en uurtarief.
 */

import { formatMm, materialById } from "./config";
import { panelContour } from "./dxf";
import { CabinetModel } from "./model";
import { NestingResult } from "./nesting";

export interface MachineParams {
  /** Voedingssnelheid frezen (mm/min). */
  feed: number;
  /** Maximale snededieptes per pass (mm). */
  depthPerPass: number;
  /** Freesdiameter voor pocket-uitruimen (mm). */
  toolDiameter: number;
  /** Overlap tussen banen bij uitruimen (fractie van de freesdiameter). */
  stepover: number;
  /** Seconden per boring (positioneren + boren), plus per mm diepte. */
  drillSeconds: number;
  drillSecondsPerMm: number;
  /** Insteltijd per plaat (opspannen, nulpunt) in minuten. */
  sheetSetupMinutes: number;
  /** Machinetarief in EUR per uur. */
  rateEurPerHour: number;
}

export const MACHINE: MachineParams = {
  feed: 3500,
  depthPerPass: 6,
  toolDiameter: 8,
  stepover: 0.45,
  drillSeconds: 4,
  drillSecondsPerMm: 0.15,
  sheetSetupMinutes: 5,
  rateEurPerHour: 75,
};

export interface CostEstimate {
  /** Totale freespadlengte (contouren), meters. */
  contourMeters: number;
  /** Totale uitruimlengte (pockets, groeven, gravure), meters. */
  pocketMeters: number;
  drillCount: number;
  minutes: number;
  machineCost: number;
  /** Materiaalkosten; undefined zolang er geen prijs is ingevuld. */
  materialCost?: number;
  sheetCount: number;
  totalCost?: number;
}

function polygonArea(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function polygonPerimeter(points: [number, number][]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += Math.hypot(x2 - x1, y2 - y1);
  }
  return sum;
}

/** Uitruimlengte voor een pocket: oppervlak / effectieve baanbreedte, per pass. */
function clearingLength(area: number, depth: number, m: MachineParams): number {
  const passes = Math.max(1, Math.ceil(depth / m.depthPerPass));
  return (area / (m.toolDiameter * m.stepover)) * passes;
}

export function estimateMachining(
  model: CabinetModel,
  nesting: NestingResult,
  m: MachineParams = MACHINE,
  pricePerSheet?: number,
): CostEstimate {
  let contourMm = 0;
  let pocketMm = 0;
  let drillCount = 0;
  let drillSeconds = 0;

  for (const p of model.panels) {
    // Contour: omtrek × passes over de plaatdikte (+1 mm doorfrezen).
    const passes = Math.max(1, Math.ceil((p.thickness + 1) / m.depthPerPass));
    contourMm += polygonPerimeter(panelContour(p)) * passes;

    for (const op of p.ops) {
      if (op.kind === "circle") {
        drillCount++;
        drillSeconds += m.drillSeconds + m.drillSecondsPerMm * op.depth;
      } else if (op.kind === "rect") {
        // Smalle groef (breedte ≤ frees): enkele baan; anders uitruimen.
        const narrow = Math.min(op.w, op.h) <= m.toolDiameter;
        const opPasses = Math.max(1, Math.ceil(op.depth / m.depthPerPass));
        pocketMm += narrow
          ? Math.max(op.w, op.h) * opPasses
          : clearingLength(op.w * op.h, op.depth, m);
      } else if (op.kind === "path") {
        pocketMm += clearingLength(polygonArea(op.points), op.depth, m);
      } else {
        // Gravure: benadering van de schrijflengte per teken.
        pocketMm += op.text.length * op.height * 2.2;
      }
    }
  }

  const sheetCount = nesting.sheets.length + nesting.hdfSheets.length;
  const cutMinutes = (contourMm + pocketMm) / m.feed;
  const minutes =
    cutMinutes + drillSeconds / 60 + sheetCount * m.sheetSetupMinutes;
  const machineCost = (minutes / 60) * m.rateEurPerHour;

  const materialCost =
    pricePerSheet !== undefined
      ? nesting.sheets.length * pricePerSheet
      : undefined;

  return {
    contourMeters: Math.round(contourMm / 100) / 10,
    pocketMeters: Math.round(pocketMm / 100) / 10,
    drillCount,
    minutes: Math.round(minutes * 10) / 10,
    machineCost: Math.round(machineCost * 100) / 100,
    materialCost,
    sheetCount,
    totalCost:
      materialCost !== undefined
        ? Math.round((machineCost + materialCost) * 100) / 100
        : undefined,
  };
}

export function formatEur(v: number): string {
  return `€ ${v.toFixed(2).replace(".", ",")}`;
}

/**
 * Samenvatting voor de klant: tijd en prijzen, zonder interne
 * machineparameters zoals het uurtarief (die leven in het admin-menu).
 */
export function costSummaryLines(model: CabinetModel, est: CostEstimate): string[] {
  const mat = materialById(model.config.materialId);
  const lines = [
    `Machinetijd: ± ${formatMm(est.minutes)} min (${est.drillCount} boringen, ${formatMm(
      est.contourMeters + est.pocketMeters,
    )} m freespad)`,
    `Bewerkingskosten: ${formatEur(est.machineCost)}`,
  ];
  lines.push(
    est.materialCost !== undefined
      ? `Materiaal (${mat.naam} ${model.config.nominalThickness} mm): ${formatEur(est.materialCost)}`
      : `Materiaal (${mat.naam} ${model.config.nominalThickness} mm): prijs op aanvraag`,
  );
  if (est.totalCost !== undefined) lines.push(`Totaal: ${formatEur(est.totalCost)}`);
  return lines;
}
