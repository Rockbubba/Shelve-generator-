/**
 * Centrale constanten en configuratietypes voor de boekenkast-configurator.
 * Alle maten in millimeters.
 */

// ---- Plaat & frees ----------------------------------------------------------
export const SHEET_LENGTH = 2440;
export const SHEET_WIDTH = 1220;
export const SHEET_THICKNESS_NOMINAL = 18;
export const KERF = 8; // freesbaan (bitdiameter)
export const SHEET_MARGIN = 10; // vrij te houden rand rondom de plaat
export const TOOL_RADIUS = KERF / 2;

export const USABLE_LENGTH = SHEET_LENGTH - 2 * SHEET_MARGIN; // 2420
export const USABLE_WIDTH = SHEET_WIDTH - 2 * SHEET_MARGIN; // 1200

// ---- HDF-rug ----------------------------------------------------------------
export const HDF_THICKNESS = 4;
export const HDF_SHEET_LENGTH = 2440;
export const HDF_SHEET_WIDTH = 1220;
export const RUG_GROOVE_WIDTH = 4; // RUG_SPONNING breedte
export const RUG_GROOVE_DEPTH = 10; // hoe diep de HDF in de groef valt
export const RUG_GROOVE_BACK_OFFSET = 12; // hart van de groef t.o.v. achterkant paneel
export const RUG_CLEARANCE = 1; // speling per zijde van het HDF-paneel

// ---- Verbindingen -----------------------------------------------------------
export const DADO_DEPTH = 7; // blinde dado diepte in staander
export const DADO_FRONT_STOP = 30; // dado stopt zoveel mm vóór de voorzijde
export const DOWEL_DIAMETER = 8;
export const DOWEL_LENGTH = 35;
export const CABINEO_POCKET_WIDTH = 30.5; // Cabineo 8 pocketmaat
export const CABINEO_POCKET_HEIGHT = 15;
export const CABINEO_POCKET_DEPTH = 12.5;
export const CABINEO_BOLT_DIAMETER = 5;
export const CABINEOS_PER_JOINT = 2;

// ---- Kast -------------------------------------------------------------------
export const MAX_MODULE_HEIGHT = 2400;
export const MAX_PART_LENGTH = USABLE_LENGTH; // 2420, geen onderdeel langer dan dit
export const PLINTH_HEIGHT = 80;
export const PLINTH_SETBACK = 40; // plint teruggelegd t.o.v. voorzijde
export const WALL_BRACKET_MANDATORY_HEIGHT = 1500;

export const MIN_WIDTH = 300;
export const MAX_WIDTH = 4000;
export const MIN_HEIGHT = 300;
export const MAX_HEIGHT = 4000;
export const MIN_CELL_WIDTH = 150;
export const MIN_CELL_HEIGHT = 120;

// Breedte-snapping: maximale stille aanpassing van de gevraagde kastbreedte.
export const WIDTH_SNAP_TOLERANCE = 12;

// ---- Types ------------------------------------------------------------------

export type Joinery = "dado" | "cabineo";
export type BaseType = "plint" | "pootjes" | "geen";

/**
 * Vulling van een vak. v1 gebruikt alleen `open` en `rug`;
 * `deur`, `lade` en `diagonaal` zitten al in het datamodel voor v2.
 */
export type CellFill = "open" | "rug" | "deur" | "lade" | "diagonaal";

export interface CabinetConfig {
  /** Kastdiepte; één van de strip-nesting dieptes. */
  depth: number;
  /** Gevraagde breedte; wordt gesnapt naar een nesting-vriendelijke maat. */
  width: number;
  /** Totale hoogte; > MAX_MODULE_HEIGHT wordt opgedeeld in gestapelde modules. */
  height: number;
  columns: number;
  rows: number;
  joinery: Joinery;
  base: BaseType;
  /** Gemeten plaatdikte (nominaal 18, bv. 17.8 gemeten). */
  thickness: number;
  /**
   * Vulling per vak, key = `${module}:${col}:${row}` (row 0 = onderste rij).
   * Ontbrekende vakken volgen het automatische rug-voorstel.
   */
  cellFills: Record<string, CellFill>;
  /** Muurbevestiging (2 L-beugels) opnemen. */
  wallMount: boolean;
}

export const DEFAULT_CONFIG: CabinetConfig = {
  depth: depthOption(3),
  width: 1800,
  height: 2000,
  columns: 4,
  rows: 5,
  joinery: "dado",
  base: "plint",
  thickness: 18,
  cellFills: {},
  wallMount: true,
};

// ---- Diepte-opties (strip-nesting) ------------------------------------------

/**
 * Diepte waarbij `n` stroken plus tussenliggende freesbanen de bruikbare
 * plaatbreedte (1200 mm) exact vullen. n=2 → 596, n=3 → 394.6, n=4 → 294.
 */
export function depthOption(n: number): number {
  return Math.floor(((USABLE_WIDTH - (n - 1) * KERF) / n) * 10) / 10;
}

export interface DepthOption {
  depth: number;
  stripsPerSheet: number;
}

export const DEPTH_OPTIONS: DepthOption[] = [2, 3, 4].map((n) => ({
  depth: depthOption(n),
  stripsPerSheet: n,
}));

export function stripsPerSheetForDepth(depth: number): number {
  const match = DEPTH_OPTIONS.find((o) => Math.abs(o.depth - depth) < 0.05);
  if (match) return match.stripsPerSheet;
  // Fallback voor vrije dieptes: zoveel stroken als er passen.
  return Math.max(1, Math.floor((USABLE_WIDTH + KERF) / (depth + KERF)));
}

export function cellKey(module: number, col: number, row: number): string {
  return `${module}:${col}:${row}`;
}

export function formatMm(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
