/**
 * Parametrisch kastmodel: zet een CabinetConfig om in een panelenlijst met
 * CNC-bewerkingen, 3D-plaatsingen, hardware en validatiewaarschuwingen.
 *
 * Coördinaten:
 * - Kast (3D): x = breedte (links→rechts), y = hoogte (vloer→top),
 *   z = diepte (0 = achterkant, D = voorzijde).
 * - Paneel (lokaal, CNC): x = langs de lengte (nesting-richting),
 *   y = langs de breedte. Voor staanders en planken loopt lokaal y van
 *   achterkant (0) naar voorzijde (D). Side "A" ligt boven op het CNC-bed;
 *   side "B"-bewerkingen worden gespiegeld over de lengteas uitgevoerd
 *   (paneel omklappen over de lange zijde).
 */

import {
  CabinetConfig,
  CellFill,
  DADO_DEPTH,
  DADO_FRONT_STOP,
  DOWEL_DIAMETER,
  CABINEO_BOLT_DIAMETER,
  CABINEO_BOLT_DIAMETER_HPL,
  cabineoEdgeOffsets,
  CABINEO_FLAT_HALF_WIDTH,
  CABINEO_HOLE_CENTERS,
  CABINEO_HOLE_DIAMETER,
  CABINEO_MIN_THICKNESS,
  CABINEO_POCKET_DEPTH,
  CABINEOS_PER_JOINT,
  CabineoVariant,
  FeetType,
  FrontProfile,
  frontOffset,
  materialById,
  MIN_PROFILE_DEPTH,
  shelfKey,
  HDF_SHEET_WIDTH,
  HDF_THICKNESS,
  KERF,
  SHEET_MARGIN,
  MAX_MODULE_HEIGHT,
  MAX_PART_LENGTH,
  MIN_CELL_HEIGHT,
  MIN_CELL_WIDTH,
  PLINTH_HEIGHT,
  PLINTH_SETBACK,
  RUG_CLEARANCE,
  RUG_GROOVE_BACK_OFFSET,
  RUG_GROOVE_DEPTH,
  RUG_GROOVE_WIDTH,
  RUG_SCREWS_PER_PANEL,
  TOOL_RADIUS,
  USABLE_LENGTH,
  WALL_BRACKET_MANDATORY_HEIGHT,
  WIDTH_SNAP_TOLERANCE,
  cellKey,
} from "./config";

// ---- Types ------------------------------------------------------------------

export type Layer =
  | "CONTOUR"
  | "DADO_7MM"
  | "BOOR_8MM"
  | "BOOR_5MM"
  | "BOOR_5_5MM"
  | "BOOR_15MM"
  | "CABINEO_11MM"
  | "RUG_SPONNING"
  | "GRAVURE";

export type Side = "A" | "B";

export interface RectOp {
  kind: "rect";
  layer: Layer;
  side: Side;
  x: number;
  y: number;
  w: number;
  h: number;
  depth: number;
  /** Hoekradius van de pocketcontour (0 = scherpe hoeken in de tekening). */
  radius?: number;
}

export interface CircleOp {
  kind: "circle";
  layer: Layer;
  side: Side;
  cx: number;
  cy: number;
  diameter: number;
  depth: number;
  through: boolean;
}

export interface TextOp {
  kind: "text";
  layer: Layer;
  side: Side;
  x: number;
  y: number;
  text: string;
  height: number;
}

/** Vrije gesloten pocketcontour (bijv. de Cabineo-klaverbladvorm). */
export interface PathOp {
  kind: "path";
  layer: Layer;
  side: Side;
  points: [number, number][];
  depth: number;
}

export type Operation = RectOp | CircleOp | TextOp | PathOp;

export type PanelType = "staander" | "plank" | "plint" | "rug";
export type Material = "plaat18" | "hdf4";

export interface Placement3D {
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface Panel {
  id: string;
  type: PanelType;
  material: Material;
  /** Lengte van het onderdeel (langs de strook). */
  length: number;
  /** Breedte van het onderdeel (strookhoogte, meestal de kastdiepte). */
  width: number;
  thickness: number;
  ops: Operation[];
  /** Al het niet-rechthoekige contourwerk (hoekinkepingen bij dado's). */
  notches: { x: number; y: number; w: number; h: number }[];
  /**
   * De zijde die boven op het CNC-bed ligt. Planken liggen ondersteboven
   * ("B"), zodat deuvelgaten/Cabineo-pockets zonder omklappen gefreesd
   * worden. Bewerkingen op de andere zijde komen op `_B`-lagen: omklappen
   * over de korte zijde (planken/plint) of de lange zijde (staanders).
   */
  machineSide: Side;
  place: Placement3D;
  module: number;
  /**
   * Vrije buitencontour (lokaal, gesloten linksom) voor niet-rechthoekige
   * onderdelen zoals planken met een geprofileerde voorrand. Vervangt dan
   * de rechthoek + inkepingen.
   */
  contour?: [number, number][];
  /** Alleen voor weglaatbare tussenplanken: sleutel voor de 3D-toggle. */
  shelfKey?: string;
  /** Alleen voor verplaatsbare binnenstaanders: sleutel `col:${i}`. */
  staanderKey?: string;
  /** Rotatie om de verticale as (rad), voor een rug tegen een schuine muur. */
  yaw?: number;
}

export interface CellInfo {
  key: string;
  module: number;
  col: number;
  /** Onderste rij van het (eventueel samengevoegde) vak. */
  row: number;
  /** Aantal rijen dat dit vak beslaat (>1 als er planken zijn weggelaten). */
  rowSpan: number;
  fill: CellFill;
  /** Binnenmaat van het vak in kastcoördinaten. */
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}

export interface HardwareItem {
  name: string;
  qty: number;
  unit: string;
}

export interface SnapResult {
  snappedWidth: number;
  cellWidth: number;
  shelfPartLength: number;
  shelvesPerStrip: number;
  snapped: boolean;
  delta: number;
  /** Ongebruikte restlengte van een volle plankenstrook. */
  stripLeftover: number;
}

export interface CabinetModel {
  config: CabinetConfig;
  snap: SnapResult;
  snappedWidth: number;
  cellWidth: number;
  moduleCount: number;
  moduleHeights: number[];
  shelfPartLength: number;
  panels: Panel[];
  cells: CellInfo[];
  /** Weggelaten tussenplanken, als doorzichtige "ghost" terug te zetten in 3D. */
  ghostShelves: { key: string; place: Placement3D }[];
  /** Pootjes (alleen bij base = pootjes), voor render en BOM. */
  feet: FootPlacement[];
  /** Hoogte waarop de romp begint (poothoogte, anders 0). */
  bodyBase: number;
  hardware: HardwareItem[];
  warnings: string[];
}

interface ColumnCell {
  row: number;
  rowSpan: number;
  /** Onderkant binnenmaat (module-lokaal) en hoogte. */
  y: number;
  h: number;
  fill: CellFill;
}

// ---- Breedte-snapping -------------------------------------------------------

/** Lengte die de plank als CNC-onderdeel heeft (incl. dado-tongen). */
function shelfPartLengthFor(cellWidth: number, joinery: CabinetConfig["joinery"]): number {
  return joinery === "dado" ? cellWidth + 2 * DADO_DEPTH : cellWidth;
}

/**
 * Snap de gevraagde kastbreedte zodat `m` planken plus freesbanen een strook
 * van 2420 mm exact vullen. Alleen gesnapt binnen WIDTH_SNAP_TOLERANCE.
 */
export function snapWidth(config: CabinetConfig): SnapResult {
  const { columns, thickness, joinery } = config;
  const tongue = joinery === "dado" ? 2 * DADO_DEPTH : 0;
  const requestedCellWidth = (config.width - (columns + 1) * thickness) / columns;

  let best: SnapResult | null = null;
  for (let m = 1; m <= 14; m++) {
    const partLength = (USABLE_LENGTH - (m - 1) * KERF) / m;
    const cw = partLength - tongue;
    if (cw < MIN_CELL_WIDTH) break;
    const width = (columns + 1) * thickness + columns * cw;
    const delta = width - config.width;
    if (!best || Math.abs(delta) < Math.abs(best.delta)) {
      best = {
        snappedWidth: round1(width),
        cellWidth: round1(cw),
        shelfPartLength: round1(partLength),
        shelvesPerStrip: m,
        snapped: true,
        delta: round1(delta),
        stripLeftover: 0,
      };
    }
  }

  if (best && Math.abs(best.delta) <= WIDTH_SNAP_TOLERANCE) return best;

  // Geen exacte vulling in de buurt: gevraagde maat aanhouden.
  const partLength = shelfPartLengthFor(requestedCellWidth, joinery);
  const perStrip = Math.max(
    1,
    Math.floor((USABLE_LENGTH + KERF) / (partLength + KERF)),
  );
  return {
    snappedWidth: config.width,
    cellWidth: round1(requestedCellWidth),
    shelfPartLength: round1(partLength),
    shelvesPerStrip: perStrip,
    snapped: false,
    delta: 0,
    stripLeftover: round1(
      USABLE_LENGTH - (perStrip * partLength + (perStrip - 1) * KERF),
    ),
  };
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

// ---- Rug-voorstel -----------------------------------------------------------

/**
 * Automatisch voorstel voor rugpanelen: hoekvakken + onderste rij
 * (± 30–40% van de vakken). De gebruiker kan per vak overrulen.
 */
export function defaultCellFill(
  col: number,
  row: number,
  columns: number,
  rows: number,
): CellFill {
  const corner =
    (col === 0 || col === columns - 1) && (row === 0 || row === rows - 1);
  return corner || row === 0 ? "rug" : "open";
}

export function cellFillFor(config: CabinetConfig, module: number, col: number, row: number): CellFill {
  const explicit = config.cellFills[cellKey(module, col, row)];
  if (explicit) return explicit;
  return defaultCellFill(col, row, config.columns, config.rows);
}

// ---- Cabineo-pocketcontour --------------------------------------------------

/**
 * Exacte gefreesde Cabineo-pocketcontour volgens het Lamello-maatblad:
 * de vereniging van drie Ø15-cirkels met de harten op 3,6 / 14,8 / 26 mm
 * vanaf de naadrand. Bij `frees10` lopen de bogen door tot hun snijpunten
 * (x = 9,2 en 20,4); bij `frees12` worden de concave overgangen vervangen
 * door rechte brugjes op y = ±6 (x = 8,1–10,3 en 19,3–21,5) zodat een
 * Ø12-frees past. Coördinaten: x vanaf het plankeinde, y rond de as;
 * gesloten linksom (sluiting loopt over de naadrand x = 0). Bogen worden
 * gepolygoniseerd (stap ~4°) zodat elke DXF-lezer de vorm 1:1 overneemt.
 */
export function cabineoPocketContour(
  variant: Exclude<CabineoVariant, "boor15">,
): [number, number][] {
  const r = CABINEO_HOLE_DIAMETER / 2;
  const [c1, c2, c3] = CABINEO_HOLE_CENTERS;
  const deg = Math.PI / 180;
  const step = 4;

  // Overgangshoek tussen twee cirkels (t.o.v. het cirkelhart, bovenhelft):
  // frees10 → tot het snijpunt van de cirkels; frees12 → tot y = ±6,
  // waarna een recht brugje naar de volgende cirkel loopt.
  const toDeg = (rad: number) => (rad / Math.PI) * 180;
  const halfGap = (c2 - c1) / 2; // 5,6
  const aJoin =
    variant === "frees10"
      ? toDeg(Math.atan2(Math.sqrt(r * r - halfGap * halfGap), halfGap))
      : toDeg(
          Math.atan2(
            CABINEO_FLAT_HALF_WIDTH,
            Math.sqrt(r * r - CABINEO_FLAT_HALF_WIDTH ** 2),
          ),
        );
  // Hoek waar de eerste cirkel de naadrand (x = 0) snijdt.
  const edgeY = Math.sqrt(r * r - c1 * c1);
  const aEdge = (Math.atan2(edgeY, -c1) / Math.PI) * 180;

  const arc = (cx: number, a0: number, a1: number): [number, number][] => {
    const pts: [number, number][] = [];
    const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / step));
    for (let i = 0; i <= n; i++) {
      const a = (a0 + ((a1 - a0) * i) / n) * deg;
      pts.push([cx + r * Math.cos(a), r * Math.sin(a)]);
    }
    return pts;
  };

  const pts: [number, number][] = [
    ...arc(c1, aEdge, aJoin),
    ...arc(c2, 180 - aJoin, aJoin),
    ...arc(c3, 180 - aJoin, -(180 - aJoin)),
    ...arc(c2, -aJoin, -(180 - aJoin)),
    ...arc(c1, -aJoin, -aEdge),
  ];
  // Opeenvolgende (vrijwel) identieke punten wegfilteren.
  const out: [number, number][] = [];
  for (const p of pts) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < 0.005 && Math.abs(prev[1] - p[1]) < 0.005) continue;
    out.push([Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000]);
  }
  return out;
}

// ---- Hoofdfunctie -----------------------------------------------------------

export interface FootPlacement {
  place: Placement3D;
  type: FeetType;
}

/**
 * Dieptes worden intern in één globaal assenstelsel gerekend: z = 0 is de
 * (rechte) muurlijn achter de kast, de voorkant ligt op z = D. De achterkant
 * van elk onderdeel kan naar voren liggen (scheve muur, muurplint), de
 * voorkant naar achteren (profiel). Per onderdeel wordt daarna naar het
 * lokale CNC-frame omgerekend, waarvan y = 0 de eigen achterrand is.
 */
export function buildCabinetModel(config: CabinetConfig): CabinetModel {
  const warnings: string[] = [];
  const { columns, rows, depth: D, joinery, thickness: t } = config;

  const snap = snapWidth(config);
  const W = snap.snappedWidth;
  const cellW = snap.cellWidth;
  const shelfLen = snap.shelfPartLength;
  const cabOff = cabineoEdgeOffsets(D);
  const hplMaterial = materialById(config.materialId).hpl === true;

  // Pootjes: de romp staat op de poten; de totale hoogte blijft config.height.
  const feetHeight = config.base === "pootjes" ? config.feet.height : 0;
  const bodyBase = feetHeight;
  const bodyHeight = config.height - feetHeight;
  if (bodyHeight < 300) {
    warnings.push("Romp lager dan 300 mm na aftrek van de poothoogte — verhoog de kast of verlaag de poten.");
  }

  // Voorkantprofiel: amplitude begrensd zodat de kast nergens ondieper wordt
  // dan MIN_PROFILE_DEPTH.
  const maxAmplitude = Math.max(0, D - MIN_PROFILE_DEPTH);
  const profile: FrontProfile = {
    ...config.frontProfile,
    amplitude: Math.min(config.frontProfile.amplitude, maxAmplitude),
  };
  if (config.frontProfile.type !== "recht" && config.frontProfile.amplitude > maxAmplitude) {
    warnings.push(
      `Profielamplitude begrensd op ${maxAmplitude} mm zodat de kast minimaal ${MIN_PROFILE_DEPTH} mm diep blijft.`,
    );
  }
  const profiled = profile.type !== "recht" && profile.amplitude > 0;
  /** Globale voorkant op breedtepositie x. */
  const frontAt = (x: number) => D - frontOffset(profile, x, W);

  // Rug: volledig dichte achterwand wordt altijd geschroefd.
  const fullBack = config.rugMode === "volledig";
  const sponning = config.rugMount === "sponning" && !fullBack;
  if (config.rugMount === "sponning" && fullBack) {
    warnings.push("Een volledig dichte achterwand wordt op de achterkant geschroefd; de sponning-optie is hier niet van toepassing.");
  }

  // Achterzijde: lineair verloop (scheve muur) en bestaande muurplint.
  const taper = config.backTaper;
  const backAt = (x: number) =>
    round1(
      taper.left +
        (taper.right - taper.left) * Math.min(1, Math.max(0, x / W)),
    );
  const skirt = config.wallSkirting;
  // Hoogte van de muurplint boven de romp-onderkant (romp staat evt. op poten).
  const skirtNotchH =
    skirt.height > 0 && skirt.depth > 0 ? Math.max(0, skirt.height - bodyBase) : 0;
  const skirtDepth = skirtNotchH > 0 ? skirt.depth : 0;
  /** Ligt iets op romp-hoogte y (vanaf romp-onderkant) achter de muurplint? */
  const behindSkirt = (bodyY: number) => skirtDepth > 0 && bodyY < skirtNotchH;

  // Staanderposities: grid + verschuiving per binnenstaander, van links naar
  // rechts begrensd zodat elke kolom minimaal MIN_CELL_WIDTH breed blijft.
  const gridX = (i: number) => i * (cellW + t);
  const xs: number[] = [0];
  for (let i = 1; i < columns; i++) {
    const raw = gridX(i) + (config.columnOffsets[String(i)] ?? 0);
    const nextRaw =
      i + 1 === columns ? gridX(columns) : gridX(i + 1) + (config.columnOffsets[String(i + 1)] ?? 0);
    const lo = xs[i - 1] + t + MIN_CELL_WIDTH;
    const hi = Math.max(lo, nextRaw - t - MIN_CELL_WIDTH);
    xs.push(round1(Math.min(Math.max(raw, lo), hi)));
  }
  xs.push(round1(gridX(columns)));
  const staanderX = (i: number) => xs[i];
  const dadoInset = joinery === "dado" ? DADO_DEPTH : 0;
  /** Vakbreedte en planklengte per kolom. */
  const colWidth = (c: number) => round1(xs[c + 1] - xs[c] - t);
  const colShelfLen = (c: number) => round1(colWidth(c) + 2 * dadoInset);
  const staanderBack = (i: number) => backAt(staanderX(i) + t / 2);
  const staanderFront = (i: number) =>
    profiled ? round1(frontAt(staanderX(i) + t / 2)) : D;
  const staanderDepth = (i: number) => round1(staanderFront(i) - staanderBack(i));

  let minDepth = Infinity;
  for (let i = 0; i <= columns; i++) minDepth = Math.min(minDepth, staanderDepth(i));
  if (minDepth - skirtDepth < MIN_PROFILE_DEPTH) {
    warnings.push(
      `Effectieve kastdiepte wordt ${round1(minDepth - skirtDepth)} mm (verloop achter/muurplint/profiel) — houd minimaal ${MIN_PROFILE_DEPTH} mm over.`,
    );
  }

  // Modules: hoger dan MAX_MODULE_HEIGHT wordt gestapeld.
  const moduleCount = Math.max(1, Math.ceil(bodyHeight / MAX_MODULE_HEIGHT));
  const moduleHeights: number[] = [];
  for (let m = 0; m < moduleCount; m++) {
    moduleHeights.push(round1(bodyHeight / moduleCount));
  }

  const panels: Panel[] = [];
  const cells: CellInfo[] = [];
  const ghostShelves: { key: string; place: Placement3D }[] = [];
  const notchLen = DADO_FRONT_STOP + TOOL_RADIUS; // hoekinkeping plank

  let staanderNo = 0;
  let plankNo = 0;
  let rugNo = 0;
  let dowelJoints = 0;
  let cabineoJoints = 0;
  let rugCellCount = 0;
  let tallCellWarned = false;

  let moduleBase = 0;
  for (let m = 0; m < moduleCount; m++) {
    const Hm = moduleHeights[m];
    const plinthOffset = m === 0 && config.base === "plint" ? PLINTH_HEIGHT : 0;

    // Plankniveaus binnen de module: onderste + tussenliggende + bovenste.
    // levelY[j] = onderkant van plank j (j = 0..rows), module-lokaal.
    const innerSpan = Hm - plinthOffset - 2 * t;
    const cellH = round1((innerSpan - (rows - 1) * t) / rows);
    const levelY: number[] = [];
    for (let j = 0; j <= rows; j++) {
      levelY.push(j === rows ? Hm - t : plinthOffset + j * (cellH + t));
    }

    if (cellH < MIN_CELL_HEIGHT) {
      warnings.push(
        `Module ${m + 1}: vakhoogte ${cellH} mm is kleiner dan ${MIN_CELL_HEIGHT} mm — verminder het aantal rijen of vergroot de hoogte.`,
      );
    }

    // Aanwezige plankniveaus per kolom: onder- en bovenplank altijd,
    // tussenplanken tenzij weggelaten.
    const shelfPresent = (c: number, j: number) =>
      j === 0 || j === rows || !config.omittedShelves[shelfKey(m, c, j)];
    const presentLevels = (c: number): number[] => {
      const levels: number[] = [];
      for (let j = 0; j <= rows; j++) if (shelfPresent(c, j)) levels.push(j);
      return levels;
    };

    // Per-kolom plankhoogtes: gridpositie + verschuiving, van onder naar
    // boven begrensd zodat elk vak minimaal MIN_CELL_HEIGHT hoog blijft.
    const colLevelY: number[][] = [];
    for (let c = 0; c < columns; c++) {
      const ys = [...levelY];
      let prevY = levelY[0];
      for (let j = 1; j < rows; j++) {
        if (!shelfPresent(c, j)) continue;
        const raw = levelY[j] + (config.shelfOffsets[shelfKey(m, c, j)] ?? 0);
        let nextY = levelY[rows];
        for (let k = j + 1; k < rows; k++) {
          if (shelfPresent(c, k)) {
            nextY = levelY[k] + (config.shelfOffsets[shelfKey(m, c, k)] ?? 0);
            break;
          }
        }
        const lo = prevY + t + MIN_CELL_HEIGHT;
        const hi = Math.max(lo, nextY - t - MIN_CELL_HEIGHT);
        ys[j] = round1(Math.min(Math.max(raw, lo), hi));
        prevY = ys[j];
      }
      colLevelY.push(ys);
    }
    const levelYFor = (c: number, j: number) => colLevelY[c][j];

    // Vakken (voor raycast-toggles en rugpanelen), per kolom samengevoegd.
    const colCells: ColumnCell[][] = [];
    for (let c = 0; c < columns; c++) {
      const lv = presentLevels(c);
      const list: ColumnCell[] = [];
      const cellBack = backAt(xs[c] + t + colWidth(c) / 2);
      for (let k = 0; k < lv.length - 1; k++) {
        const j0 = lv[k];
        const j1 = lv[k + 1];
        const fill: CellFill = fullBack ? "rug" : cellFillFor(config, m, c, j0);
        if (fill === "rug") rugCellCount++;
        const cell: ColumnCell = {
          row: j0,
          rowSpan: j1 - j0,
          y: levelYFor(c, j0) + t,
          h: round1(levelYFor(c, j1) - (levelYFor(c, j0) + t)),
          fill,
        };
        list.push(cell);
        const gBack = cellBack + (behindSkirt(moduleBase + cell.y) ? skirtDepth : 0);
        cells.push({
          key: cellKey(m, c, j0),
          module: m,
          col: c,
          row: j0,
          rowSpan: cell.rowSpan,
          fill,
          x: xs[c] + t,
          y: bodyBase + moduleBase + cell.y,
          z: gBack,
          w: colWidth(c),
          h: cell.h,
          d: Math.max(50, D - gBack),
        });
        if (cell.h > 1000 && !tallCellWarned) {
          tallCellWarned = true;
          warnings.push(
            "Een vak is hoger dan 1000 mm doordat er tussenplanken zijn weggelaten: de staanders missen daar dwarsverband — overweeg een rugpaneel in dat vak.",
          );
        }
      }
      colCells.push(list);
    }

    // ---- Staanders ----------------------------------------------------------
    for (let i = 0; i <= columns; i++) {
      staanderNo++;
      const id = `S${staanderNo}`;
      const ops: Operation[] = [];
      const bi = staanderBack(i); // globale achterkant = lokaal y = 0
      const gFront = staanderFront(i);
      const Di = staanderDepth(i);
      const lz = (g: number) => round1(g - bi);
      // Side A = vlak richting +x (rechts), side B = richting -x (links).
      const sides: Side[] = [];
      if (i < columns) sides.push("A");
      if (i > 0) sides.push("B");

      for (const side of sides) {
        const colOfSide = side === "A" ? i : i - 1;
        for (let j = 0; j <= rows; j++) {
          if (!shelfPresent(colOfSide, j)) continue; // weggelaten plank: geen naad
          const yj = levelYFor(colOfSide, j);
          // Achterkant van de naad: achter de muurplint begint alles later.
          const gBack = bi + (behindSkirt(moduleBase + yj) ? skirtDepth : 0);
          if (joinery === "dado") {
            // Blinde dado: 7 mm diep, breedte = plaatdikte, stopt 30 mm vóór voorzijde.
            ops.push({
              kind: "rect",
              layer: "DADO_7MM",
              side,
              x: yj,
              y: lz(gBack),
              w: t,
              h: round1(gFront - DADO_FRONT_STOP - gBack),
              depth: DADO_DEPTH,
            });
            // Deuvelgat Ø8 in de dadobodem (montageborging).
            ops.push({
              kind: "circle",
              layer: "BOOR_8MM",
              side,
              cx: yj + t / 2,
              cy: lz((gBack + gFront - DADO_FRONT_STOP) / 2),
              diameter: DOWEL_DIAMETER,
              depth: DADO_DEPTH + 8,
              through: false,
            });
            dowelJoints++;
          } else {
            // Cabineo-boutgaten Ø5, met per aansluitzijde een andere
            // randafstand zodat bouten van beide vakken elkaar niet raken.
            // Binnenstaanders: doorlopend vanaf zijde A (de uitgang wordt
            // afgedekt door de plank aan de andere kant). Buitenstaanders:
            // blind vanaf de binnenzijde, anders zit er een zichtbaar gat
            // in de buitenwang — dat is meteen hun enige bewerkingszijde.
            const isOuter = i === 0 || i === columns;
            const edge = side === "A" ? cabOff.a : cabOff.b;
            for (let k = 0; k < CABINEOS_PER_JOINT; k++) {
              const cy = k === 0 ? lz(gBack + edge) : lz(gFront - edge);
              ops.push({
                kind: "circle",
                layer: hplMaterial ? "BOOR_5_5MM" : "BOOR_5MM",
                side: isOuter ? side : "A",
                cx: yj + t / 2,
                cy,
                diameter: hplMaterial
                  ? CABINEO_BOLT_DIAMETER_HPL
                  : CABINEO_BOLT_DIAMETER,
                // Boordiepte = Cabineo-maat (8 of 12 mm, officiële X-maat).
                depth: isOuter ? config.cabineoSize : t,
                through: !isOuter,
              });
            }
            cabineoJoints++;
          }
        }

        // RUG_SPONNING: verticale groef per rug-vak aan deze zijde
        // (alleen bij rug-in-sponning; geschroefde rug heeft geen groeven).
        if (sponning) {
          for (const cell of colCells[colOfSide]) {
            if (cell.fill !== "rug") continue;
            const gBack = bi + (behindSkirt(moduleBase + cell.y) ? skirtDepth : 0);
            ops.push({
              kind: "rect",
              layer: "RUG_SPONNING",
              side,
              x: cell.y - RUG_GROOVE_DEPTH,
              y: lz(gBack) + RUG_GROOVE_BACK_OFFSET - RUG_GROOVE_WIDTH / 2,
              w: cell.h + 2 * RUG_GROOVE_DEPTH,
              h: RUG_GROOVE_WIDTH,
              depth: RUG_GROOVE_DEPTH,
            });
          }
        }
      }

      // Beddezijde: de zijde waar de bewerkingen zitten; alleen
      // binnenstaanders met blinde dado's hebben onvermijdelijk twee zijden.
      const machineSide: Side = ops.some((o) => o.side === "A") ? "A" : "B";
      ops.push(engrave(id, Hm, Di, machineSide));

      // Muurplint: inkeping achter-onder (alleen onderste module).
      let contour: [number, number][] | undefined;
      if (m === 0 && skirtDepth > 0) {
        const nh = Math.min(skirtNotchH, Hm - t);
        contour = [
          [0, skirtDepth],
          [nh, skirtDepth],
          [nh, 0],
          [Hm, 0],
          [Hm, Di],
          [0, Di],
        ];
      }

      panels.push({
        id,
        type: "staander",
        material: "plaat18",
        length: Hm,
        width: Di,
        thickness: t,
        ops,
        notches: [],
        machineSide,
        contour,
        staanderKey: i > 0 && i < columns ? `col:${i}` : undefined,
        place: {
          x: staanderX(i),
          y: bodyBase + moduleBase,
          z: bi,
          w: t,
          h: Hm,
          d: Di,
        },
        module: m,
      });
    }

    // ---- Planken ------------------------------------------------------------
    for (let c = 0; c < columns; c++) {
      const lv = presentLevels(c);
      const shelfLen = colShelfLen(c);
      const fL = staanderFront(c);
      const fR = staanderFront(c + 1);
      const bL0 = staanderBack(c);
      const bR0 = staanderBack(c + 1);
      const plankX0 = xs[c] + t - dadoInset;
      // Voorrand volgt het profiel; de uiteinden liggen exact op de voorkant
      // van de aansluitende staander zodat de voorzijde bij de naad vlak sluit.
      const front = (x: number) => {
        const corrL = fL - frontAt(plankX0);
        const corrR = fR - frontAt(plankX0 + shelfLen);
        return frontAt(plankX0 + x) + corrL + ((corrR - corrL) * x) / shelfLen;
      };

      // Weggelaten planken als ghost, zodat ze in 3D terug te zetten zijn.
      for (let j = 1; j < rows; j++) {
        if (shelfPresent(c, j)) continue;
        ghostShelves.push({
          key: shelfKey(m, c, j),
          place: {
            x: plankX0,
            y: bodyBase + moduleBase + levelY[j],
            z: Math.min(bL0, bR0),
            w: shelfLen,
            h: t,
            d: Math.min(fL, fR) - Math.min(bL0, bR0),
          },
        });
      }

      for (let idx = 0; idx < lv.length; idx++) {
        const j = lv[idx];
        const yj = levelYFor(c, j);
        plankNo++;
        const id = `P${plankNo}`;
        const ops: Operation[] = [];
        const notches: { x: number; y: number; w: number; h: number }[] = [];

        const behind = behindSkirt(moduleBase + yj);
        const gBackL = bL0 + (behind ? skirtDepth : 0);
        const gBackR = bR0 + (behind ? skirtDepth : 0);
        const bmin = Math.min(gBackL, gBackR); // lokaal y = 0
        const lz = (g: number) => round1(g - bmin);
        const shaped = profiled || Math.abs(gBackL - gBackR) > 0.01;

        let contour: [number, number][] | undefined;
        let plankWidth = round1(D - bmin);

        if (shaped) {
          // Vrije contour (linksom): schuine achterrand, gebogen voorrand,
          // incl. eventuele dado-inkepingen aan de voorhoeken.
          const N = 24;
          const pts: [number, number][] = [
            [0, lz(gBackL)],
            [shelfLen, lz(gBackR)],
          ];
          if (joinery === "dado") {
            const nbR = lz(Math.min(fR, front(shelfLen - dadoInset))) - notchLen;
            pts.push([shelfLen, round1(nbR)], [shelfLen - dadoInset, round1(nbR)]);
          }
          for (let k = 0; k <= N; k++) {
            const x = shelfLen - dadoInset - ((shelfLen - 2 * dadoInset) * k) / N;
            pts.push([round1(x), lz(front(x))]);
          }
          if (joinery === "dado") {
            const nbL = lz(Math.min(fL, front(dadoInset))) - notchLen;
            pts.push([dadoInset, round1(nbL)], [0, round1(nbL)]);
          }
          contour = pts;
          plankWidth = round1(Math.max(...pts.map(([, y]) => y)));
        } else if (joinery === "dado") {
          // Hoekinkepingen: dado stopt 30 mm vóór de voorzijde, dus de
          // plankhoeken worden 7 × (30 + freesradius) ingekeept.
          notches.push({ x: 0, y: plankWidth - notchLen, w: DADO_DEPTH, h: notchLen });
          notches.push({
            x: shelfLen - DADO_DEPTH,
            y: plankWidth - notchLen,
            w: DADO_DEPTH,
            h: notchLen,
          });
        }

        if (joinery === "dado") {
          // Deuvelgat Ø8 per naad in het plankvlak (blind, onderzijde), in
          // het hart van de dado van de aansluitende staander.
          for (const [cx, gBack, gFront] of [
            [DADO_DEPTH / 2, gBackL, fL],
            [shelfLen - DADO_DEPTH / 2, gBackR, fR],
          ] as [number, number, number][]) {
            ops.push({
              kind: "circle",
              layer: "BOOR_8MM",
              side: "B",
              cx,
              cy: lz((gBack + gFront - DADO_FRONT_STOP) / 2),
              diameter: DOWEL_DIAMETER,
              depth: 10,
              through: false,
            });
          }
        } else {
          // Cabineo-pockets in het plankvlak (onderzijde, tegen elk uiteinde)
          // volgens het officiële maatblad: drie Ø15-cirkels haaks op de
          // naad, harten op 3,6 / 14,8 / 26 mm vanaf het plankeinde.
          // Linkeruiteinde sluit aan op de A-zijde van een staander,
          // rechteruiteinde op de B-zijde: randafstanden volgen die zijden.
          for (const end of [0, 1]) {
            const edge = end === 0 ? cabOff.a : cabOff.b;
            const gBack = end === 0 ? gBackL : gBackR;
            const gFront = end === 0 ? fL : fR;
            for (let k = 0; k < CABINEOS_PER_JOINT; k++) {
              const cy = k === 0 ? lz(gBack + edge) : lz(gFront - edge);
              if (config.cabineoVariant === "boor15") {
                // Variant 1: drie boringen Ø15.
                for (const cc of CABINEO_HOLE_CENTERS) {
                  ops.push({
                    kind: "circle",
                    layer: "BOOR_15MM",
                    side: "B",
                    cx: end === 0 ? cc : shelfLen - cc,
                    cy,
                    diameter: CABINEO_HOLE_DIAMETER,
                    depth: CABINEO_POCKET_DEPTH,
                    through: false,
                  });
                }
              } else {
                // Variant 2/3: exacte gefreesde klaverbladcontour.
                const pocket = cabineoPocketContour(config.cabineoVariant);
                ops.push({
                  kind: "path",
                  layer: "CABINEO_11MM",
                  side: "B",
                  points: pocket.map(
                    ([px, py]) =>
                      [end === 0 ? px : shelfLen - px, cy + py] as [number, number],
                  ),
                  depth: CABINEO_POCKET_DEPTH,
                });
              }
            }
          }
        }

        // RUG_SPONNING in de plank (alleen bij rug-in-sponning):
        // bovenvlak voor het vak erboven, ondervlak voor het vak eronder.
        // Volgt de (eventueel schuine) achterrand.
        if (sponning) {
          const rugAbove = j < rows && cellFillFor(config, m, c, j) === "rug";
          const rugBelow =
            idx > 0 && cellFillFor(config, m, c, lv[idx - 1]) === "rug";
          for (const [has, side] of [
            [rugAbove, "A"],
            [rugBelow, "B"],
          ] as [boolean, Side][]) {
            if (!has) continue;
            const g0 = RUG_GROOVE_BACK_OFFSET - RUG_GROOVE_WIDTH / 2;
            const yL = lz(gBackL) + g0;
            const yR = lz(gBackR) + g0;
            if (Math.abs(yL - yR) < 0.01) {
              ops.push({
                kind: "rect",
                layer: "RUG_SPONNING",
                side,
                x: 0,
                y: yL,
                w: shelfLen,
                h: RUG_GROOVE_WIDTH,
                depth: RUG_GROOVE_DEPTH,
              });
            } else {
              ops.push({
                kind: "path",
                layer: "RUG_SPONNING",
                side,
                points: [
                  [0, yL],
                  [shelfLen, yR],
                  [shelfLen, yR + RUG_GROOVE_WIDTH],
                  [0, yL + RUG_GROOVE_WIDTH],
                ],
                depth: RUG_GROOVE_DEPTH,
              });
            }
          }
        }

        // Planken liggen ondersteboven op het bed: gravure mee op zijde B.
        ops.push(engrave(id, shelfLen, plankWidth, "B"));

        panels.push({
          id,
          type: "plank",
          material: "plaat18",
          length: shelfLen,
          width: plankWidth,
          thickness: t,
          ops,
          notches,
          machineSide: "B",
          contour,
          shelfKey: j > 0 && j < rows ? shelfKey(m, c, j) : undefined,
          place: {
            x: plankX0,
            y: bodyBase + moduleBase + yj,
            z: bmin,
            w: shelfLen,
            h: t,
            d: plankWidth,
          },
          module: m,
        });
      }
    }

    // ---- Rugpanelen (HDF) ---------------------------------------------------
    // Geschroefd: paneel overlapt de achterranden van staanders en planken
    // (halve plaatdikte rondom) en wordt geschroefd — geen groeven nodig.
    // Sponning: paneel valt in de gefreesde groef.
    const rugOversize = sponning ? RUG_GROOVE_DEPTH - RUG_CLEARANCE : t / 2;
    for (let c = 0; c < columns && !fullBack; c++) {
      const cellBack = backAt(xs[c] + t + colWidth(c) / 2);
      for (const cell of colCells[c]) {
        if (cell.fill !== "rug") continue;
        rugNo++;
        const id = `R${rugNo}`;
        const rw = round1(colWidth(c) + 2 * rugOversize);
        const rh = round1(cell.h + 2 * rugOversize);
        const gBack = cellBack + (behindSkirt(moduleBase + cell.y) ? skirtDepth : 0);
        panels.push({
          id,
          type: "rug",
          material: "hdf4",
          length: Math.max(rw, rh),
          width: Math.min(rw, rh),
          thickness: HDF_THICKNESS,
          ops: [engrave(id, Math.max(rw, rh), Math.min(rw, rh), "A")],
          notches: [],
          machineSide: "A",
          place: {
            x: xs[c] + t - rugOversize,
            y: bodyBase + moduleBase + cell.y - rugOversize,
            z: sponning
              ? gBack + RUG_GROOVE_BACK_OFFSET - HDF_THICKNESS / 2
              : gBack - HDF_THICKNESS,
            w: rw,
            h: rh,
            d: HDF_THICKNESS,
          },
          module: m,
        });
      }
    }

    // ---- Volledig dichte achterwand -----------------------------------------
    // Eén HDF-vlak per module, opgedeeld in stukken die op de HDF-plaat passen
    // (≤ bruikbare plaatbreedte), met de naden achter staanderharten.
    if (fullBack) {
      const usable = HDF_SHEET_WIDTH - 2 * SHEET_MARGIN;
      const yStart = m === 0 ? skirtNotchH : 0;
      const pieceH = round1(Hm - yStart);
      const slope = (taper.right - taper.left) / W;
      let startI = 0;
      while (startI < columns) {
        const xStart = startI === 0 ? 0 : xs[startI] + t / 2;
        let endI = startI + 1;
        while (endI < columns) {
          const candEnd = endI + 1 === columns ? W : xs[endI + 1] + t / 2;
          if (candEnd - xStart <= usable) endI++;
          else break;
        }
        const xEnd = endI === columns ? W : xs[endI] + t / 2;
        const pieceW = round1(xEnd - xStart);
        if (pieceW > usable) {
          warnings.push(
            `Achterwandstuk van ${pieceW} mm past niet op de HDF-plaat (max ${usable} mm) — verklein de kolombreedte of verdeel de kast.`,
          );
        }
        rugNo++;
        const id = `R${rugNo}`;
        const xc = (xStart + xEnd) / 2;
        panels.push({
          id,
          type: "rug",
          material: "hdf4",
          length: Math.max(pieceW, pieceH),
          width: Math.min(pieceW, pieceH),
          thickness: HDF_THICKNESS,
          ops: [engrave(id, Math.max(pieceW, pieceH), Math.min(pieceW, pieceH), "A")],
          notches: [],
          machineSide: "A",
          yaw: slope !== 0 ? -Math.atan(slope) : undefined,
          place: {
            x: xStart,
            y: bodyBase + moduleBase + yStart,
            z: backAt(xc) - HDF_THICKNESS,
            w: pieceW,
            h: pieceH,
            d: HDF_THICKNESS,
          },
          module: m,
        });
        startI = endI;
      }
    }

    moduleBase += Hm;
  }

  // ---- Plint ----------------------------------------------------------------
  if (config.base === "plint") {
    const plintLen = round1(W - 2 * t - 2);
    // Plint achter het ondiepste punt van de voorkant.
    let minFront = D;
    for (let i = 0; i <= columns; i++) minFront = Math.min(minFront, staanderFront(i));
    panels.push({
      id: "PL1",
      type: "plint",
      material: "plaat18",
      length: plintLen,
      width: PLINTH_HEIGHT,
      thickness: t,
      ops: [engrave("PL1", plintLen, PLINTH_HEIGHT, "A")],
      notches: [],
      machineSide: "A",
      place: {
        x: t + 1,
        y: 0,
        z: minFront - PLINTH_SETBACK - t,
        w: plintLen,
        h: PLINTH_HEIGHT,
        d: t,
      },
      module: 0,
    });
  }

  // ---- Pootjes --------------------------------------------------------------
  const feet: FootPlacement[] = [];
  if (config.base === "pootjes") {
    const size = config.feet.size;
    const inset = 40;
    for (let i = 0; i <= columns; i++) {
      const back = staanderBack(i) + (behindSkirt(0) ? skirtDepth : 0);
      const frontZ = staanderFront(i);
      const xc = staanderX(i) + t / 2;
      for (const zc of [back + inset + size / 2, frontZ - inset - size / 2]) {
        feet.push({
          type: config.feet.type,
          place: {
            x: xc - size / 2,
            y: 0,
            z: zc - size / 2,
            w: size,
            h: feetHeight,
            d: size,
          },
        });
      }
    }
  }

  // ---- Hardware -------------------------------------------------------------
  const hardware: HardwareItem[] = [];
  if (joinery === "dado") {
    hardware.push({ name: "Deuvel Ø8 × 35 mm", qty: dowelJoints, unit: "stuks" });
    hardware.push({ name: "Houtlijm (D3)", qty: 1, unit: "fles" });
  } else {
    hardware.push({
      name: `Lamello Cabineo ${config.cabineoSize}`,
      qty: cabineoJoints * CABINEOS_PER_JOINT,
      unit: "stuks",
    });
  }
  const rugPanels = panels.filter((p) => p.type === "rug");
  if (rugPanels.length > 0) {
    hardware.push({
      name: fullBack ? "HDF achterwand 4 mm (in stukken, naden achter staanders)" : "HDF rugpaneel 4 mm (gefreesd)",
      qty: rugPanels.length,
      unit: "stuks",
    });
    if (!sponning) {
      const screws = fullBack
        ? rugPanels.reduce((n, p) => n + Math.max(8, Math.ceil((2 * (p.length + p.width)) / 300)), 0)
        : rugPanels.length * RUG_SCREWS_PER_PANEL;
      hardware.push({ name: "Spaanplaatschroef 3,5 × 16 mm (rug)", qty: screws, unit: "stuks" });
    }
  }
  hardware.push({ name: "L-beugel muurbevestiging", qty: 2, unit: "stuks" });
  if (config.base === "pootjes") {
    hardware.push({
      name: `Pootje ${config.feet.type}, ${config.feet.height} mm hoog, Ø/□ ${config.feet.size} mm`,
      qty: feet.length,
      unit: "stuks",
    });
  }

  // ---- Validatie ------------------------------------------------------------
  if (rugCellCount === 0 && !config.wallMount) {
    warnings.push(
      "Geen enkel rugpaneel en geen muurbevestiging: de kast heeft geen dwarsverband en kan schranken. Voeg rugpanelen toe of zet muurbevestiging aan.",
    );
  }
  if (config.height > WALL_BRACKET_MANDATORY_HEIGHT && !config.wallMount) {
    warnings.push(
      `Bij een hoogte boven ${WALL_BRACKET_MANDATORY_HEIGHT} mm is muurbevestiging met 2 L-beugels verplicht.`,
    );
  }
  for (const p of panels) {
    if (p.length > MAX_PART_LENGTH) {
      warnings.push(
        `Onderdeel ${p.id} is ${p.length} mm lang en past niet binnen de bruikbare plaatlengte van ${MAX_PART_LENGTH} mm.`,
      );
    }
    if (p.material === "plaat18" && p.width > D + 0.01 && p.type !== "plint") {
      warnings.push(`Onderdeel ${p.id} is breder dan de kastdiepte.`);
    }
  }
  if (joinery === "cabineo" && t < CABINEO_MIN_THICKNESS[config.cabineoSize]) {
    warnings.push(
      `Cabineo ${config.cabineoSize} vraagt een plaatdikte vanaf ${CABINEO_MIN_THICKNESS[config.cabineoSize]} mm (nu ${t} mm) — kies een dikkere plaat of een kleinere Cabineo-maat.`,
    );
  }
  if (joinery === "dado" && t < 16) {
    warnings.push(
      `Plaatdikte ${t} mm is te dun voor de blinde dado met deuvelboring (15 mm diep in de dadobodem) — gebruik minimaal 16 mm of kies Cabineo.`,
    );
  }
  if (joinery === "cabineo" && cabOff.b - cabOff.a < 20) {
    warnings.push(
      `Kastdiepte ${D} mm is te klein om de Cabineo's van linker- en rechtervak (Ø15-pockets) vrij van elkaar te houden — maak de kast dieper of kies blinde dado.`,
    );
  }
  if (cellW < MIN_CELL_WIDTH) {
    warnings.push(
      `Vakbreedte ${cellW} mm is kleiner dan ${MIN_CELL_WIDTH} mm — verminder het aantal kolommen of vergroot de breedte.`,
    );
  }

  return {
    config,
    snap,
    snappedWidth: W,
    cellWidth: cellW,
    moduleCount,
    moduleHeights,
    shelfPartLength: shelfLen,
    panels,
    cells,
    ghostShelves,
    feet,
    bodyBase,
    hardware,
    warnings,
  };
}

function engrave(id: string, length: number, width: number, side: Side): TextOp {
  return {
    kind: "text",
    layer: "GRAVURE",
    side,
    x: length / 2,
    y: width / 2,
    text: id,
    height: Math.min(20, width / 3),
  };
}
