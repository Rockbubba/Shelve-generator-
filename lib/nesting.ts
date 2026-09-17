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
 * 7. Plaatvoorraad: eindige voorraad (restplaten, ingekochte platen met een
 *    aantal) wordt eerst gebruikt, daarna de onbeperkte standaardplaat.
 *    Elke plaat heeft zijn eigen maat; een onderdeel dat niet op een
 *    restplaat past gaat door naar de volgende maat.
 */

import {
  DEFAULT_SHEET_STOCK,
  HDF_SHEET_LENGTH,
  HDF_SHEET_WIDTH,
  KERF,
  SHEET_LENGTH,
  SHEET_MARGIN,
  SHEET_WIDTH,
  SheetStock,
  StockSheet,
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
  /** Naam van de voorraadregel (restplaat / extra), leeg voor de standaardplaat. */
  stockName?: string;
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
  length: number;
  width: number;
  /** Grenzen van het bruikbare vlak (na de plaatrand). */
  usableLength: number;
  usableWidth: number;
  maxX: number;
  maxY: number;
  /** Naam van de voorraadregel (restplaat), leeg voor de standaardplaat. */
  name?: string;
  /** Eerste vrije y boven de laatste strook (zonder freesbaan). */
  nextY: number;
  strips: Strip[];
}

/** Beschikbare plaatmaat in de nesting; `qty` Infinity = onbeperkt. */
export interface SupplyEntry {
  length: number;
  width: number;
  qty: number;
  name?: string;
}

const EPS = 0.01;

interface Orientation {
  /** Voetafdruk langs x. */
  l: number;
  /** Voetafdruk langs y (strookhoogte die nodig is). */
  w: number;
  rotated: boolean;
}

function orientationsFor(panel: Panel, allowRotation: boolean): Orientation[] {
  const list: Orientation[] = [{ l: panel.length, w: panel.width, rotated: false }];
  if (allowRotation && Math.abs(panel.length - panel.width) > EPS) {
    list.push({ l: panel.width, w: panel.length, rotated: true });
  }
  return list;
}

function fitsSheet(o: Orientation, usableLength: number, usableWidth: number): boolean {
  return o.l <= usableLength + EPS && o.w <= usableWidth + EPS;
}

/**
 * Nest onderdelen op platen uit `supply` (in volgorde; per nieuwe plaat de
 * eerste maat waarop het onderdeel past, zolang er aantal over is).
 * Onderdelen die op geen enkele (resterende) plaat passen komen terug in
 * `unplaced`.
 */
function nestMaterial(
  panels: Panel[],
  material: Material,
  supply: SupplyEntry[],
  allowRotation: boolean,
  firstIndex: number,
): { sheets: NestedSheet[]; unplaced: Panel[] } {
  const remaining = supply.map((e) => ({ ...e }));

  // Breedste onderdelen eerst, daarbinnen de langste.
  const sorted = [...panels].sort(
    (a, b) => b.width - a.width || b.length - a.length || a.id.localeCompare(b.id),
  );

  const sheets: SheetState[] = [];
  const unplaced: Panel[] = [];

  const newStrip = (sheet: SheetState, height: number): Strip => {
    const y = sheet.strips.length === 0 ? SHEET_MARGIN : sheet.nextY + KERF;
    const strip: Strip = { sheet, y, height, cursorX: SHEET_MARGIN, columns: [], placements: [] };
    sheet.strips.push(strip);
    sheet.nextY = y + height;
    return strip;
  };

  const stripFits = (sheet: SheetState, height: number) => {
    const y = sheet.strips.length === 0 ? SHEET_MARGIN : sheet.nextY + KERF;
    return y + height <= sheet.maxY + EPS;
  };

  const placeAtEnd = (strip: Strip, panel: Panel, o: Orientation) => {
    const x = strip.cursorX + (strip.placements.length > 0 ? KERF : 0);
    strip.placements.push({ panel, x, y: strip.y, length: o.l, width: o.w, rotated: o.rotated });
    strip.columns.push({ x, length: o.l, top: strip.y + o.w });
    strip.cursorX = x + o.l;
  };

  const openSheet = (entry: SupplyEntry): SheetState => {
    const usableLength = entry.length - 2 * SHEET_MARGIN;
    const usableWidth = entry.width - 2 * SHEET_MARGIN;
    const sheet: SheetState = {
      index: firstIndex + sheets.length,
      length: entry.length,
      width: entry.width,
      usableLength,
      usableWidth,
      maxX: SHEET_MARGIN + usableLength,
      maxY: SHEET_MARGIN + usableWidth,
      name: entry.name,
      nextY: SHEET_MARGIN,
      strips: [],
    };
    sheets.push(sheet);
    entry.qty -= 1;
    return sheet;
  };

  for (const panel of sorted) {
    const orientations = orientationsFor(panel, allowRotation);

    // 1. Stapelen op een bestaande kolom (vult anders verloren ruimte).
    let bestCol: { strip: Strip; col: Column; o: Orientation; waste: number } | null = null;
    for (const sheet of sheets) {
      for (const strip of sheet.strips) {
        for (const col of strip.columns) {
          for (const o of orientations) {
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
        for (const o of orientations) {
          if (o.w > strip.height + EPS) continue;
          const needed = (strip.placements.length > 0 ? KERF : 0) + o.l;
          const rest = sheet.maxX - (strip.cursorX + needed);
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
    //    met genoeg restbreedte.
    let placed = false;
    for (const sheet of sheets) {
      const fitting = orientations
        .filter((o) => fitsSheet(o, sheet.usableLength, sheet.usableWidth))
        .sort((a, b) => a.w - b.w);
      const flat = fitting.find((o) => stripFits(sheet, o.w));
      if (flat) {
        placeAtEnd(newStrip(sheet, flat.w), panel, flat);
        placed = true;
        break;
      }
    }
    if (placed) continue;

    // 4. Nieuwe plaat: de eerste voorraadmaat (in volgorde) met aantal over
    //    waarop het onderdeel past.
    const entry = remaining.find(
      (e) =>
        e.qty >= 1 &&
        orientations.some((o) => fitsSheet(o, e.length - 2 * SHEET_MARGIN, e.width - 2 * SHEET_MARGIN)),
    );
    if (!entry) {
      unplaced.push(panel);
      continue;
    }
    const sheet = openSheet(entry);
    const flat = orientations
      .filter((o) => fitsSheet(o, sheet.usableLength, sheet.usableWidth))
      .sort((a, b) => a.w - b.w)[0];
    placeAtEnd(newStrip(sheet, flat.w), panel, flat);
  }

  return {
    sheets: sheets.map((s) => ({
      index: s.index,
      material,
      sheetLength: s.length,
      sheetWidth: s.width,
      stockName: s.name,
      placements: s.strips.flatMap((st) => st.placements),
      strips: s.strips.map((st) => ({
        y: st.y,
        height: st.height,
        usedLength: st.cursorX - SHEET_MARGIN,
      })),
    })),
    unplaced,
  };
}

/**
 * Nest één materiaal op de voorraad: eerst de eindige voorraad (restplaten,
 * ingekochte platen), dan de onbeperkte standaardplaat. Is er geen
 * onbeperkte maat en raakt de voorraad op, dan komen de resterende
 * onderdelen op extra platen van de standaardmaat, met een melding.
 */
function nestWithStock(
  panels: Panel[],
  material: Material,
  stock: StockSheet[],
  fallback: { length: number; width: number },
  allowRotation: boolean,
  errors: string[],
): NestedSheet[] {
  const finite: SupplyEntry[] = stock
    .filter((e) => e.qty !== null)
    .map((e) => ({ length: e.length, width: e.width, qty: e.qty as number, name: e.naam ?? "voorraad" }));
  const unlimited: SupplyEntry[] = stock
    .filter((e) => e.qty === null)
    .map((e) => ({ length: e.length, width: e.width, qty: Infinity, name: e.naam }));

  const sheets: NestedSheet[] = [];
  let rest = panels;
  if (finite.length > 0 && rest.length > 0) {
    const r = nestMaterial(rest, material, finite, allowRotation, sheets.length);
    sheets.push(...r.sheets);
    rest = r.unplaced;
  }
  if (unlimited.length > 0 && rest.length > 0) {
    const r = nestMaterial(rest, material, unlimited, allowRotation, sheets.length);
    sheets.push(...r.sheets);
    rest = r.unplaced;
  }
  if (rest.length > 0) {
    // Voorraad op (of geen onbeperkte maat): bijbestellen op standaardmaat.
    const r = nestMaterial(
      rest,
      material,
      [{ ...fallback, qty: Infinity, name: "extra (niet in voorraad)" }],
      allowRotation,
      sheets.length,
    );
    if (r.sheets.length > 0 && unlimited.length === 0) {
      errors.push(
        `${material === "hdf4" ? "HDF" : "Plaat"}: voorraad is op; ${r.sheets.length} extra ${
          r.sheets.length === 1 ? "plaat" : "platen"
        } van ${fallback.length} × ${fallback.width} mm nodig.`,
      );
    }
    sheets.push(...r.sheets);
    for (const p of r.unplaced) {
      const maxL = Math.max(fallback.length, ...stock.map((e) => e.length)) - 2 * SHEET_MARGIN;
      const maxW = Math.max(fallback.width, ...stock.map((e) => e.width)) - 2 * SHEET_MARGIN;
      errors.push(
        `Onderdeel ${p.id} (${p.length} × ${p.width} mm) past op geen enkele plaat (max. ${maxL} × ${maxW} mm bruikbaar).`,
      );
    }
  }
  return sheets;
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
  /** Plaatvoorraad; standaard één onbeperkte plaat van 2440 × 1220 per materiaal. */
  stock?: SheetStock;
}

export function nestPanels(panels: Panel[], options: NestingOptions = {}): NestingResult {
  const errors: string[] = [];
  const stock = options.stock ?? DEFAULT_SHEET_STOCK;

  const sheet18 = panels.filter((p) => p.material === "plaat18");
  const hdf = panels.filter((p) => p.material === "hdf4");

  const sheets = nestWithStock(
    sheet18,
    "plaat18",
    stock.plaat18,
    { length: SHEET_LENGTH, width: SHEET_WIDTH },
    options.allowRotation ?? false,
    errors,
  );
  // HDF-rugpanelen: geen nerf en geen bewerkingen, dus altijd draaibaar.
  const hdfSheets =
    hdf.length > 0
      ? nestWithStock(
          hdf,
          "hdf4",
          stock.hdf4,
          { length: HDF_SHEET_LENGTH, width: HDF_SHEET_WIDTH },
          true,
          errors,
        )
      : [];

  // Yield en platenbreuk voor de 18mm-plaat (bruto-oppervlak van de
  // werkelijk gebruikte platen, dus ook restplaten).
  const partArea = sheet18.reduce((sum, p) => sum + p.length * p.width, 0);
  const grossSheetArea = sheets.reduce((sum, s) => sum + s.sheetLength * s.sheetWidth, 0);

  let sheetCountFraction = 0;
  if (sheets.length > 0) {
    const last = sheets[sheets.length - 1];
    sheetCountFraction = sheets.length - 1 + Math.max(0.05, usedFraction(last));
  }

  const yieldPercent = grossSheetArea > 0 ? (partArea / grossSheetArea) * 100 : 0;

  return {
    sheets,
    hdfSheets,
    sheetCountFraction: Math.round(sheetCountFraction * 10) / 10,
    yieldPercent: Math.round(yieldPercent),
    errors,
  };
}
