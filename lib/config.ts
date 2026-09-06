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
export const RUG_SCREWS_PER_PANEL = 8; // bij geschroefde rug

// ---- Verbindingen -----------------------------------------------------------
export const DADO_DEPTH = 7; // blinde dado diepte in staander
export const DADO_FRONT_STOP = 30; // dado stopt zoveel mm vóór de voorzijde
export const DOWEL_DIAMETER = 8;
export const DOWEL_LENGTH = 35;
// Officiële Lamello Cabineo-bewerking (maatblad "Bewerking:
// bodem/tussenplank/bovenkant"): de pocket is de vereniging van drie
// Ø15-cirkels met de harten op 3,6 / 14,8 / 26 mm vanaf de naadrand,
// 11 mm diep. Drie plaatsingsvarianten:
//  - boor15:  drie boringen Ø15 (variant 1)
//  - frees10: exacte verenigingscontour, frees Ø10 of kleiner (variant 2;
//             concave overgangen op x = 9,2 en 20,4)
//  - frees12: contour met rechte brugjes op y = ±6 tussen de cirkels
//             (variant 3; x = 8,1–10,3 en 19,3–21,5) zodat een Ø12-frees past
export type CabineoVariant = "boor15" | "frees10" | "frees12";
export const CABINEO_POCKET_DEPTH = 11;
export const CABINEO_HOLE_DIAMETER = 15;
export const CABINEO_HOLE_CENTERS = [3.6, 14.8, 26]; // vanaf de naadrand
export const CABINEO_FLAT_HALF_WIDTH = 6; // brugjes-halfbreedte bij frees12
// Zijkant (staander): boor Ø5 (HPL: Ø5,5), diepte 8 mm bij Cabineo 8
// (zwarte schroef); 12 mm bij Cabineo 12.
export const CABINEO_BOLT_DIAMETER = 5;
export const CABINEO_SIDE_HOLE_DEPTH = 8;
export const CABINEOS_PER_JOINT = 2;
/**
 * Afstand van de Cabineo's tot de voor-/achterrand, per staanderzijde
 * verschillend zodat de doorlopende boutgaten van linker- en rechtervak
 * elkaar in de staander niet raken en alles vanaf één zijde geboord wordt.
 */
export const CABINEO_EDGE_OFFSET_A = 60;
export const CABINEO_EDGE_OFFSET_B = 100;

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
 * Bevestiging van de HDF-rug: `geschroefd` = op de achterkant geschroefd
 * (geen groeven, alles éénzijdig te frezen); `sponning` = in een gefreesde
 * groef (vergt bewerkingen aan twee zijden van planken en staanders).
 */
export type RugMount = "geschroefd" | "sponning";

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
  /** Plaatsingsvariant van de Cabineo-pocket (boor Ø15 / frees Ø10 / frees Ø12). */
  cabineoVariant: CabineoVariant;
  base: BaseType;
  rugMount: RugMount;
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
  cabineoVariant: "frees10", // onze freesbaan is Ø8 → variant "Ø10 of kleiner"
  base: "plint",
  rugMount: "geschroefd",
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
