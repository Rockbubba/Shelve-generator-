/**
 * Minimale DXF-writer (AC1015 / DXF 2000) voor CNC-output.
 * - Gesloten LWPOLYLINEs voor contouren en pockets
 * - CIRCLE voor boringen, TEXT voor gravures
 * - Lagen per bewerking; side-B-bewerkingen (paneel omklappen over de lange
 *   zijde) komen gespiegeld op een laag met suffix `_B`.
 * - Eenheden: millimeters ($INSUNITS = 4)
 */

import { NestedSheet, Placement } from "./nesting";
import { Operation, Panel } from "./model";

const BASE_LAYER_COLORS: Record<string, number> = {
  PLAATRAND: 9,
  CONTOUR: 7,
  DADO_7MM: 1,
  BOOR_8MM: 5,
  BOOR_5MM: 4,
  CABINEO_12MM: 6,
  RUG_SPONNING: 3,
  GRAVURE: 8,
};

/** Kleur op basis van de laagnaam zonder diepte-/zijde-suffixen. */
function layerColor(name: string): number {
  const base = name.replace(/(_D[0-9_]+|_DOOR|_B)+$/, "");
  return BASE_LAYER_COLORS[base] ?? 7;
}

/**
 * Volledige laagnaam voor een bewerking. Freesdiepte reist in DXF alleen via
 * de laagconventie mee, dus boringen krijgen een diepte-suffix:
 * `_D15` = 15 mm diep vanaf het vlak, `_DOOR` = doorlopend. Pockets dragen de
 * diepte al in hun naam (DADO_7MM, CABINEO_12MM, RUG_SPONNING = 10 mm).
 * Suffix `_B` = tweede zijde (onderdeel omklappen over de lange zijde).
 */
export function operationLayer(op: Operation): string {
  let name: string = op.layer;
  if (op.kind === "circle") {
    name += op.through ? "_DOOR" : `_D${String(op.depth).replace(".", "_")}`;
  }
  if (op.side === "B") name += "_B";
  return name;
}

class DxfBuilder {
  private lines: string[] = [];
  private handle = 0x100;
  private usedLayers = new Set<string>();

  private nextHandle(): string {
    return (this.handle++).toString(16).toUpperCase();
  }

  private push(...pairs: (string | number)[]) {
    for (const p of pairs) this.lines.push(String(p));
  }

  polyline(layer: string, points: [number, number][], closed = true) {
    this.usedLayers.add(layer);
    this.push(0, "LWPOLYLINE", 5, this.nextHandle(), 100, "AcDbEntity", 8, layer);
    this.push(100, "AcDbPolyline", 90, points.length, 70, closed ? 1 : 0);
    for (const [x, y] of points) {
      this.push(10, fmt(x), 20, fmt(y));
    }
  }

  circle(layer: string, cx: number, cy: number, radius: number) {
    this.usedLayers.add(layer);
    this.push(0, "CIRCLE", 5, this.nextHandle(), 100, "AcDbEntity", 8, layer);
    this.push(100, "AcDbCircle", 10, fmt(cx), 20, fmt(cy), 30, 0, 40, fmt(radius));
  }

  text(layer: string, x: number, y: number, height: number, value: string) {
    this.usedLayers.add(layer);
    this.push(0, "TEXT", 5, this.nextHandle(), 100, "AcDbEntity", 8, layer);
    this.push(
      100, "AcDbText",
      10, fmt(x), 20, fmt(y), 30, 0,
      40, fmt(height),
      1, value,
      72, 1, // horizontaal gecentreerd
      11, fmt(x), 21, fmt(y), 31, 0,
    );
    this.push(100, "AcDbText", 73, 2); // verticaal gecentreerd
  }

  build(): string {
    const out: string[] = [];
    const push = (...pairs: (string | number)[]) => {
      for (const p of pairs) out.push(String(p));
    };

    // HEADER
    push(0, "SECTION", 2, "HEADER");
    push(9, "$ACADVER", 1, "AC1015");
    push(9, "$INSUNITS", 70, 4); // millimeters
    push(9, "$HANDSEED", 5, "FFFF");
    push(0, "ENDSEC");

    // TABLES: LTYPE (CONTINUOUS) + LAYER
    push(0, "SECTION", 2, "TABLES");
    push(0, "TABLE", 2, "LTYPE", 5, "8", 100, "AcDbSymbolTable", 70, 1);
    push(
      0, "LTYPE", 5, "9", 100, "AcDbSymbolTableRecord", 100, "AcDbLinetypeTableRecord",
      2, "CONTINUOUS", 70, 0, 3, "Solid line", 72, 65, 73, 0, 40, 0,
    );
    push(0, "ENDTAB");
    const layers = Array.from(this.usedLayers).sort();
    push(0, "TABLE", 2, "LAYER", 5, "A", 100, "AcDbSymbolTable", 70, layers.length);
    let layerHandle = 0x10;
    for (const name of layers) {
      push(
        0, "LAYER", 5, (layerHandle++).toString(16).toUpperCase(),
        100, "AcDbSymbolTableRecord", 100, "AcDbLayerTableRecord",
        2, name, 70, 0, 62, layerColor(name), 6, "CONTINUOUS",
      );
    }
    push(0, "ENDTAB");
    push(0, "ENDSEC");

    // BLOCKS (leeg) + ENTITIES
    push(0, "SECTION", 2, "BLOCKS", 0, "ENDSEC");
    push(0, "SECTION", 2, "ENTITIES");
    out.push(...this.lines);
    push(0, "ENDSEC");
    push(0, "EOF");
    return out.join("\n");
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

function opPoint(
  placement: Placement,
  x: number,
  y: number,
  side: "A" | "B",
): [number, number] {
  const localY = side === "B" ? placement.width - y : y;
  return [placement.x + x, placement.y + localY];
}

function emitOperation(dxf: DxfBuilder, placement: Placement, op: Operation) {
  const layer = operationLayer(op);
  if (op.kind === "rect") {
    const p1 = opPoint(placement, op.x, op.y, op.side);
    const p2 = opPoint(placement, op.x + op.w, op.y + op.h, op.side);
    const [x0, x1] = [Math.min(p1[0], p2[0]), Math.max(p1[0], p2[0])];
    const [y0, y1] = [Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1])];
    dxf.polyline(layer, [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]);
  } else if (op.kind === "circle") {
    const [cx, cy] = opPoint(placement, op.cx, op.cy, op.side);
    dxf.circle(layer, cx, cy, op.diameter / 2);
  } else {
    const [x, y] = opPoint(placement, op.x, op.y, op.side);
    dxf.text(layer, x, y, op.height, op.text);
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
    const contour = panelContour(placement.panel).map(
      ([x, y]) => [placement.x + x, placement.y + y] as [number, number],
    );
    dxf.polyline("CONTOUR", contour);
    for (const op of placement.panel.ops) {
      emitOperation(dxf, placement, op);
    }
  }
  return dxf.build();
}

export function sheetFileName(sheet: NestedSheet): string {
  const prefix = sheet.material === "hdf4" ? "hdf" : "plaat";
  return `${prefix}-${sheet.index + 1}.dxf`;
}
