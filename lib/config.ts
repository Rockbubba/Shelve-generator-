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

// LED-verlichting: strip achter-boven in elk vak (onderzijde plank erboven).
export const LED_GROOVE_WIDTH = 17; // inbouwprofiel 17 × 7 mm
export const LED_GROOVE_DEPTH = 7;
export const LED_GROOVE_BACK_OFFSET = 28; // hart van de groef t.o.v. achterrand plank
export const LED_GROOVE_END_MARGIN = 40; // groef stopt zoveel mm vóór de plankuiteinden (vrij van Cabineo/deuvels)
export const LED_CABLE_HOLE_DIAMETER = 10; // kabeldoorvoer, doorlopend
export const LED_CABLE_BACK_OFFSET = 28; // hart doorvoer t.o.v. achterrand plank
export const LED_CABLE_SIDE_OFFSET = 45; // hart doorvoer t.o.v. staandervlak
export const LED_JUMPER_DROP = 40; // hart doorvoer door de staander, onder de bovenkant van het vak
export const LED_MIN_JUMPER_OVERLAP = 60; // minimale hoogteoverlap van twee naastliggende vakken
export const LED_WATT_PER_M = 9.6; // 24 V strip, voor de driverkeuze
export const LED_DRIVER_WATT = 150;

// Dichtvak: inliggende deur op potscharnieren (Ø35 cup), plus rugpaneel.
export const DOOR_GAP = 2; // luchtspleet rondom (mm)
export const HINGE_CUP_DIAMETER = 35;
export const HINGE_CUP_DEPTH = 13;
export const HINGE_CUP_EDGE = 22.5; // hart cup vanaf de scharnierkant van de deur (boorafstand 5 mm)
export const HINGE_END_OFFSET = 100; // hart bovenste/onderste scharnier vanaf deurrand
export const HINGE_PLATE_FRONT = 37; // rij montageplaat-boringen vanaf de deurvoorkant (systeem 32)
export const HINGE_PLATE_SCREW_SPACING = 32;
export const HINGE_PLATE_SCREW_DIAMETER = 5;
export const HINGE_PLATE_SCREW_DEPTH = 11;
export const DOOR_MAX_WIDTH = 600;

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
export const PLINTH_SETBACK = 40; // standaard: plint teruggelegd t.o.v. voorzijde
export const MAX_PLINTH_SETBACK = 150;
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
  /** Zichtbare nerf-/decorrichting: onderdelen mogen dan niet gedraaid genest worden. */
  nerf?: boolean;
}

export const SHEET_MATERIALS: SheetMaterial[] = [
  { id: "mdf", naam: "MDF", diktes: [12, 15, 18, 19, 22, 25] },
  { id: "multiplex", naam: "Multiplex berken", diktes: [12, 15, 18, 21, 24], nerf: true },
  { id: "spaanplaat", naam: "Spaanplaat (melamine)", diktes: [18, 25] },
  { id: "hpl", naam: "HPL / compact", diktes: [10, 12, 13], hpl: true },
  // Betonplex: filmbeklede multiplex (bruin/zwart), industriële look; de
  // film heeft geen nerfrichting, dus onderdelen mogen gedraaid genest worden.
  { id: "betonplex", naam: "Betonplex", diktes: [12, 15, 18, 21] },
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
 * `per-vak`: rugpanelen per vak (aan/uit door tikken); `volledig`: de hele
 * achterzijde dicht met HDF, opgedeeld in stukken die op de HDF-plaat passen
 * met de naden achter staanders (altijd geschroefd).
 */
export type RugMode = "per-vak" | "volledig";

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
  /** Profiel spiegelen over de breedte (bijv. schuin de andere kant op). */
  mirror?: boolean;
}

/**
 * Achterzijde tegen een scheve muur: de achterkant wordt links en rechts
 * met een eigen maat ingekort, met een lineair verloop ertussen.
 */
export interface BackTaper {
  left: number;
  right: number;
}

/** Bestaande plint op de muur waar de kast overheen moet vallen (0 = geen). */
export interface WallSkirting {
  height: number;
  depth: number;
}

export type LedSide = "links" | "rechts";
export interface LedConfig {
  enabled: boolean;
  /** Kant van elk vak waar de kabel omlaag loopt (doorvoer in de planken). */
  side: LedSide;
  /** Inbouw: groef 17 × 7 mm voor een aluminium profiel; anders opbouw. */
  inbouw: boolean;
}

export type FeetType = "rond" | "vierkant" | "conisch";
export interface FeetConfig {
  type: FeetType;
  /** Poothoogte (mm); de romp wordt hiermee verkort zodat de totale hoogte gelijk blijft. */
  height: number;
  /** Diameter / zijde (mm). */
  size: number;
  /** Renderkleur (hex). */
  color: string;
}

/** Renderkleuren voor de kast (hex). */
export const CABINET_COLORS: { naam: string; hex: string }[] = [
  { naam: "Wit", hex: "#ffffff" },
  { naam: "Gebroken wit", hex: "#f3efe6" },
  { naam: "Zand", hex: "#d9c8a9" },
  { naam: "Eiken", hex: "#c9a46e" },
  { naam: "Terracotta", hex: "#c8704f" },
  { naam: "Olijf", hex: "#7f8c5a" },
  { naam: "Petrol", hex: "#2f5f6f" },
  { naam: "Antraciet", hex: "#3a3a3a" },
];
/** Minimale resterende kastdiepte op het ondiepste punt van het profiel. */
export const MIN_PROFILE_DEPTH = 120;

export function frontOffset(profile: FrontProfile, x: number, width: number): number {
  let u = Math.min(1, Math.max(0, x / width));
  if (profile.mirror) u = 1 - u;
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
 * `deur` = dichtvak: inliggende deur op potscharnieren én een rugpaneel.
 * `lade` en `diagonaal` zitten al in het datamodel voor v2.
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
  /**
   * Horizontale verschuiving (mm, + = naar rechts) van binnenstaander i
   * (1..columns-1) t.o.v. het grid, key = `${i}`. Zo variëren de
   * kolombreedtes; het model begrenst op MIN_CELL_WIDTH.
   */
  columnOffsets: Record<string, number>;
  /** Rug per vak (toggle in 3D) of één volledig dichte achterwand. */
  rugMode: RugMode;
  frontProfile: FrontProfile;
  backTaper: BackTaper;
  wallSkirting: WallSkirting;
  feet: FeetConfig;
  /** Renderkleur van de kast (hex). */
  color: string;
  /** Renderkleur van de rugpanelen/achterwand (hex). */
  rugColor: string;
  /**
   * Hoeveel de plint terugligt t.o.v. het ondiepste punt van de voorkant
   * (mm). 0 = vlak (flush) met de voorkant; standaard 40.
   */
  plinthSetback: number;
  /** LED-strip achter-boven in elk vak, met kabeldoorvoer door de planken. */
  led: LedConfig;
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
  columnOffsets: {},
  rugMode: "per-vak",
  frontProfile: { type: "recht", amplitude: 60, periodes: 2, mirror: false },
  backTaper: { left: 0, right: 0 },
  wallSkirting: { height: 0, depth: 0 },
  feet: { type: "rond", height: 100, size: 40, color: "#222222" },
  color: "#ffffff",
  rugColor: "#e8e4dc",
  plinthSetback: PLINTH_SETBACK,
  led: { enabled: false, side: "links", inbouw: true },
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
