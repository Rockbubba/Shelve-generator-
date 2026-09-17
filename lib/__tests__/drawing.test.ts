import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, CabinetConfig } from "../config";
import { buildCabinetModel } from "../model";
import { buildDrawing, drawingToDxf, drawingToSvg, DRAWING_SCALES, PAPER } from "../drawing";

const cfg = (patch: Partial<CabinetConfig> = {}): CabinetConfig => ({ ...DEFAULT_CONFIG, ...patch });

describe("werktekening", () => {
  const model = buildCabinetModel(cfg());
  const d = buildDrawing(model, { date: new Date(2026, 8, 17) });

  it("gebruikt een standaardschaal en past binnen het A3-kader", () => {
    expect(DRAWING_SCALES).toContain(d.scale);
    const m = PAPER.margin;
    for (const p of d.polys) {
      for (const [x, y] of p.points) {
        expect(x, `x ${x}`).toBeGreaterThanOrEqual(m - 0.01);
        expect(x, `x ${x}`).toBeLessThanOrEqual(PAPER.width - m + 0.01);
        expect(y, `y ${y}`).toBeGreaterThanOrEqual(m - 0.01);
        expect(y, `y ${y}`).toBeLessThanOrEqual(PAPER.height - m + 0.01);
      }
    }
    for (const t of d.texts) {
      expect(t.x).toBeGreaterThanOrEqual(m);
      expect(t.x).toBeLessThanOrEqual(PAPER.width - m);
      expect(t.y).toBeGreaterThanOrEqual(m);
      expect(t.y).toBeLessThanOrEqual(PAPER.height - m);
    }
  });

  it("heeft drie aanzichten volgens de Europese methode", () => {
    const names = d.views.map((v) => v.name);
    expect(names).toEqual(["Vooraanzicht", "Linker zijaanzicht", "Bovenaanzicht"]);
    const [front, side, top] = d.views;
    // Zijaanzicht rechts van en uitgelijnd met het vooraanzicht.
    expect(side.x).toBeGreaterThan(front.x + front.w);
    expect(side.y).toBeCloseTo(front.y, 3);
    expect(side.h).toBeCloseTo(front.h, 3);
    // Bovenaanzicht onder en uitgelijnd met het vooraanzicht.
    expect(top.y).toBeGreaterThan(front.y + front.h);
    expect(top.x).toBeCloseTo(front.x, 3);
    expect(top.w).toBeCloseTo(front.w, 3);
    // Schaal klopt met de kastmaten.
    expect(front.w * d.scale).toBeCloseTo(model.snappedWidth, 1);
    expect(front.h * d.scale).toBeCloseTo(model.config.height, 1);
    expect(top.h * d.scale).toBeCloseTo(model.config.depth, 1);
  });

  it("bemaat totale breedte, hoogte, diepte, vakken en plint", () => {
    const vals = (view: string) => d.dimensions.filter((x) => x.view === view).map((x) => x.value);
    expect(vals("voor")).toContain(model.snappedWidth);
    expect(vals("voor")).toContain(model.config.height);
    expect(vals("zij")).toContain(model.config.height);
    expect(vals("zij")).toContain(model.config.depth);
    expect(vals("zij")).toContain(80); // plinthoogte
    expect(vals("zij")).toContain(40); // plint terugliggend
    expect(vals("boven")).toContain(model.config.depth);
    const bottom = model.cells.filter((c) => c.module === 0 && c.row === 0);
    for (const c of bottom) expect(vals("voor")).toContain(Math.round(c.w * 10) / 10);
    const firstCol = model.cells.filter((c) => c.col === 0);
    for (const c of firstCol) expect(vals("voor")).toContain(Math.round(c.h * 10) / 10);
  });

  it("zet in elk vak de binnenmaat", () => {
    const labels = d.texts.filter((t) => t.layer === "TEKST" && t.text.includes("×") && t.size <= 2.2);
    expect(labels.length).toBe(model.cells.length);
    const cell = model.cells[0];
    expect(labels.some((t) => t.text.startsWith(String(Math.round(cell.w * 10) / 10).replace(".", ",")))).toBe(true);
  });

  it("SVG en DXF zijn geldig opgebouwd", () => {
    const svg = drawingToSvg(d);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).toContain('width="420mm"');
    expect(svg).toContain("Vooraanzicht");
    expect(svg).not.toContain("<image");
    const withImage = drawingToSvg(buildDrawing(model, { snapshot: "data:image/png;base64,AAAA" }));
    expect(withImage).toContain("<image");

    const dxf = drawingToDxf(d);
    expect(dxf.startsWith("0\r\nSECTION")).toBe(true);
    expect(dxf.trim().endsWith("EOF")).toBe(true);
    for (const layer of ["KADER", "CONTOUR", "VERBORGEN", "MAAT", "TEKST"]) {
      expect(dxf, layer).toContain(`\r\n8\r\n${layer}\r\n`);
    }
    expect(dxf).toContain("DASHED");
    expect(dxf).not.toContain("NaN");
  });

  it("toont inkorting, verloop en schotten", () => {
    const m2 = buildCabinetModel(
      cfg({
        width: 2400,
        columns: 5,
        backTaper: { left: 0, right: 80 },
        frontProfile: { type: "golf", amplitude: 60, periodes: 2 },
        dividers: { "0:1:0": 2 },
      }),
    );
    const d2 = buildDrawing(m2);
    const boven = d2.dimensions.filter((x) => x.view === "boven").map((x) => x.value);
    // Diepte links (vol) en rechts (ingekort) plus het verloop zelf.
    expect(boven.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...boven)).toBeCloseTo(m2.config.depth, 0);
    const sub = m2.cells.find((c) => c.key === "0:1:0")!;
    const subLabels = d2.texts.filter((t) => t.size <= 2.2 && t.layer === "TEKST");
    // De opgedeelde vak heeft drie openingen; alle andere vakken één.
    expect(subLabels.length).toBe(m2.cells.length + 2);
    expect(sub).toBeTruthy();
  });

  it("pootjes en volledige achterwand", () => {
    const m3 = buildCabinetModel(cfg({ base: "pootjes", rugMode: "volledig", width: 1200, height: 1200, columns: 2, rows: 3 }));
    const d3 = buildDrawing(m3);
    const zij = d3.dimensions.filter((x) => x.view === "zij").map((x) => x.value);
    expect(zij).toContain(m3.config.feet.height);
    expect(d3.polys.some((p) => p.layer === "VERBORGEN")).toBe(true);
  });
});
