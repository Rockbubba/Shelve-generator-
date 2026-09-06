/**
 * Nesting van de onderdelen op de plaat.
 *
 * Strook-gebaseerd (guillotine-vriendelijk, dus met een gewone
 * afkortzaag of één rechte snede te volgen), maar slimmer dan één vaste
 * strookhoogte:
 *
 * 1. Onderdelen worden gesorteerd op breedte (aflopend) en daarna lengte.
 * 2. Elke strook krijgt de hoogte van het eerste (breedste) onderdeel erin;
 *    smallere onderdelen (plint, bovenstukken van een verloop) krijgen dus
 *    een lage strook in plaats van een volle strook op kastdiepte.
 * 3. Binnen een strook worden smalle onderdelen op elkaar gestapeld
 *    (kolommen), zodat bijvoorbeeld twee rugpanelen boven elkaar in een
 *    strook op de hoogte van een samengevoegd vak passen.
 * 4. Best-fit: een onderdeel gaat naar de strook waar het het krapst past
 *    (kleinste restlengte na plaatsing), zodat lange rests bewaard blijven
 *    voor lange onderdelen.
 * 5. Restbreedte onderaan een plaat (bij vrije dieptes) wordt gebruikt voor
 *    smallere onderdelen in plaats van een nieuwe plaat te beginnen.
 *
 * 6. Draaien (90°): HDF-rugpanelen altijd (geen nerf, geen bewerkingen);
 *    18mm-onderdelen alleen bij nerfloze materialen (MDF, spaanplaat, HPL).
 *    De DXF en de preview draaien contour en bewerkingen mee.
 */

import {
  HDF_SHEET_LENGTH,
  HDF_SHEET_WIDTH,
  KERF,
  SHEET_LENGTH,
  SHEET_MARGIN,
  SHEET_WIDTH,
} from "./config";
import { Material, Panel } from "./model";

export interface Placement {
  panel: Panel;
  /** Positie van de linkeronderhoek van het onderdeel op de plaat (mm). */
  x: number;
  y: number;
  /** Voetafdruk op de plaat: length langs x, width langs y. */
  length: number;
  width: number;
  /** 90° gedraaid: de lengte van het onderdeel loopt langs de plaat-y. */
  rotated: boolean;
}

export interface NestedSheet {
  index: number;
  material: Material;
  sheetLength: number;
  sheetWidth: number;
  placements: Placement[];
  /** Stroken op deze plaat (y-onderkant en hoogte), voor de preview. */
  strips: { y: number; height: number; usedLength: number }[];
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

/** Een kolom in een strook: onderdelen boven elkaar met gelijke x. */
interface Column {
  x: number;
  length: number;
  /** Bovenkant van het hoogste onderdeel in deze kolom. */
  top: number;
}

interface Strip {
  sheet: SheetState;
  y: number;
  height: number;
  cursorX: number;
  columns: Column[];
  placements: Placement[];
}

interface SheetState {
  index: number;
  /** Eerste vrije y boven de laatste strook (zonder freesbaan). */
  nextY: number;
  strips: Strip[];
}

const EPS = 0.01;

interface Orientation {
  /** Voetafdruk langs x. */
  l: number;
  /** Voetafdruk langs y (strookhoogte die nodig is). */
  w: number;
  rotated: boolean;
}

function nestMaterial(
  panels: Panel[],
  material: Material,
  sheetLength: number,
  sheetWidth: number,
  allowRotation: boolean,
  errors: string[],
): NestedSheet[] {
  const usableLength = sheetLength - 2 * SHEET_MARGIN;
  const usableWidth = sheetWidth - 2 * SHEET_MARGIN;
  const maxX = SHEET_MARGIN + usableLength;
  const maxY = SHEET_MARGIN + usableWidth;

  // Breedste onderdelen eerst, daarbinnen de langste.
  const sorted = [...panels].sort(
    (a, b) => b.width - a.width || b.length - a.length || a.id.localeCompare(b.id),
  );

  const sheets: SheetState[] = [];

  const newStrip = (sheet: SheetState, height: number): Strip => {
    const y = sheet.strips.length === 0 ? SHEET_MARGIN : sheet.nextY + KERF;
    const strip: Strip = { sheet, y, height, cursorX: SHEET_MARGIN, columns: [], placements: [] };
    sheet.strips.push(strip);
    sheet.nextY = y + height;
    return strip;
  };

  const stripFits = (sheet: SheetState, height: number) => {
    const y = sheet.strips.length === 0 ? SHEET_MARGIN : sheet.nextY + KERF;
    return y + height <= maxY + EPS;
  };

  const placeAtEnd = (strip: Strip, panel: Panel, o: Orientation) => {
    const x = strip.cursorX + (strip.placements.length > 0 ? KERF : 0);
    strip.placements.push({ panel, x, y: strip.y, length: o.l, width: o.w, rotated: o.rotated });
    strip.columns.push({ x, length: o.l, top: strip.y + o.w });
    strip.cursorX = x + o.l;
  };

  for (const panel of sorted) {
    // Mogelijke oriëntaties: plat (lengte langs x) en, indien toegestaan, gedraaid.
    const orientations: Orientation[] = [{ l: panel.length, w: panel.width, rotated: false }];
    if (allowRotation && Math.abs(panel.length - panel.width) > EPS) {
      orientations.push({ l: panel.width, w: panel.length, rotated: true });
    }
    const fitting = orientations.filter(
      (o) => o.l <= usableLength + EPS && o.w <= usableWidth + EPS,
    );
    if (fitting.length === 0) {
      errors.push(
        `Onderdeel ${panel.id} (${panel.length} × ${panel.width} mm) past niet op de plaat (${usableLength} × ${usableWidth} mm).`,
      );
      continue;
    }

    // 1. Stapelen op een bestaande kolom (vult anders verloren ruimte).
    let bestCol: { strip: Strip; col: Column; o: Orientation; waste: number } | null = null;
    for (const sheet of sheets) {
      for (const strip of sheet.strips) {
        for (const col of strip.columns) {
          for (const o of fitting) {
            if (o.l > col.length + EPS) continue;
            if (col.top + KERF + o.w > strip.y + strip.height + EPS) continue;
            const waste = (col.length - o.l) * o.w;
            if (!bestCol || waste < bestCol.waste) bestCol = { strip, col, o, waste };
          }
        }
      }
    }
    if (bestCol) {
      const { strip, col, o } = bestCol;
      const y = col.top + KERF;
      strip.placements.push({ panel, x: col.x, y, length: o.l, width: o.w, rotated: o.rotated });
      col.top = y + o.w;
      col.length = o.l; // volgende laag mag niet langer zijn dan deze
      continue;
    }

    // 2. Best-fit achteraan een bestaande strook: eerst zo weinig mogelijk
    //    verloren hoogte boven het onderdeel, dan de krapste restlengte.
    let bestStrip: { strip: Strip; o: Orientation; waste: number; rest: number } | null = null;
    for (const sheet of sheets) {
      for (const strip of sheet.strips) {
        for (const o of fitting) {
          if (o.w > strip.height + EPS) continue;
          const needed = (strip.placements.length > 0 ? KERF : 0) + o.l;
          const rest = maxX - (strip.cursorX + needed);
          if (rest < -EPS) continue;
          const waste = (strip.height - o.w) * o.l;
          if (
            !bestStrip ||
            waste < bestStrip.waste - EPS ||
            (Math.abs(waste - bestStrip.waste) <= EPS && rest < bestStrip.rest - EPS)
          ) {
            bestStrip = { strip, o, waste, rest };
          }
        }
      }
    }
    if (bestStrip) {
      placeAtEnd(bestStrip.strip, panel, bestStrip.o);
      continue;
    }

    // 3. Nieuwe strook (plat: laagste strookhoogte) op een bestaande plaat
    //    met genoeg restbreedte, anders 4. een nieuwe plaat.
    const flat = [...fitting].sort((a, b) => a.w - b.w)[0];
    let target: SheetState | null = null;
    for (const sheet of sheets) {
      if (stripFits(sheet, flat.w)) {
        target = sheet;
        break;
      }
    }
    if (!target) {
      target = { index: sheets.length, nextY: SHEET_MARGIN, strips: [] };
      sheets.push(target);
    }
    placeAtEnd(newStrip(target, flat.w), panel, flat);
  }

  return sheets.map((s) => ({
    index: s.index,
    material,
    sheetLength,
    sheetWidth,
    placements: s.strips.flatMap((st) => st.placements),
    strips: s.strips.map((st) => ({
      y: st.y,
      height: st.height,
      usedLength: st.cursorX - SHEET_MARGIN,
    })),
  }));
}

/**
 * Benut deel van een plaat: per strook de hoogte × de gebruikte lengte,
 * gedeeld door het bruikbare plaatoppervlak. Het restant van de plaat
 * (boven de laatste strook en achter de laatste onderdelen) blijft over
 * als bruikbare reststrook.
 */
function usedFraction(sheet: NestedSheet): number {
  const usable =
    (sheet.sheetLength - 2 * SHEET_MARGIN) * (sheet.sheetWidth - 2 * SHEET_MARGIN);
  const used = sheet.strips.reduce((sum, st) => sum + (st.height + KERF) * st.usedLength, 0);
  return Math.min(1, used / usable);
}

export interface NestingOptions {
  /** 18mm-onderdelen mogen 90° gedraaid worden (nerfloos materiaal). */
  allowRotation?: boolean;
}

export function nestPanels(panels: Panel[], options: NestingOptions = {}): NestingResult {
  const errors: string[] = [];

  const sheet18 = panels.filter((p) => p.material === "plaat18");
  const hdf = panels.filter((p) => p.material === "hdf4");

  const sheets = nestMaterial(
    sheet18,
    "plaat18",
    SHEET_LENGTH,
    SHEET_WIDTH,
    options.allowRotation ?? false,
    errors,
  );
  // HDF-rugpanelen: geen nerf en geen bewerkingen, dus altijd draaibaar.
  const hdfSheets =
    hdf.length > 0
      ? nestMaterial(hdf, "hdf4", HDF_SHEET_LENGTH, HDF_SHEET_WIDTH, true, errors)
      : [];

  // Yield en platenbreuk voor de 18mm-plaat.
  const partArea = sheet18.reduce((sum, p) => sum + p.length * p.width, 0);
  const grossSheetArea = SHEET_LENGTH * SHEET_WIDTH;

  let sheetCountFraction = 0;
  if (sheets.length > 0) {
    const last = sheets[sheets.length - 1];
    sheetCountFraction = sheets.length - 1 + Math.max(0.05, usedFraction(last));
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
