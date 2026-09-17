/**
 * Werktekening van de complete kast: voor-, linker zij- en bovenaanzicht
 * volgens de Europese projectiemethode (ISO 128: zijaanzicht rechts van
 * het vooraanzicht, bovenaanzicht eronder), volledig bemaat, met kader en
 * titelblok op A3 liggend. Optioneel een 3D-afbeelding uit de viewer.
 *
 * De tekening wordt eerst opgebouwd als neutrale primitieven in
 * papiercoördinaten (mm, y omlaag) en daarna omgezet naar SVG (scherm,
 * print/PDF) of DXF (CAD).
 */

import { materialById } from "./config";
import { DxfBuilder } from "./dxf";
import { CabinetModel, Panel } from "./model";

// ---- Papier -----------------------------------------------------------------

/** A3 liggend, marges en titelblok in mm. */
export const PAPER = { width: 420, height: 297, margin: 10 } as const;
const TITLE_BLOCK = { width: 170, height: 42 } as const;

/** Toegestane tekeningschalen (1 : n), oplopend; de grootste passende wint. */
export const DRAWING_SCALES = [2, 2.5, 4, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50];

/** Tekststrengen in papier-mm. */
const TEXT = { maat: 2.5, cel: 2.2, titel: 4, kop: 3.2, blok: 2.3 } as const;
/** Bemating: afstand tussen maatlijnen en tot het object. */
const DIM = { first: 8, step: 8, gap: 1.5, over: 2, tick: 1.2 } as const;

// ---- Primitieven --------------------------------------------------------------

export type DrawingLayer = "KADER" | "CONTOUR" | "VERBORGEN" | "MAAT" | "TEKST";

export interface DrawingPoly {
  layer: DrawingLayer;
  points: [number, number][];
  closed: boolean;
}

export interface DrawingText {
  layer: DrawingLayer;
  x: number;
  y: number;
  /** Letterhoogte in papier-mm. */
  size: number;
  text: string;
  anchor: "start" | "middle" | "end";
  /** Rotatie in graden, linksom (0 = horizontaal). */
  rotation?: number;
  bold?: boolean;
}

export interface DrawingImage {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Data-URL (PNG). */
  href: string;
}

export interface DrawingView {
  name: string;
  /** Kader van het aanzicht in papiercoördinaten (zonder bemating). */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Drawing {
  width: number;
  height: number;
  /** Schaal 1 : n. */
  scale: number;
  polys: DrawingPoly[];
  texts: DrawingText[];
  images: DrawingImage[];
  views: DrawingView[];
  /** Alle maatgetallen (voor tests en overzicht). */
  dimensions: { view: string; value: number }[];
}

export interface DrawingOptions {
  /** PNG data-URL van de 3D-weergave voor het titelblok-vak. */
  snapshot?: string | null;
  /** Naam van het ontwerp (titelblok). */
  title?: string;
  /** Datum (standaard vandaag). */
  date?: Date;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const fmtMm = (v: number) => {
  const r = r1(v);
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace(".", ",");
};

/** Geschatte tekstbreedte in papier-mm (sans-serif, ~0,55 × letterhoogte). */
function textWidth(text: string, size: number): number {
  return text.length * size * 0.55;
}

class DrawingBuilder {
  polys: DrawingPoly[] = [];
  texts: DrawingText[] = [];
  images: DrawingImage[] = [];
  views: DrawingView[] = [];
  dimensions: { view: string; value: number }[] = [];
  private currentView = "";

  beginView(name: string) {
    this.currentView = name;
  }

  poly(layer: DrawingLayer, points: [number, number][], closed = true) {
    if (points.length < 2) return;
    this.polys.push({ layer, points: points.map(([x, y]) => [r1(x * 10) / 10, r1(y * 10) / 10]), closed });
  }

  rect(layer: DrawingLayer, x: number, y: number, w: number, h: number) {
    if (w <= 0 || h <= 0) return;
    this.poly(layer, [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ]);
  }

  line(layer: DrawingLayer, x1: number, y1: number, x2: number, y2: number) {
    this.poly(layer, [[x1, y1], [x2, y2]], false);
  }

  text(
    layer: DrawingLayer,
    x: number,
    y: number,
    size: number,
    text: string,
    anchor: DrawingText["anchor"] = "middle",
    extra: Partial<Pick<DrawingText, "rotation" | "bold">> = {},
  ) {
    this.texts.push({ layer, x: r1(x * 10) / 10, y: r1(y * 10) / 10, size, text, anchor, ...extra });
  }

  /**
   * Horizontale maat tussen x1 en x2. `yObj` is de rand van het object waar
   * de hulplijnen beginnen; de maatlijn ligt op `yLine`. Tekst boven de lijn.
   */
  dimH(x1: number, x2: number, yObj: number, yLine: number, value: number, label = fmtMm(value)) {
    const [a, b] = x1 <= x2 ? [x1, x2] : [x2, x1];
    const dir = yLine < yObj ? -1 : 1; // hulplijnen lopen van object naar maatlijn
    for (const x of [a, b]) {
      this.line("MAAT", x, yObj + dir * DIM.gap, x, yLine + dir * DIM.over);
    }
    this.line("MAAT", a - DIM.over, yLine, b + DIM.over, yLine);
    // Schuine streepjes (45°) op de eindpunten.
    for (const x of [a, b]) {
      this.line("MAAT", x - DIM.tick, yLine + DIM.tick, x + DIM.tick, yLine - DIM.tick);
    }
    const w = textWidth(label, TEXT.maat);
    const inside = w + 1 <= b - a;
    // Past de tekst niet tussen de hulplijnen, dan rechts ernaast.
    this.text("MAAT", inside ? (a + b) / 2 : b + DIM.over + 1, yLine - 0.8, TEXT.maat, label, inside ? "middle" : "start");
    this.dimensions.push({ view: this.currentView, value: r1(value) });
  }

  /**
   * Verticale maat tussen y1 en y2; maatlijn op `xLine`, hulplijnen vanaf
   * `xObj`. Tekst gedraaid, leesbaar van rechts (ISO), links van de lijn.
   */
  dimV(y1: number, y2: number, xObj: number, xLine: number, value: number, label = fmtMm(value)) {
    const [a, b] = y1 <= y2 ? [y1, y2] : [y2, y1];
    const dir = xLine < xObj ? -1 : 1;
    for (const y of [a, b]) {
      this.line("MAAT", xObj + dir * DIM.gap, y, xLine + dir * DIM.over, y);
    }
    this.line("MAAT", xLine, a - DIM.over, xLine, b + DIM.over);
    for (const y of [a, b]) {
      this.line("MAAT", xLine - DIM.tick, y + DIM.tick, xLine + DIM.tick, y - DIM.tick);
    }
    const w = textWidth(label, TEXT.maat);
    const inside = w + 1 <= b - a;
    this.text(
      "MAAT",
      xLine - 0.8,
      inside ? (a + b) / 2 : a - DIM.over - 1,
      TEXT.maat,
      label,
      inside ? "middle" : "start",
      { rotation: 90 },
    );
    this.dimensions.push({ view: this.currentView, value: r1(value) });
  }
}

// ---- Hulpfuncties geometrie ----------------------------------------------------

/** Polygoon beperken tot xmin ≤ x ≤ xmax (Sutherland–Hodgman). */
function clipX(points: [number, number][], xmin: number, xmax: number): [number, number][] {
  const clip = (pts: [number, number][], inside: (p: [number, number]) => boolean, at: number) => {
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i];
      const prev = pts[(i + pts.length - 1) % pts.length];
      const cIn = inside(cur);
      const pIn = inside(prev);
      if (cIn !== pIn) {
        const t = (at - prev[0]) / (cur[0] - prev[0]);
        out.push([at, prev[1] + (cur[1] - prev[1]) * t]);
      }
      if (cIn) out.push(cur);
    }
    return out;
  };
  let pts = clip(points, (p) => p[0] >= xmin - 1e-6, xmin);
  pts = clip(pts, (p) => p[0] <= xmax + 1e-6, xmax);
  return pts;
}

/** Hoekpunten van een rugpaneel in het bovenaanzicht (x, z), incl. yaw. */
function rugFootprint(p: Panel): [number, number][] {
  const cx = p.place.x + p.place.w / 2;
  const cz = p.place.z + p.place.d / 2;
  const hw = p.place.w / 2;
  const hd = p.place.d / 2;
  const yaw = p.yaw ?? 0;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const corners: [number, number][] = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  // Rotatie om de verticale as (three.js Y-rotatie): x' = x·cos + z·sin, z' = −x·sin + z·cos.
  return corners.map(([dx, dz]) => [cx + dx * c + dz * s, cz - dx * s + dz * c]);
}

/** Openingen van een vak tussen de tussenschotten, als [x, breedte]. */
function cellOpenings(model: CabinetModel, cell: CabinetModel["cells"][number]): [number, number][] {
  const schotten = model.panels
    .filter((p) => p.type === "schot" && p.dividerKey?.startsWith(`div:${cell.key}:`))
    .sort((a, b) => a.place.x - b.place.x);
  const out: [number, number][] = [];
  let x = cell.x;
  for (const s of schotten) {
    out.push([x, s.place.x - x]);
    x = s.place.x + s.place.w;
  }
  out.push([x, cell.x + cell.w - x]);
  return out.filter(([, w]) => w > 0.5);
}

// ---- Opbouw ------------------------------------------------------------------

interface Layout {
  scale: number;
  s: number;
  front: { ox: number; oy: number };
  side: { ox: number; oy: number };
  top: { ox: number; oy: number };
  /** Vak rechtsonder boven het titelblok voor de 3D-afbeelding. */
  imageBox: { x: number; y: number; w: number; h: number } | null;
}

/** Ruimte rondom de aanzichten voor bemating en labels (papier-mm). */
const SPACE = {
  frontLeft: 30, // hoogteketen + totale hoogte
  frontTop: 12, // totale breedte
  frontBottom: 20, // kolomopeningen + label
  gap: 26, // tussen voor- en zijaanzicht / voor- en bovenaanzicht
  sideRight: 20, // hoogte + plinthoogte
  sideTop: 12,
  topBottom: 10, // label
  topRight: 20, // diepte rechts
} as const;

function chooseLayout(model: CabinetModel): Layout {
  const W = model.snappedWidth;
  const H = model.config.height;
  const D = model.config.depth;
  const inner = { w: PAPER.width - 2 * PAPER.margin, h: PAPER.height - 2 * PAPER.margin };

  for (const scale of DRAWING_SCALES) {
    const s = 1 / scale;
    const leftCol = SPACE.frontLeft + W * s + SPACE.gap;
    const rightCol = Math.max(D * s + SPACE.sideRight, TITLE_BLOCK.width);
    const topRow = SPACE.frontTop + H * s + SPACE.frontBottom;
    const bottomRow = Math.max(D * s + SPACE.topBottom + 6, TITLE_BLOCK.height);
    if (leftCol + rightCol <= inner.w && topRow + bottomRow <= inner.h) {
      const x0 = PAPER.margin;
      const y0 = PAPER.margin;
      const frontOx = x0 + SPACE.frontLeft;
      const frontOy = y0 + SPACE.frontTop + H * s; // vloerlijn
      const sideOx = frontOx + W * s + SPACE.gap;
      const topOy = frontOy + SPACE.frontBottom + 6; // achterrand
      const right = PAPER.width - PAPER.margin;
      const bottom = PAPER.height - PAPER.margin;
      // Afbeelding: onder het zijaanzicht, boven het titelblok, rechts uitgelijnd.
      const imgTop = frontOy + DIM.first + 12;
      const imgBottom = bottom - TITLE_BLOCK.height - 4;
      const imgH = imgBottom - imgTop;
      const imgW = Math.min(right - (sideOx + D * s + SPACE.sideRight), 140);
      const size = Math.min(imgH, imgW);
      const imageBox =
        size >= 28 ? { x: right - size, y: imgBottom - size, w: size, h: size } : null;
      return {
        scale,
        s,
        front: { ox: frontOx, oy: frontOy },
        side: { ox: sideOx, oy: frontOy },
        top: { ox: frontOx, oy: topOy },
        imageBox,
      };
    }
  }
  // Onwaarschijnlijk (kast > 20 m): kleinste schaal, laat het overlopen.
  const scale = DRAWING_SCALES[DRAWING_SCALES.length - 1];
  const s = 1 / scale;
  return {
    scale,
    s,
    front: { ox: PAPER.margin + SPACE.frontLeft, oy: PAPER.margin + SPACE.frontTop + H * s },
    side: { ox: PAPER.margin + SPACE.frontLeft + W * s + SPACE.gap, oy: PAPER.margin + SPACE.frontTop + H * s },
    top: { ox: PAPER.margin + SPACE.frontLeft, oy: PAPER.margin + SPACE.frontTop + H * s + SPACE.frontBottom + 6 },
    imageBox: null,
  };
}

function drawFront(b: DrawingBuilder, model: CabinetModel, L: Layout) {
  const { s } = L;
  const { ox, oy } = L.front;
  const X = (x: number) => ox + x * s;
  const Y = (y: number) => oy - y * s;
  const W = model.snappedWidth;
  const H = model.config.height;
  b.beginView("voor");
  b.views.push({ name: "Vooraanzicht", x: X(0), y: Y(H), w: W * s, h: H * s });

  // Zichtbare onderdelen: staanders, planken, schotten, plint, deuren, poten.
  for (const p of model.panels) {
    if (p.type === "rug") continue;
    b.rect("CONTOUR", X(p.place.x), Y(p.place.y + p.place.h), p.place.w * s, p.place.h * s);
    if (p.type === "deur") {
      // Draaisymbool: lijnen vanuit de hoeken aan de greepzijde naar het
      // midden van de scharnierzijde (scharnieren aan de buitenkant van de
      // kast, zie doorHingeLeft in model.ts).
      const hingeLeft = p.place.x + p.place.w / 2 < W / 2;
      const xh = hingeLeft ? p.place.x : p.place.x + p.place.w;
      const xg = hingeLeft ? p.place.x + p.place.w : p.place.x;
      const ym = p.place.y + p.place.h / 2;
      b.line("VERBORGEN", X(xg), Y(p.place.y), X(xh), Y(ym));
      b.line("VERBORGEN", X(xg), Y(p.place.y + p.place.h), X(xh), Y(ym));
    }
  }
  for (const f of model.feet) {
    b.rect("CONTOUR", X(f.place.x), Y(f.place.y + f.place.h), f.place.w * s, f.place.h * s);
  }

  // Binnenmaat per opening (b × h) in elk vak; in een smalle opening (bij
  // tussenschotten) alleen de breedte, of niets als ook dat niet past.
  for (const cell of model.cells) {
    if (cell.h * s < 4) continue;
    for (const [x, w] of cellOpenings(model, cell)) {
      for (const label of [`${fmtMm(w)} × ${fmtMm(cell.h)}`, fmtMm(w)]) {
        const size = Math.min(TEXT.cel, (w * s - 1) / textWidth(label, 1));
        if (size < 1.4) continue;
        b.text("TEKST", X(x + w / 2), Y(cell.y + cell.h / 2) + size * 0.35, size, label);
        break;
      }
    }
  }

  // Bemating: totale breedte boven; kolomopeningen (onderste rij, eerste
  // module) onder; vakhoogtes van de eerste kolom en totale hoogte links.
  const topLine = Y(H) - DIM.first;
  b.dimH(X(0), X(W), Y(H), topLine, W);

  const bottomCells = model.cells
    .filter((c) => c.module === 0 && c.row === 0)
    .sort((a, b2) => a.x - b2.x);
  const bottomLine = Y(0) + DIM.first;
  for (const c of bottomCells) {
    b.dimH(X(c.x), X(c.x + c.w), Y(0), bottomLine, c.w);
  }

  const firstCol = model.cells
    .filter((c) => c.col === 0)
    .sort((a, b2) => a.y - b2.y);
  const chainLine = X(0) - DIM.first;
  for (const c of firstCol) {
    b.dimV(Y(c.y), Y(c.y + c.h), X(0), chainLine, c.h);
  }
  // Onderbouw (plint of poten) als eerste schakel van de keten.
  if (model.bodyBase > 0) {
    b.dimV(Y(0), Y(model.bodyBase), X(0), chainLine, model.bodyBase);
  } else if (model.config.base === "plint" && firstCol.length > 0 && firstCol[0].y > 1) {
    b.dimV(Y(0), Y(firstCol[0].y), X(0), chainLine, firstCol[0].y);
  }
  b.dimV(Y(0), Y(H), X(0), chainLine - DIM.step, H);

  b.text("TEKST", X(W / 2), bottomLine + 7, TEXT.kop, "Vooraanzicht", "middle", { bold: true });
}

function drawSide(b: DrawingBuilder, model: CabinetModel, L: Layout) {
  const { s } = L;
  const { ox, oy } = L.side;
  const X = (z: number) => ox + z * s; // z = 0 (muur) links, voorkant rechts
  const Y = (y: number) => oy - y * s;
  const H = model.config.height;
  const D = model.config.depth;
  b.beginView("zij");
  b.views.push({ name: "Linker zijaanzicht", x: X(0), y: Y(H), w: D * s, h: H * s });

  const staanders = model.panels.filter((p) => p.type === "staander");
  const minX = Math.min(...staanders.map((p) => p.place.x));
  const outer = staanders.filter((p) => Math.abs(p.place.x - minX) < 0.5);
  for (const p of outer) {
    if (p.contour) {
      // Contour: u = hoogte, v = diepte (vanaf de achterkant van de staander).
      b.poly(
        "CONTOUR",
        p.contour.map(([u, v]) => [X(p.place.z + v), Y(p.place.y + u)] as [number, number]),
      );
    } else {
      b.rect("CONTOUR", X(p.place.z), Y(p.place.y + p.place.h), p.place.d * s, p.place.h * s);
    }
  }
  for (const f of model.feet) {
    b.rect("CONTOUR", X(f.place.z), Y(f.place.y + f.place.h), f.place.d * s, f.place.h * s);
  }

  // Verborgen: planken, schotten, rug en plint van de eerste kolom.
  const firstOpeningX = minX + (outer[0]?.place.w ?? model.config.thickness);
  for (const p of model.panels) {
    if (p.type === "staander") continue;
    if (p.type === "plint") {
      b.rect("VERBORGEN", X(p.place.z), Y(p.place.y + p.place.h), p.place.d * s, p.place.h * s);
      continue;
    }
    if (p.place.x > firstOpeningX + 1) continue;
    b.rect("VERBORGEN", X(p.place.z), Y(p.place.y + p.place.h), p.place.d * s, p.place.h * s);
  }

  // Bemating: diepte boven (incl. inkorting links), hoogte rechts, plint.
  const zMin = Math.min(...outer.map((p) => p.place.z));
  const zMax = Math.max(...outer.map((p) => p.place.z + p.place.d));
  const topLine = Y(H) - DIM.first;
  b.dimH(X(zMin), X(zMax), Y(H), topLine, zMax - zMin);
  const rightLine = X(zMax) + DIM.first;
  b.dimV(Y(0), Y(H), X(zMax), rightLine, H);

  const plint = model.panels.find((p) => p.type === "plint");
  if (plint) {
    const setback = zMax - (plint.place.z + plint.place.d);
    const plintLine = Y(0) + DIM.first;
    if (setback > 0.5) {
      b.dimH(X(plint.place.z + plint.place.d), X(zMax), Y(0), plintLine, setback);
    }
    b.dimV(Y(plint.place.y), Y(plint.place.y + plint.place.h), X(zMin), X(zMin) - DIM.first, plint.place.h);
  } else if (model.bodyBase > 0) {
    b.dimV(Y(0), Y(model.bodyBase), X(zMin), X(zMin) - DIM.first, model.bodyBase);
  }

  b.text("TEKST", X(D / 2), Y(0) + DIM.first + 7, TEXT.kop, "Linker zijaanzicht", "middle", { bold: true });
}

function drawTop(b: DrawingBuilder, model: CabinetModel, L: Layout) {
  const { s } = L;
  const { ox, oy } = L.top;
  const X = (x: number) => ox + x * s;
  const Y = (z: number) => oy + z * s; // achterkant boven, voorkant onder
  const W = model.snappedWidth;
  const D = model.config.depth;
  b.beginView("boven");
  b.views.push({ name: "Bovenaanzicht", x: X(0), y: Y(0), w: W * s, h: D * s });

  const staanders = model.panels.filter((p) => p.type === "staander");
  const topY = Math.max(...staanders.map((p) => p.place.y + p.place.h));
  const topStaanders = staanders.filter((p) => p.place.y + p.place.h > topY - 1);
  const planks = model.panels.filter((p) => p.type === "plank");
  const plankTop = Math.max(...planks.map((p) => p.place.y + p.place.h));
  const topPlanks = planks.filter((p) => p.place.y + p.place.h > plankTop - 1);

  // Bovenplanken, beperkt tot de opening tussen de staanders (dado-tongen
  // zitten in de staander en zijn niet zichtbaar).
  const sortedStaanders = [...topStaanders].sort((a, c) => a.place.x - c.place.x);
  for (const p of topPlanks) {
    const left = sortedStaanders.filter((st) => st.place.x + st.place.w <= p.place.x + p.place.w / 2).pop();
    const right = sortedStaanders.find((st) => st.place.x >= p.place.x + p.place.w / 2);
    const xmin = left ? left.place.x + left.place.w : p.place.x;
    const xmax = right ? right.place.x : p.place.x + p.place.w;
    const pts: [number, number][] = p.contour
      ? p.contour.map(([cx, cz]) => [p.place.x + cx, p.place.z + cz] as [number, number])
      : [
          [p.place.x, p.place.z],
          [p.place.x + p.place.w, p.place.z],
          [p.place.x + p.place.w, p.place.z + p.place.d],
          [p.place.x, p.place.z + p.place.d],
        ];
    const clipped = clipX(pts, xmin, xmax);
    b.poly("CONTOUR", clipped.map(([x, z]) => [X(x), Y(z)] as [number, number]));
  }
  for (const p of topStaanders) {
    b.rect("CONTOUR", X(p.place.x), Y(p.place.z), p.place.w * s, p.place.d * s);
  }
  // Verborgen: rugpanelen (volgen een eventuele schuine muur).
  for (const p of model.panels) {
    if (p.type !== "rug") continue;
    b.poly("VERBORGEN", rugFootprint(p).map(([x, z]) => [X(x), Y(z)] as [number, number]));
  }

  // Bemating: diepte links en (bij inkorting) rechts; inkorting achter.
  const first = sortedStaanders[0];
  const last = sortedStaanders[sortedStaanders.length - 1];
  if (first && last) {
    const leftLine = X(0) - DIM.first;
    b.dimV(Y(first.place.z), Y(first.place.z + first.place.d), X(0), leftLine, first.place.d);
    const rightLine = X(W) + DIM.first;
    if (Math.abs(last.place.d - first.place.d) > 0.5 || Math.abs(last.place.z - first.place.z) > 0.5) {
      b.dimV(Y(last.place.z), Y(last.place.z + last.place.d), X(W), rightLine, last.place.d);
    }
    const taper = Math.abs(last.place.z - first.place.z);
    if (taper > 0.5) {
      // Verloop van de achterkant t.o.v. de muurlijn (z = 0).
      const deeper = first.place.z > last.place.z ? first : last;
      const xEdge = deeper === first ? X(0) : X(W);
      const line = deeper === first ? leftLine - DIM.step : rightLine + DIM.step;
      b.dimV(Y(0), Y(deeper.place.z), xEdge, line, deeper.place.z);
    }
  }

  b.text("TEKST", X(W / 2), Y(D) + 7, TEXT.kop, "Bovenaanzicht", "middle", { bold: true });
}

function drawFrame(b: DrawingBuilder, model: CabinetModel, L: Layout, opts: DrawingOptions) {
  b.beginView("kader");
  const m = PAPER.margin;
  b.rect("KADER", m, m, PAPER.width - 2 * m, PAPER.height - 2 * m);

  const cfg = model.config;
  const W = model.snappedWidth;
  const bx = PAPER.width - m - TITLE_BLOCK.width;
  const by = PAPER.height - m - TITLE_BLOCK.height;
  b.rect("KADER", bx, by, TITLE_BLOCK.width, TITLE_BLOCK.height);
  const rowH = TITLE_BLOCK.height / 4;
  for (let i = 1; i < 4; i++) b.line("KADER", bx, by + i * rowH, bx + TITLE_BLOCK.width, by + i * rowH);
  const colX = bx + TITLE_BLOCK.width * 0.66;
  b.line("KADER", colX, by + rowH, colX, by + TITLE_BLOCK.height);

  const title = opts.title?.trim() || `Boekenkast ${fmtMm(W)} × ${fmtMm(cfg.height)} × ${fmtMm(cfg.depth)} mm`;
  b.text("TEKST", bx + 3, by + rowH * 0.68, TEXT.titel, title, "start", { bold: true });

  const mat = materialById(cfg.materialId);
  const rug =
    cfg.rugMode === "volledig"
      ? "volledige achterwand HDF 4 mm"
      : model.panels.some((p) => p.type === "rug")
        ? `rug HDF 4 mm (${cfg.rugMount})`
        : "geen rug";
  const base =
    cfg.base === "plint"
      ? `plint ${fmtMm(model.panels.find((p) => p.type === "plint")?.place.h ?? cfg.plinthHeight)} mm, ${cfg.plinthSetback} mm terug`
      : cfg.base === "pootjes"
        ? `pootjes ${cfg.feet.height} mm (${cfg.feet.type})`
        : "geen onderbouw";
  const front =
    cfg.frontProfile.type === "recht"
      ? "voorkant recht"
      : `voorkant ${cfg.frontProfile.type}, ${fmtMm(cfg.frontProfile.amplitude)} mm`;
  const taper =
    cfg.backTaper.left || cfg.backTaper.right
      ? ` · inkorting L ${fmtMm(cfg.backTaper.left)} / R ${fmtMm(cfg.backTaper.right)}`
      : "";
  const left = [
    `${mat.naam} ${fmtMm(cfg.nominalThickness)} mm · ${cfg.joinery === "dado" ? "dado + deuvels" : `Cabineo ${cfg.cabineoSize}`}`,
    `${cfg.columns} × ${cfg.rows} vakken · ${model.moduleCount} module${model.moduleCount > 1 ? "s" : ""} · ${rug} · vakmaten b × h binnen`,
    `${base} · ${front}${taper}`,
  ];
  left.forEach((line, i) => {
    b.text("TEKST", bx + 3, by + rowH * (i + 1) + rowH * 0.68, TEXT.blok, line, "start");
  });
  const date = (opts.date ?? new Date()).toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const right = [
    `Schaal 1:${String(L.scale).replace(".", ",")} · A3`,
    `Maten in mm · ISO 128 (Europees)`,
    `Datum ${date} · Blad 1/1`,
  ];
  right.forEach((line, i) => {
    b.text("TEKST", colX + 3, by + rowH * (i + 1) + rowH * 0.68, TEXT.blok, line, "start");
  });

  if (opts.snapshot && L.imageBox) {
    b.images.push({ ...L.imageBox, href: opts.snapshot });
  }
}

/** Bouw de complete werktekening als primitieven in papiercoördinaten. */
export function buildDrawing(model: CabinetModel, opts: DrawingOptions = {}): Drawing {
  const L = chooseLayout(model);
  const b = new DrawingBuilder();
  drawFront(b, model, L);
  drawSide(b, model, L);
  drawTop(b, model, L);
  drawFrame(b, model, L, opts);
  return {
    width: PAPER.width,
    height: PAPER.height,
    scale: L.scale,
    polys: b.polys,
    texts: b.texts,
    images: b.images,
    views: b.views,
    dimensions: b.dimensions,
  };
}

// ---- SVG ---------------------------------------------------------------------

const SVG_STYLE: Record<DrawingLayer, string> = {
  KADER: 'stroke="#111827" stroke-width="0.5"',
  CONTOUR: 'stroke="#111827" stroke-width="0.4"',
  VERBORGEN: 'stroke="#6b7280" stroke-width="0.2" stroke-dasharray="1.6 0.8"',
  MAAT: 'stroke="#1d4ed8" stroke-width="0.18"',
  TEKST: 'stroke="none"',
};
const SVG_TEXT_FILL: Record<DrawingLayer, string> = {
  KADER: "#111827",
  CONTOUR: "#111827",
  VERBORGEN: "#6b7280",
  MAAT: "#1d4ed8",
  TEKST: "#111827",
};

function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** SVG in mm (viewBox = papier), geschikt voor scherm en A3-print. */
export function drawingToSvg(d: Drawing): string {
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${d.width}mm" height="${d.height}mm" viewBox="0 0 ${d.width} ${d.height}" font-family="system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif">`,
  );
  out.push(`<rect x="0" y="0" width="${d.width}" height="${d.height}" fill="#ffffff"/>`);
  for (const img of d.images) {
    out.push(
      `<image x="${img.x}" y="${img.y}" width="${img.w}" height="${img.h}" preserveAspectRatio="xMidYMid meet" href="${esc(img.href)}"/>`,
    );
  }
  for (const layer of ["VERBORGEN", "CONTOUR", "KADER", "MAAT"] as DrawingLayer[]) {
    const polys = d.polys.filter((p) => p.layer === layer);
    if (polys.length === 0) continue;
    out.push(`<g fill="none" stroke-linejoin="round" stroke-linecap="round" ${SVG_STYLE[layer]}>`);
    for (const p of polys) {
      const pts = p.points.map(([x, y]) => `${x},${y}`).join(" ");
      out.push(p.closed ? `<polygon points="${pts}"/>` : `<polyline points="${pts}"/>`);
    }
    out.push("</g>");
  }
  for (const t of d.texts) {
    const anchor = t.anchor === "middle" ? "middle" : t.anchor === "end" ? "end" : "start";
    const transform = t.rotation ? ` transform="rotate(${-t.rotation} ${t.x} ${t.y})"` : "";
    const weight = t.bold ? ' font-weight="600"' : "";
    out.push(
      `<text x="${t.x}" y="${t.y}" font-size="${t.size}" text-anchor="${anchor}" fill="${SVG_TEXT_FILL[t.layer]}"${weight}${transform}>${esc(t.text)}</text>`,
    );
  }
  out.push("</svg>");
  return out.join("\n");
}

// ---- DXF ---------------------------------------------------------------------

/**
 * DXF van de werktekening (papiercoördinaten in mm, y omhoog), lagen
 * KADER / CONTOUR / VERBORGEN (gestreept) / MAAT / TEKST. Afbeeldingen
 * worden niet meegenomen.
 */
export function drawingToDxf(d: Drawing): string {
  const dxf = new DxfBuilder({ dashedLayers: ["VERBORGEN"] });
  const flip = (y: number) => d.height - y;
  for (const p of d.polys) {
    dxf.polyline(p.layer, p.points.map(([x, y]) => [x, flip(y)] as [number, number]), p.closed);
  }
  for (const t of d.texts) {
    // DXF-tekst is gecentreerd (72 = 1); links/rechts uitgelijnde tekst
    // verschuiven we met de geschatte halve breedte.
    const half = textWidth(t.text, t.size) / 2;
    let x = t.x;
    let y = flip(t.y) + t.size * 0.35;
    if (t.rotation) {
      // Gedraaide tekst (90°): verschuiving langs de as van de tekst.
      const rad = (t.rotation * Math.PI) / 180;
      if (t.anchor === "start") {
        x += Math.cos(rad) * half;
        y += Math.sin(rad) * half;
      } else if (t.anchor === "end") {
        x -= Math.cos(rad) * half;
        y -= Math.sin(rad) * half;
      }
      x -= Math.sin(rad) * t.size * 0.35;
      y = flip(t.y) + Math.cos(rad) * t.size * 0.35;
    } else if (t.anchor === "start") {
      x += half;
    } else if (t.anchor === "end") {
      x -= half;
    }
    dxf.text(t.layer, x, y, t.size, t.text, t.rotation ?? 0);
  }
  return dxf.build();
}

/** Bestandsnaam voor de werktekening. */
export function drawingFileName(model: CabinetModel, ext: "svg" | "dxf"): string {
  return `werktekening-${Math.round(model.snappedWidth)}x${Math.round(model.config.height)}x${Math.round(model.config.depth)}.${ext}`;
}
