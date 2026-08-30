/**
 * Strip-nesting: de plaat wordt opgedeeld in stroken op kastdiepte,
 * onderdelen worden first-fit-decreasing over de stroken verdeeld
 * (staanders — de langste onderdelen — eerst, planken op restlengtes).
 */

import {
  HDF_SHEET_LENGTH,
  HDF_SHEET_WIDTH,
  KERF,
  SHEET_LENGTH,
  SHEET_MARGIN,
  SHEET_WIDTH,
  USABLE_LENGTH,
  USABLE_WIDTH,
  stripsPerSheetForDepth,
} from "./config";
import { Material, Panel } from "./model";

export interface Placement {
  panel: Panel;
  /** Positie van de linkeronderhoek van het onderdeel op de plaat (mm). */
  x: number;
  y: number;
  /** Afmeting op de plaat: length langs x, width langs y. */
  length: number;
  width: number;
}

export interface NestedSheet {
  index: number;
  material: Material;
  sheetLength: number;
  sheetWidth: number;
  placements: Placement[];
}

export interface NestingResult {
  sheets: NestedSheet[];
  hdfSheets: NestedSheet[];
  /** Aantal 18mm-platen als breukgetal (benut deel van de laatste plaat telt mee). */
  sheetCountFraction: number;
  /** Netto onderdeeloppervlak / bruto plaatoppervlak van de gebruikte 18mm-platen. */
  yieldPercent: number;
  errors: string[];
}

interface Strip {
  sheet: number;
  y: number;
  height: number;
  cursorX: number;
  placements: Placement[];
}

function nestMaterial(
  panels: Panel[],
  material: Material,
  sheetLength: number,
  sheetWidth: number,
  stripHeight: number,
  errors: string[],
): NestedSheet[] {
  const usableLength = sheetLength - 2 * SHEET_MARGIN;
  const usableWidth = sheetWidth - 2 * SHEET_MARGIN;
  const stripsPerSheet = Math.max(
    1,
    Math.floor((usableWidth + KERF) / (stripHeight + KERF)),
  );

  // Langste onderdelen eerst (staanders), dan planken op restlengtes.
  const sorted = [...panels].sort((a, b) => b.length - a.length);

  const strips: Strip[] = [];
  let sheetCount = 0;

  const newStrip = (): Strip | null => {
    const stripIndex = strips.length % stripsPerSheet;
    if (stripIndex === 0) sheetCount++;
    const strip: Strip = {
      sheet: sheetCount - 1,
      y: SHEET_MARGIN + stripIndex * (stripHeight + KERF),
      height: stripHeight,
      cursorX: SHEET_MARGIN,
      placements: [],
    };
    strips.push(strip);
    return strip;
  };

  for (const panel of sorted) {
    if (panel.length > usableLength) {
      errors.push(
        `Onderdeel ${panel.id} (${panel.length} mm) past niet op de plaat (max ${usableLength} mm).`,
      );
      continue;
    }
    if (panel.width > stripHeight + 0.01) {
      errors.push(
        `Onderdeel ${panel.id} is breder (${panel.width} mm) dan de strookhoogte ${stripHeight} mm.`,
      );
      continue;
    }

    // First fit: eerste strook met genoeg restlengte.
    let target: Strip | null = null;
    for (const strip of strips) {
      const needed =
        (strip.placements.length > 0 ? KERF : 0) + panel.length;
      if (strip.cursorX + needed <= SHEET_MARGIN + usableLength + 0.01) {
        target = strip;
        break;
      }
    }
    if (!target) target = newStrip();
    if (!target) continue;

    if (target.placements.length > 0) target.cursorX += KERF;
    target.placements.push({
      panel,
      x: target.cursorX,
      y: target.y,
      length: panel.length,
      width: panel.width,
    });
    target.cursorX += panel.length;
  }

  const sheets: NestedSheet[] = [];
  for (let s = 0; s < sheetCount; s++) {
    sheets.push({
      index: s,
      material,
      sheetLength,
      sheetWidth,
      placements: strips
        .filter((st) => st.sheet === s)
        .flatMap((st) => st.placements),
    });
  }
  return sheets;
}

export function nestPanels(panels: Panel[], depth: number): NestingResult {
  const errors: string[] = [];

  const sheet18 = panels.filter((p) => p.material === "plaat18");
  const hdf = panels.filter((p) => p.material === "hdf4");

  const sheets = nestMaterial(
    sheet18,
    "plaat18",
    SHEET_LENGTH,
    SHEET_WIDTH,
    depth,
    errors,
  );

  // HDF apart nesten; rugpanelen zijn per rij even hoog, strook = grootste breedte.
  const hdfStrip = hdf.reduce((mx, p) => Math.max(mx, p.width), 0);
  const hdfSheets =
    hdf.length > 0
      ? nestMaterial(hdf, "hdf4", HDF_SHEET_LENGTH, HDF_SHEET_WIDTH, hdfStrip, errors)
      : [];

  // Yield en platenbreuk voor de 18mm-plaat.
  const partArea = sheet18.reduce((sum, p) => sum + p.length * p.width, 0);
  const grossSheetArea = SHEET_LENGTH * SHEET_WIDTH;

  let sheetCountFraction = 0;
  if (sheets.length > 0) {
    const last = sheets[sheets.length - 1];
    const stripsPerSheet = stripsPerSheetForDepth(depth);
    const usedStrips = new Set(last.placements.map((pl) => pl.y)).size;
    const lastMaxX = last.placements.reduce(
      (mx, pl) => Math.max(mx, pl.x + pl.length),
      SHEET_MARGIN,
    );
    const lastFraction =
      ((usedStrips - 1) + (lastMaxX - SHEET_MARGIN) / USABLE_LENGTH) /
      stripsPerSheet;
    sheetCountFraction =
      sheets.length - 1 + Math.min(1, Math.max(lastFraction, 0.05));
  }

  const yieldPercent =
    sheets.length > 0 ? (partArea / (sheets.length * grossSheetArea)) * 100 : 0;

  return {
    sheets,
    hdfSheets,
    sheetCountFraction: Math.round(sheetCountFraction * 10) / 10,
    yieldPercent: Math.round(yieldPercent),
    errors,
  };
}
