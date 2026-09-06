/**
 * Minimale DXF-writer (AC1009 / R12) voor CNC-output.
 * R12 is het meest universeel leesbare DXF-formaat: VCarve, Fusion,
 * Illustrator en vrijwel elke CAM-/tekenapplicatie openen het.
 * - Gesloten POLYLINEs voor contouren en pockets
 * - CIRCLE voor boringen, TEXT voor gravures
 * - Lagen per bewerking; tweede-zijde-bewerkingen komen gespiegeld op een
 *   laag met suffix `_B`.
 * - Eenheden: millimeters ($INSUNITS = 4; R12-lezers zonder deze header
 *   vragen zelf om de eenheid — kies mm)
 */

import { NestedSheet, Placement } from "./nesting";
import { Operation, Panel } from "./model";

const BASE_LAYER_COLORS: Record<string, number> = {
  PLAATRAND: 9,
  CONTOUR: 7,
  DADO_7MM: 1,
  BOOR_8MM: 5,
  BOOR_5MM: 4,
  BOOR_5_5MM: 4,
  BOOR_15MM: 5,
  CABINEO_11MM: 6,
  RUG_SPONNING: 3,
  GRAVURE: 8,
};

/** Kleur op basis van de laagnaam zonder diepte-/zijde-suffixen. */
function layerColor(name: string): number {
  const base = name.replace(/(_D[0-9_]+|_DOOR|_B)+$/, "");
  return BASE_LAYER_COLORS[base] ?? 7;
}

/**
 * Bewerking omgerekend naar het "bed-frame": het coördinatenstelsel van het
 * onderdeel zoals het op het CNC-bed ligt, met de `machineSide` boven.
 * Planken liggen ondersteboven (spiegelen over de korte zijde); staanders
 * met alleen B-bewerkingen liggen omgekeerd (lange zijde). Bewerkingen op de
 * andere zijde komen op `_B`-lagen: het onderdeel wordt daarvoor omgeklapt
 * over dezelfde as.
 *
 * Freesdiepte reist in DXF alleen via de laagconventie mee, dus boringen
 * krijgen een diepte-suffix: `_D15` = 15 mm diep vanaf het vlak,
 * `_DOOR` = doorlopend. Pockets dragen de diepte al in hun naam
 * (DADO_7MM, CABINEO_11MM, RUG_SPONNING = 10 mm).
 */
export type BedOp =
  | { kind: "rect"; layer: string; secondary: boolean; x: number; y: number; w: number; h: number; radius: number }
  | { kind: "path"; layer: string; secondary: boolean; points: [number, number][] }
  | { kind: "circle"; layer: string; secondary: boolean; cx: number; cy: number; r: number }
  | { kind: "text"; layer: string; secondary: boolean; x: number; y: number; height: number; text: string };

/** As waarover dit paneel wordt omgeklapt voor de tweede zijde. */
export function flipAxis(panel: Panel): "kort" | "lang" {
  return panel.type === "plank" || panel.type === "plint" ? "kort" : "lang";
}

/**
 * Buitencontour in het bed-frame: gespiegeld over de flip-as wanneer het
 * onderdeel met zijde B boven ligt (planken ondersteboven). Voor symmetrische
 * rechthoeken verandert er niets; voor geprofileerde voorranden wél.
 */
export function panelContourInBedFrame(panel: Panel): [number, number][] {
  const pts = panelContour(panel);
  if (panel.machineSide !== "B") return pts;
  const L = panel.length;
  const W = panel.width;
  return flipAxis(panel) === "kort"
    ? pts.map(([x, y]) => [L - x, y] as [number, number])
    : pts.map(([x, y]) => [x, W - y] as [number, number]);
}

export function panelOpsInBedFrame(panel: Panel): BedOp[] {
  const L = panel.length;
  const W = panel.width;
  const short = flipAxis(panel) === "kort";

  return panel.ops.map((op) => {
    const secondary = op.side !== panel.machineSide;
    // Aantal spiegelingen: één om de B-zijde boven te leggen, plus één
    // voor bewerkingen op de andere zijde (omklappen). Twee = identiteit.
    const flips = (panel.machineSide === "B" ? 1 : 0) + (secondary ? 1 : 0);
    const mirror = flips % 2 === 1;

    let layer: string = op.layer;
    if (op.kind === "circle") {
      layer += op.through ? "_DOOR" : `_D${String(op.depth).replace(".", "_")}`;
    }
    if (secondary) layer += "_B";

    if (op.kind === "rect") {
      let { x, y } = op;
      if (mirror) {
        if (short) x = L - x - op.w;
        else y = W - y - op.h;
      }
      return {
        kind: "rect",
        layer,
        secondary,
        x,
        y,
        w: op.w,
        h: op.h,
        radius: op.radius ?? 0,
      };
    }
    if (op.kind === "circle") {
      let { cx, cy } = op;
      if (mirror) {
        if (short) cx = L - cx;
        else cy = W - cy;
      }
      return { kind: "circle", layer, secondary, cx, cy, r: op.diameter / 2 };
    }
    if (op.kind === "path") {
      const points = op.points.map(
        ([px, py]) =>
          (mirror
            ? short
              ? [L - px, py]
              : [px, W - py]
            : [px, py]) as [number, number],
      );
      return { kind: "path", layer, secondary, points };
    }
    let { x, y } = op;
    if (mirror) {
      if (short) x = L - x;
      else y = W - y;
    }
    return { kind: "text", layer, secondary, x, y, height: op.height, text: op.text };
  });
}

class DxfBuilder {
  private lines: string[] = [];
  private usedLayers = new Set<string>();

  private push(...pairs: (string | number)[]) {
    for (const p of pairs) this.lines.push(String(p));
  }

  polyline(layer: string, points: [number, number][], closed = true) {
    this.usedLayers.add(layer);
    this.push(0, "POLYLINE", 8, layer, 66, 1, 70, closed ? 1 : 0);
    this.push(10, 0, 20, 0, 30, 0);
    for (const [x, y] of points) {
      this.push(0, "VERTEX", 8, layer, 10, fmt(x), 20, fmt(y), 30, 0);
    }
    this.push(0, "SEQEND", 8, layer);
  }

  circle(layer: string, cx: number, cy: number, radius: number) {
    this.usedLayers.add(layer);
    this.push(0, "CIRCLE", 8, layer, 10, fmt(cx), 20, fmt(cy), 30, 0, 40, fmt(radius));
  }

  text(layer: string, x: number, y: number, height: number, value: string) {
    this.usedLayers.add(layer);
    this.push(
      0, "TEXT", 8, layer,
      10, fmt(x), 20, fmt(y), 30, 0,
      40, fmt(height),
      1, value,
      72, 1, // horizontaal gecentreerd
      11, fmt(x), 21, fmt(y), 31, 0,
      73, 2, // verticaal gecentreerd
    );
  }

  build(): string {
    const out: string[] = [];
    const push = (...pairs: (string | number)[]) => {
      for (const p of pairs) out.push(String(p));
    };

    // HEADER
    push(0, "SECTION", 2, "HEADER");
    push(9, "$ACADVER", 1, "AC1009");
    push(9, "$INSUNITS", 70, 4); // millimeters
    push(0, "ENDSEC");

    // TABLES: LTYPE (CONTINUOUS) + LAYER
    push(0, "SECTION", 2, "TABLES");
    push(0, "TABLE", 2, "LTYPE", 70, 1);
    push(0, "LTYPE", 2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0);
    push(0, "ENDTAB");
    const layers = Array.from(this.usedLayers).sort();
    push(0, "TABLE", 2, "LAYER", 70, layers.length);
    for (const name of layers) {
      push(0, "LAYER", 2, name, 70, 0, 62, layerColor(name), 6, "CONTINUOUS");
    }
    push(0, "ENDTAB");
    push(0, "ENDSEC");

    // ENTITIES
    push(0, "SECTION", 2, "ENTITIES");
    out.push(...this.lines);
    push(0, "ENDSEC");
    push(0, "EOF");
    return out.join("\r\n");
  }
}

function fmt(v: number): string {
  return (Math.round(v * 1000) / 1000).toString();
}

/**
 * Contour van een paneel: rechthoek met eventuele inkepingen die de bovenrand
 * (voorzijde, lokaal y = width) raken. We lopen linksom: onderrand, rechter
 * rand, dan de bovenrand van rechts naar links waarbij elke inkeping wordt
 * gevolgd, en sluiten via de linkerrand. Gesloten polyline.
 */
export function panelContour(panel: Panel): [number, number][] {
  if (panel.contour) return panel.contour;
  const L = panel.length;
  const W = panel.width;
  const eps = 0.001;
  const notches = panel.notches
    .filter((n) => Math.abs(n.y + n.h - W) < 0.01)
    .sort((a, b) => b.x - a.x); // van rechts naar links

  const pts: [number, number][] = [
    [0, 0],
    [L, 0],
  ];

  let cursorX = L; // huidige positie op de bovenrand
  for (const n of notches) {
    const x0 = n.x;
    const x1 = n.x + n.w;
    if (x1 < cursorX - eps) {
      // Eerst omhoog/langs de bovenrand tot de rechterkant van de inkeping.
      if (cursorX === L) pts.push([L, W]);
      pts.push([x1, W]);
    }
    pts.push([x1, W - n.h]);
    pts.push([x0, W - n.h]);
    if (x0 > eps) pts.push([x0, W]);
    cursorX = x0;
  }
  if (cursorX > eps) {
    if (cursorX === L) pts.push([L, W]);
    pts.push([0, W]);
  }
  return pts;
}

/**
 * Gesloten contour van een (afgeronde) rechthoek, linksom. Hoekbogen worden
 * gepolygoniseerd zodat elke DXF-lezer (ook Illustrator) ze exact overneemt.
 */
export function roundedRectContour(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  segmentsPerCorner = 8,
): [number, number][] {
  const r = Math.min(radius, w / 2, h / 2);
  if (r <= 0.01) {
    return [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ];
  }
  const corners: [number, number, number][] = [
    [x + w - r, y + r, -90], // rechtsonder
    [x + w - r, y + h - r, 0], // rechtsboven
    [x + r, y + h - r, 90], // linksboven
    [x + r, y + r, 180], // linksonder
  ];
  const pts: [number, number][] = [];
  for (const [cx, cy, startDeg] of corners) {
    for (let i = 0; i <= segmentsPerCorner; i++) {
      const a = ((startDeg + (90 * i) / segmentsPerCorner) * Math.PI) / 180;
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

function emitBedOp(dxf: DxfBuilder, placement: Placement, op: BedOp) {
  if (op.kind === "rect") {
    dxf.polyline(
      op.layer,
      roundedRectContour(
        placement.x + op.x,
        placement.y + op.y,
        op.w,
        op.h,
        op.radius,
      ),
    );
  } else if (op.kind === "path") {
    dxf.polyline(
      op.layer,
      op.points.map(
        ([px, py]) => [placement.x + px, placement.y + py] as [number, number],
      ),
    );
  } else if (op.kind === "circle") {
    dxf.circle(op.layer, placement.x + op.cx, placement.y + op.cy, op.r);
  } else {
    dxf.text(op.layer, placement.x + op.x, placement.y + op.y, op.height, op.text);
  }
}

/** Genereer de DXF-inhoud voor één geneste plaat. */
export function sheetToDxf(sheet: NestedSheet): string {
  const dxf = new DxfBuilder();

  // Plaatrand als referentie (niet frezen).
  dxf.polyline("PLAATRAND", [
    [0, 0],
    [sheet.sheetLength, 0],
    [sheet.sheetLength, sheet.sheetWidth],
    [0, sheet.sheetWidth],
  ]);

  for (const placement of sheet.placements) {
    const contour = panelContourInBedFrame(placement.panel).map(
      ([x, y]) => [placement.x + x, placement.y + y] as [number, number],
    );
    dxf.polyline("CONTOUR", contour);
    for (const op of panelOpsInBedFrame(placement.panel)) {
      emitBedOp(dxf, placement, op);
    }
  }
  return dxf.build();
}

export function sheetFileName(sheet: NestedSheet): string {
  const prefix = sheet.material === "hdf4" ? "hdf" : "plaat";
  return `${prefix}-${sheet.index + 1}.dxf`;
}
