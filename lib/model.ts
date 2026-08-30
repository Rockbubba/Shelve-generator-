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
  CABINEO_POCKET_DEPTH,
  CABINEO_POCKET_HEIGHT,
  CABINEO_POCKET_WIDTH,
  CABINEOS_PER_JOINT,
  HDF_THICKNESS,
  KERF,
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
  | "CABINEO_12MM"
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

export type Operation = RectOp | CircleOp | TextOp;

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
  place: Placement3D;
  module: number;
}

export interface CellInfo {
  key: string;
  module: number;
  col: number;
  row: number;
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
  hardware: HardwareItem[];
  warnings: string[];
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

// ---- Hoofdfunctie -----------------------------------------------------------

export function buildCabinetModel(config: CabinetConfig): CabinetModel {
  const warnings: string[] = [];
  const { columns, rows, depth: D, joinery, thickness: t } = config;

  const snap = snapWidth(config);
  const W = snap.snappedWidth;
  const cellW = snap.cellWidth;
  const shelfLen = snap.shelfPartLength;

  // Modules: hoger dan MAX_MODULE_HEIGHT wordt gestapeld.
  const moduleCount = Math.max(1, Math.ceil(config.height / MAX_MODULE_HEIGHT));
  const moduleHeights: number[] = [];
  for (let m = 0; m < moduleCount; m++) {
    moduleHeights.push(round1(config.height / moduleCount));
  }

  const panels: Panel[] = [];
  const cells: CellInfo[] = [];
  const notchLen = DADO_FRONT_STOP + TOOL_RADIUS; // hoekinkeping plank

  let staanderNo = 0;
  let plankNo = 0;
  let rugNo = 0;
  let dowelJoints = 0;
  let cabineoJoints = 0;
  let rugCellCount = 0;

  let moduleBase = 0;
  for (let m = 0; m < moduleCount; m++) {
    const Hm = moduleHeights[m];
    const plinthOffset = m === 0 && config.base === "plint" ? PLINTH_HEIGHT : 0;

    // Plankniveaus binnen de module: onderste + tussenliggende + bovenste.
    // levelY[j] = onderkant van plank j (j = 0..rows).
    const innerSpan = Hm - plinthOffset - 2 * t;
    const cellH = round1((innerSpan - (rows - 1) * t) / rows);
    const levelY: number[] = [];
    for (let j = 0; j <= rows; j++) {
      levelY.push(
        j === rows ? Hm - t : plinthOffset + j * (cellH + t),
      );
    }

    if (cellH < MIN_CELL_HEIGHT) {
      warnings.push(
        `Module ${m + 1}: vakhoogte ${cellH} mm is kleiner dan ${MIN_CELL_HEIGHT} mm — verminder het aantal rijen of vergroot de hoogte.`,
      );
    }

    // Vakken (voor raycast-toggles en rugpanelen).
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        const fill = cellFillFor(config, m, c, r);
        if (fill === "rug") rugCellCount++;
        cells.push({
          key: cellKey(m, c, r),
          module: m,
          col: c,
          row: r,
          fill,
          x: c * (cellW + t) + t,
          y: moduleBase + levelY[r] + t,
          z: 0,
          w: cellW,
          h: cellH,
          d: D,
        });
      }
    }

    // ---- Staanders ----------------------------------------------------------
    for (let i = 0; i <= columns; i++) {
      staanderNo++;
      const id = `S${staanderNo}`;
      const ops: Operation[] = [];
      // Side A = vlak richting +x (rechts), side B = richting -x (links).
      const sides: Side[] = [];
      if (i < columns) sides.push("A");
      if (i > 0) sides.push("B");

      for (const side of sides) {
        for (let j = 0; j <= rows; j++) {
          if (joinery === "dado") {
            // Blinde dado: 7 mm diep, breedte = plaatdikte, stopt 30 mm vóór voorzijde.
            ops.push({
              kind: "rect",
              layer: "DADO_7MM",
              side,
              x: levelY[j],
              y: 0,
              w: t,
              h: D - DADO_FRONT_STOP,
              depth: DADO_DEPTH,
            });
            // Deuvelgat Ø8 in de dadobodem (montageborging).
            ops.push({
              kind: "circle",
              layer: "BOOR_8MM",
              side,
              cx: levelY[j] + t / 2,
              cy: (D - DADO_FRONT_STOP) / 2,
              diameter: DOWEL_DIAMETER,
              depth: DADO_DEPTH + 8,
              through: false,
            });
            dowelJoints++;
          } else {
            // Cabineo: doorlopende boutgaten Ø5 in het staandervlak.
            for (let k = 0; k < CABINEOS_PER_JOINT; k++) {
              const cy = k === 0 ? 60 : D - 60;
              ops.push({
                kind: "circle",
                layer: "BOOR_5MM",
                side,
                cx: levelY[j] + t / 2,
                cy,
                diameter: CABINEO_BOLT_DIAMETER,
                depth: t,
                through: true,
              });
            }
            cabineoJoints++;
          }
        }

        // RUG_SPONNING: verticale groef per rug-vak aan deze zijde.
        const colOfSide = side === "A" ? i : i - 1;
        for (let r = 0; r < rows; r++) {
          if (cellFillFor(config, m, colOfSide, r) !== "rug") continue;
          const cellBottom = levelY[r] + t;
          ops.push({
            kind: "rect",
            layer: "RUG_SPONNING",
            side,
            x: cellBottom - RUG_GROOVE_DEPTH,
            y: RUG_GROOVE_BACK_OFFSET - RUG_GROOVE_WIDTH / 2,
            w: cellH + 2 * RUG_GROOVE_DEPTH,
            h: RUG_GROOVE_WIDTH,
            depth: RUG_GROOVE_DEPTH,
          });
        }
      }

      ops.push(engrave(id, Hm, D));

      panels.push({
        id,
        type: "staander",
        material: "plaat18",
        length: Hm,
        width: D,
        thickness: t,
        ops,
        notches: [],
        place: {
          x: i * (cellW + t),
          y: moduleBase,
          z: 0,
          w: t,
          h: Hm,
          d: D,
        },
        module: m,
      });
    }

    // ---- Planken ------------------------------------------------------------
    const dadoInset = joinery === "dado" ? DADO_DEPTH : 0;
    for (let c = 0; c < columns; c++) {
      for (let j = 0; j <= rows; j++) {
        plankNo++;
        const id = `P${plankNo}`;
        const ops: Operation[] = [];
        const notches: { x: number; y: number; w: number; h: number }[] = [];

        if (joinery === "dado") {
          // Hoekinkepingen: dado stopt 30 mm vóór de voorzijde, dus de
          // plankhoeken worden 7 × (30 + freesradius) ingekeept.
          notches.push({ x: 0, y: D - notchLen, w: DADO_DEPTH, h: notchLen });
          notches.push({
            x: shelfLen - DADO_DEPTH,
            y: D - notchLen,
            w: DADO_DEPTH,
            h: notchLen,
          });
          // Deuvelgat Ø8 per naad in het plankvlak (blind, onderzijde).
          for (const cx of [DADO_DEPTH / 2, shelfLen - DADO_DEPTH / 2]) {
            ops.push({
              kind: "circle",
              layer: "BOOR_8MM",
              side: "B",
              cx,
              cy: (D - DADO_FRONT_STOP) / 2,
              diameter: DOWEL_DIAMETER,
              depth: 10,
              through: false,
            });
          }
        } else {
          // Cabineo-pockets in het plankvlak (onderzijde, tegen elk uiteinde).
          for (const end of [0, 1]) {
            for (let k = 0; k < CABINEOS_PER_JOINT; k++) {
              const cy = k === 0 ? 60 : D - 60;
              const x0 = end === 0 ? 0 : shelfLen - CABINEO_POCKET_HEIGHT;
              ops.push({
                kind: "rect",
                layer: "CABINEO_12MM",
                side: "B",
                x: x0,
                y: cy - CABINEO_POCKET_WIDTH / 2,
                w: CABINEO_POCKET_HEIGHT,
                h: CABINEO_POCKET_WIDTH,
                depth: CABINEO_POCKET_DEPTH,
              });
            }
          }
        }

        // RUG_SPONNING in de plank: bovenvlak voor het vak erboven,
        // ondervlak voor het vak eronder.
        const rugAbove = j < rows && cellFillFor(config, m, c, j) === "rug";
        const rugBelow = j > 0 && cellFillFor(config, m, c, j - 1) === "rug";
        for (const [has, side] of [
          [rugAbove, "A"],
          [rugBelow, "B"],
        ] as [boolean, Side][]) {
          if (!has) continue;
          ops.push({
            kind: "rect",
            layer: "RUG_SPONNING",
            side,
            x: 0,
            y: RUG_GROOVE_BACK_OFFSET - RUG_GROOVE_WIDTH / 2,
            w: shelfLen,
            h: RUG_GROOVE_WIDTH,
            depth: RUG_GROOVE_DEPTH,
          });
        }

        ops.push(engrave(id, shelfLen, D));

        panels.push({
          id,
          type: "plank",
          material: "plaat18",
          length: shelfLen,
          width: D,
          thickness: t,
          ops,
          notches,
          place: {
            x: c * (cellW + t) + t - dadoInset,
            y: moduleBase + levelY[j],
            z: 0,
            w: shelfLen,
            h: t,
            d: D,
          },
          module: m,
        });
      }
    }

    // ---- Rugpanelen (HDF) ---------------------------------------------------
    for (let c = 0; c < columns; c++) {
      for (let r = 0; r < rows; r++) {
        if (cellFillFor(config, m, c, r) !== "rug") continue;
        rugNo++;
        const id = `R${rugNo}`;
        const rw = round1(cellW + 2 * (RUG_GROOVE_DEPTH - RUG_CLEARANCE));
        const rh = round1(cellH + 2 * (RUG_GROOVE_DEPTH - RUG_CLEARANCE));
        panels.push({
          id,
          type: "rug",
          material: "hdf4",
          length: Math.max(rw, rh),
          width: Math.min(rw, rh),
          thickness: HDF_THICKNESS,
          ops: [engrave(id, Math.max(rw, rh), Math.min(rw, rh))],
          notches: [],
          place: {
            x: c * (cellW + t) + t - (RUG_GROOVE_DEPTH - RUG_CLEARANCE),
            y: moduleBase + levelY[r] + t - (RUG_GROOVE_DEPTH - RUG_CLEARANCE),
            z: RUG_GROOVE_BACK_OFFSET - HDF_THICKNESS / 2,
            w: rw,
            h: rh,
            d: HDF_THICKNESS,
          },
          module: m,
        });
      }
    }

    moduleBase += Hm;
  }

  // ---- Plint ----------------------------------------------------------------
  if (config.base === "plint") {
    const plintLen = round1(W - 2 * t - 2);
    panels.push({
      id: "PL1",
      type: "plint",
      material: "plaat18",
      length: plintLen,
      width: PLINTH_HEIGHT,
      thickness: t,
      ops: [engrave("PL1", plintLen, PLINTH_HEIGHT)],
      notches: [],
      place: {
        x: t + 1,
        y: 0,
        z: D - PLINTH_SETBACK - t,
        w: plintLen,
        h: PLINTH_HEIGHT,
        d: t,
      },
      module: 0,
    });
  }

  // ---- Hardware -------------------------------------------------------------
  const hardware: HardwareItem[] = [];
  if (joinery === "dado") {
    hardware.push({ name: "Deuvel Ø8 × 35 mm", qty: dowelJoints, unit: "stuks" });
    hardware.push({ name: "Houtlijm (D3)", qty: 1, unit: "fles" });
  } else {
    hardware.push({
      name: "Lamello Cabineo 8",
      qty: cabineoJoints * CABINEOS_PER_JOINT,
      unit: "stuks",
    });
  }
  if (rugCellCount > 0) {
    hardware.push({ name: "HDF rugpaneel 4 mm (gefreesd)", qty: rugCellCount, unit: "stuks" });
  }
  hardware.push({ name: "L-beugel muurbevestiging", qty: 2, unit: "stuks" });
  if (config.base === "pootjes") {
    const feet = Math.max(4, 2 * Math.ceil(W / 600));
    hardware.push({ name: "Verstelbaar pootje", qty: feet, unit: "stuks" });
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
    hardware,
    warnings,
  };
}

function engrave(id: string, length: number, width: number): TextOp {
  return {
    kind: "text",
    layer: "GRAVURE",
    side: "A",
    x: length / 2,
    y: width / 2,
    text: id,
    height: Math.min(20, width / 3),
  };
}
