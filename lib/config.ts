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
// Zijkant (staander): boor Ø5 (HPL: Ø5,5), diepte = de maat van de
// Cabineo: 8 mm bij Cabineo 8 (zwarte schroef), 12 mm bij Cabineo 12
// (vernikkelde schroef, voor dikkere platen). De pocket (3 × Ø15, 11 mm)
// is voor beide maten identiek.
export type CabineoSize = 8 | 12;
export const CABINEO_BOLT_DIAMETER = 5;
export const CABINEO_BOLT_DIAMETER_HPL = 5.5;
/** Minimale plaatdikte per Cabineo-maat (Lamello: 8 vanaf 16 mm, 12 vanaf 19 mm). */
export const CABINEO_MIN_THICKNESS: Record<CabineoSize, number> = {
  8: 16,
  12: 19,
};
export const CABINEOS_PER_JOINT = 2;
/**
 * Afstand van de Cabineo's tot de voor-/achterrand, per staanderzijde
 * verschillend zodat de doorlopende boutgaten van linker- en rechtervak
 * elkaar in de staander niet raken en alles vanaf één zijde geboord wordt.
 * Bij ondiepe kasten schalen de afstanden mee zodat de vier posities
 * (a, b, D−b, D−a) verdeeld blijven.
 */
export const CABINEO_EDGE_OFFSET_A = 60;
export const CABINEO_EDGE_OFFSET_B = 100;

export function cabineoEdgeOffsets(depth: number): { a: number; b: number } {
  const a = Math.min(CABINEO_EDGE_OFFSET_A, Math.round(depth / 4));
  const b = Math.min(CABINEO_EDGE_OFFSET_B, Math.round(depth / 2 - 20));
  return { a, b };
}

// ---- Kast -------------------------------------------------------------------
export const MAX_MODULE_HEIGHT = 2400;
export const MAX_PART_LENGTH = USABLE_LENGTH; // 2420, geen onderdeel langer dan dit
export const PLINTH_HEIGHT = 80;
export const PLINTH_SETBACK = 40; // plint teruggelegd t.o.v. voorzijde
export const WALL_BRACKET_MANDATORY_HEIGHT = 1500;

export const MIN_WIDTH = 300;
export const MAX_WIDTH = 4000;
// Vrije kastdiepte: begrensd door wat er als strook op de plaat past.
export const MIN_DEPTH = 120;
export const MAX_DEPTH = depthOption(2); // 596
export const MIN_HEIGHT = 300;
export const MAX_HEIGHT = 4000;
export const MIN_CELL_WIDTH = 150;
export const MIN_CELL_HEIGHT = 120;

// Breedte-snapping: maximale stille aanpassing van de gevraagde kastbreedte.
export const WIDTH_SNAP_TOLERANCE = 12;

// ---- Plaatmaterialen --------------------------------------------------------

/**
 * Beschikbare plaatmaterialen met hun leverbare diktes. Prijzen per plaat
 * per dikte kunnen hier later worden ingevuld (EUR per plaat 2440 × 1220);
 * zodra een prijs bekend is rekent de UI de materiaalkosten live mee.
 */
export interface SheetMaterial {
  id: string;
  naam: string;
  diktes: number[];
  /** Prijs per hele plaat, per dikte (mm → EUR). Nog in te vullen. */
  prijsPerPlaat?: Partial<Record<number, number>>;
  /** HPL: Cabineo-boutgat Ø5,5 i.p.v. Ø5 (officiële Lamello-voorschrift). */
  hpl?: boolean;
}

export const SHEET_MATERIALS: SheetMaterial[] = [
  { id: "mdf", naam: "MDF", diktes: [12, 15, 18, 19, 22, 25] },
  { id: "multiplex", naam: "Multiplex berken", diktes: [12, 15, 18, 21, 24] },
  { id: "spaanplaat", naam: "Spaanplaat (melamine)", diktes: [18, 25] },
  { id: "hpl", naam: "HPL / compact", diktes: [10, 12, 13], hpl: true },
];

export function materialById(id: string): SheetMaterial {
  return SHEET_MATERIALS.find((m) => m.id === id) ?? SHEET_MATERIALS[0];
}

/** Prijs per plaat voor materiaal + dikte, of undefined zolang niet ingevuld. */
export function sheetPriceFor(
  materialId: string,
  dikte: number,
): number | undefined {
  return materialById(materialId).prijsPerPlaat?.[dikte];
}

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
 * Profiel van de voorzijde over de kastbreedte: de voorkant wijkt op
 * positie x `frontOffset(x)` mm terug t.o.v. de volle diepte. Staanders
 * krijgen de diepte op hun eigen positie, planken een gebogen voorrand.
 */
export type FrontProfileType = "recht" | "golf" | "bol" | "hol" | "schuin";
export interface FrontProfile {
  type: FrontProfileType;
  /** Maximale terugwijking van de voorkant (mm). */
  amplitude: number;
  /** Aantal golven over de breedte (alleen bij `golf`). */
  periodes: number;
}
/** Minimale resterende kastdiepte op het ondiepste punt van het profiel. */
export const MIN_PROFILE_DEPTH = 120;

export function frontOffset(profile: FrontProfile, x: number, width: number): number {
  const u = Math.min(1, Math.max(0, x / width));
  const A = profile.amplitude;
  switch (profile.type) {
    case "golf":
      return A * (0.5 - 0.5 * Math.cos(2 * Math.PI * Math.max(1, profile.periodes) * u));
    case "bol": // midden diepst, zijkanten wijken terug
      return A * (1 - Math.sin(Math.PI * u));
    case "hol": // zijkanten diepst, midden wijkt terug
      return A * Math.sin(Math.PI * u);
    case "schuin":
      return A * u;
    default:
      return 0;
  }
}

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
  /** Cabineo-maat: 8 (plaat ≥ 16 mm) of 12 (plaat ≥ 19 mm, sterkere schroef). */
  cabineoSize: CabineoSize;
  base: BaseType;
  rugMount: RugMount;
  /** Plaatmateriaal (id uit SHEET_MATERIALS). */
  materialId: string;
  /** Gekozen nominale plaatdikte (voor BOM en prijzen). */
  nominalThickness: number;
  /** Gemeten plaatdikte (nominaal 18, bv. 17.8 gemeten). */
  thickness: number;
  /**
   * Vulling per vak, key = `${module}:${col}:${row}` (row 0 = onderste rij).
   * Ontbrekende vakken volgen het automatische rug-voorstel.
   */
  cellFills: Record<string, CellFill>;
  /** Muurbevestiging (2 L-beugels) opnemen. */
  wallMount: boolean;
  /**
   * Weggelaten tussenplanken, key = `${module}:${col}:${level}` (level 1..rows-1).
   * De vakken boven en onder de weggelaten plank versmelten tot één vak.
   */
  omittedShelves: Record<string, true>;
  /**
   * Verschuiving (mm, + = omhoog) van een tussenplank t.o.v. het grid,
   * key = `${module}:${col}:${level}`. Zo krijgt elke kolom eigen
   * vakhoogtes; het model begrenst op MIN_CELL_HEIGHT.
   */
  shelfOffsets: Record<string, number>;
  frontProfile: FrontProfile;
}

export const DEFAULT_CONFIG: CabinetConfig = {
  depth: depthOption(3),
  width: 1800,
  height: 2000,
  columns: 4,
  rows: 5,
  joinery: "dado",
  cabineoVariant: "frees10", // onze freesbaan is Ø8 → variant "Ø10 of kleiner"
  cabineoSize: 8,
  base: "plint",
  rugMount: "geschroefd",
  materialId: "mdf",
  nominalThickness: 18,
  thickness: 18,
  cellFills: {},
  wallMount: true,
  omittedShelves: {},
  shelfOffsets: {},
  frontProfile: { type: "recht", amplitude: 60, periodes: 2 },
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

export function shelfKey(module: number, col: number, level: number): string {
  return `${module}:${col}:${level}`;
}

export function formatMm(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
