import { describe, expect, it } from "vitest";
import {
  CabinetConfig,
  DEFAULT_CONFIG,
  KERF,
  MAX_PART_LENGTH,
  SHEET_LENGTH,
  SHEET_MARGIN,
  SHEET_WIDTH,
  depthOption,
} from "../config";
import { buildCabinetModel, CircleOp, RectOp } from "../model";
import { nestPanels } from "../nesting";
import { panelContour, sheetToDxf } from "../dxf";

/** Acceptatiekast: 1800 × 2000 × ~398, 4 kolommen × 5 rijen. */
const ACCEPT: CabinetConfig = {
  ...DEFAULT_CONFIG,
  depth: depthOption(3),
  width: 1800,
  height: 2000,
  columns: 4,
  rows: 5,
  base: "geen",
  cellFills: {},
};

describe("parametrisch model (acceptatiecriterium 1)", () => {
  const model = buildCabinetModel(ACCEPT);

  it("genereert het juiste aantal panelen", () => {
    const staanders = model.panels.filter((p) => p.type === "staander");
    const planken = model.panels.filter((p) => p.type === "plank");
    expect(staanders).toHaveLength(5); // 4 kolommen → 5 staanders
    expect(planken).toHaveLength(4 * 6); // 5 rijen → 6 plankniveaus per kolom
  });

  it("dado-posities in staander en plankposities kloppen wederzijds", () => {
    const staander = model.panels.find((p) => p.id === "S2")!; // binnenstaander
    const dados = staander.ops.filter(
      (op): op is RectOp => op.kind === "rect" && op.layer === "DADO_7MM",
    );
    // Binnenstaander: dado's aan beide zijden op elk plankniveau.
    expect(dados).toHaveLength(2 * 6);

    const plankYs = new Set(
      model.panels
        .filter((p) => p.type === "plank")
        .map((p) => Math.round(p.place.y * 10) / 10),
    );
    for (const dado of dados) {
      // Dado-onderkant (lokale x in de staander) = onderkant van de plank.
      expect(plankYs.has(Math.round(dado.x * 10) / 10)).toBe(true);
      // Breedte van de dado = plaatdikte.
      expect(dado.w).toBeCloseTo(ACCEPT.thickness, 5);
    }
  });

  it("plank steekt precies de dadodiepte in beide staanders", () => {
    const plank = model.panels.find((p) => p.type === "plank")!;
    expect(plank.length).toBeCloseTo(model.cellWidth + 14, 1);
    // Plank begint 7 mm binnen de staander.
    const col0Staander = model.panels.find((p) => p.id === "S1")!;
    expect(plank.place.x).toBeCloseTo(
      col0Staander.place.x + ACCEPT.thickness - 7,
      1,
    );
  });

  it("hoekinkepingen voor de blinde dado zitten aan de voorzijde", () => {
    const plank = model.panels.find((p) => p.type === "plank")!;
    expect(plank.notches).toHaveLength(2);
    for (const n of plank.notches) {
      expect(n.y + n.h).toBeCloseTo(plank.width, 5);
      expect(n.w).toBeCloseTo(7, 5);
    }
  });

  it("breedte-snapping: dichtbij een exacte strookvulling wordt stilletjes gesnapt", () => {
    // 5 planken van 477.6 + 4 freesbanen vullen 2420 exact → kastbreedte 1944.4.
    const near = buildCabinetModel({ ...ACCEPT, width: 1950 });
    expect(near.snap.snapped).toBe(true);
    expect(Math.abs(near.snappedWidth - 1950)).toBeLessThanOrEqual(12);
    const m = near.snap.shelvesPerStrip;
    expect(m * near.shelfPartLength + (m - 1) * KERF).toBeCloseTo(2420, 0);
  });

  it("breedte-snapping: ver van een strookgrens blijft de gevraagde maat staan", () => {
    expect(model.snap.snapped).toBe(false);
    expect(model.snappedWidth).toBe(1800);
    expect(model.snap.stripLeftover).toBeGreaterThan(0);
  });
});

describe("wissel dado ↔ cabineo (acceptatiecriterium 5)", () => {
  it("verandert bewerkingen én hardware consistent", () => {
    const dado = buildCabinetModel({ ...ACCEPT, joinery: "dado" });
    const cab = buildCabinetModel({ ...ACCEPT, joinery: "cabineo" });

    expect(
      dado.panels.some((p) => p.ops.some((o) => o.layer === "DADO_7MM")),
    ).toBe(true);
    expect(
      cab.panels.some((p) => p.ops.some((o) => o.layer === "DADO_7MM")),
    ).toBe(false);
    expect(
      cab.panels.some((p) => p.ops.some((o) => o.layer === "CABINEO_12MM")),
    ).toBe(true);

    expect(dado.hardware.some((h) => h.name.startsWith("Deuvel"))).toBe(true);
    expect(cab.hardware.some((h) => h.name.includes("Cabineo"))).toBe(true);
    expect(cab.hardware.some((h) => h.name.startsWith("Deuvel"))).toBe(false);

    // Cabineo-planken hebben geen tongen en geen inkepingen.
    const cabPlank = cab.panels.find((p) => p.type === "plank")!;
    expect(cabPlank.notches).toHaveLength(0);
    expect(cabPlank.length).toBeCloseTo(cab.cellWidth, 1);
  });
});

describe("nesting (acceptatiecriterium 2)", () => {
  const model = buildCabinetModel(ACCEPT);
  const nesting = nestPanels(model.panels, ACCEPT.depth);

  it("nest alle 18mm-onderdelen zonder fouten", () => {
    expect(nesting.errors).toHaveLength(0);
    const placed = nesting.sheets.flatMap((s) => s.placements).length;
    const parts = model.panels.filter((p) => p.material === "plaat18").length;
    expect(placed).toBe(parts);
  });

  it("respecteert plaatranden en freesbanen", () => {
    for (const sheet of nesting.sheets) {
      const byStrip = new Map<number, typeof sheet.placements>();
      for (const pl of sheet.placements) {
        expect(pl.x).toBeGreaterThanOrEqual(SHEET_MARGIN - 0.01);
        expect(pl.y).toBeGreaterThanOrEqual(SHEET_MARGIN - 0.01);
        expect(pl.x + pl.length).toBeLessThanOrEqual(SHEET_LENGTH - SHEET_MARGIN + 0.01);
        expect(pl.y + pl.width).toBeLessThanOrEqual(SHEET_WIDTH - SHEET_MARGIN + 0.01);
        const list = byStrip.get(pl.y) ?? [];
        list.push(pl);
        byStrip.set(pl.y, list);
      }
      // Freesbaan tussen opeenvolgende onderdelen in dezelfde strook.
      for (const list of byStrip.values()) {
        const sorted = [...list].sort((a, b) => a.x - b.x);
        for (let i = 1; i < sorted.length; i++) {
          const gap = sorted[i].x - (sorted[i - 1].x + sorted[i - 1].length);
          expect(gap).toBeGreaterThanOrEqual(KERF - 0.01);
        }
      }
    }
  });

  it("geen onderdeel langer dan 2420 mm", () => {
    for (const p of model.panels) {
      expect(p.length).toBeLessThanOrEqual(MAX_PART_LENGTH);
    }
  });

  it("berekent een plausibele yield", () => {
    expect(nesting.yieldPercent).toBeGreaterThan(40);
    expect(nesting.yieldPercent).toBeLessThanOrEqual(100);
  });
});

describe("dxf-output (acceptatiecriterium 3)", () => {
  const model = buildCabinetModel(ACCEPT);
  const nesting = nestPanels(model.panels, ACCEPT.depth);
  const dxf = sheetToDxf(nesting.sheets[0]);

  it("bevat header, lagen en gesloten polylines in mm", () => {
    expect(dxf).toContain("$ACADVER");
    expect(dxf).toContain("AC1015");
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toContain("CONTOUR");
    expect(dxf).toContain("DADO_7MM");
    expect(dxf).toContain("GRAVURE");
    expect(dxf).toContain("LWPOLYLINE");
    expect(dxf.trim().endsWith("EOF")).toBe(true);
  });

  it("boorlagen dragen de freesdiepte in de laagnaam", () => {
    const all = nesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    // Staander: deuvelgat in de dadobodem, 15 mm diep.
    expect(all).toContain("BOOR_8MM_D15");
    // Plank: blind deuvelgat in het plankvlak, 10 mm diep — planken liggen
    // ondersteboven op het bed, dus dit is een eerste-zijde-laag.
    expect(all).toContain("BOOR_8MM_D10");
    expect(all).not.toContain("BOOR_8MM_D10_B");
    // Geen ongesuffixte boorlaag meer: dieptes mogen niet mengen.
    expect(all).not.toMatch(/^BOOR_8MM$/m);
    expect(all).not.toMatch(/^BOOR_8MM_B$/m);
  });

  it("cabineo-boutgaten staan op een doorloop-laag", () => {
    const cab = buildCabinetModel({ ...ACCEPT, joinery: "cabineo" });
    const cabNesting = nestPanels(cab.panels, ACCEPT.depth);
    const all = cabNesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).toContain("BOOR_5MM_DOOR");
    expect(all).toContain("CABINEO_12MM");
  });

  it("plankcontour heeft 8 punten (2 hoekinkepingen)", () => {
    const plank = model.panels.find((p) => p.type === "plank")!;
    const contour = panelContour(plank);
    expect(contour).toHaveLength(8);
    // Contour blijft binnen het onderdeel.
    for (const [x, y] of contour) {
      expect(x).toBeGreaterThanOrEqual(-0.01);
      expect(x).toBeLessThanOrEqual(plank.length + 0.01);
      expect(y).toBeGreaterThanOrEqual(-0.01);
      expect(y).toBeLessThanOrEqual(plank.width + 0.01);
    }
  });

  it("staandercontour is een rechthoek", () => {
    const staander = model.panels.find((p) => p.type === "staander")!;
    expect(panelContour(staander)).toHaveLength(4);
  });
});

describe("éénzijdig frezen", () => {
  it("planken hebben alle bewerkingen op de onderzijde (geen omklappen)", () => {
    const model = buildCabinetModel(ACCEPT); // default: rug geschroefd
    for (const p of model.panels.filter((x) => x.type === "plank")) {
      expect(p.machineSide).toBe("B");
      expect(p.ops.every((op) => op.side === "B")).toBe(true);
    }
  });

  it("cabineo-kast is volledig éénzijdig", () => {
    const cab = buildCabinetModel({ ...ACCEPT, joinery: "cabineo" });
    const cabNesting = nestPanels(cab.panels, ACCEPT.depth);
    const all = cabNesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).not.toMatch(/_B$/m);
    // Boutgaten van linker- en rechtervak raken elkaar niet: verschillende
    // randafstanden per staanderzijde.
    const inner = cab.panels.find((p) => p.id === "S2")!;
    const edges = new Set(
      inner.ops
        .filter((op): op is CircleOp => op.kind === "circle")
        .map((op) => Math.min(op.cy, ACCEPT.depth - op.cy).toFixed(0)),
    );
    expect(edges.size).toBe(2);
  });

  it("alleen binnenstaanders met blinde dado's vergen een tweede zijde", () => {
    const model = buildCabinetModel(ACCEPT);
    for (const p of model.panels) {
      const twoSided = p.ops.some((op) => op.side !== p.machineSide);
      if (twoSided) {
        expect(p.type).toBe("staander");
        expect(["S1", `S${ACCEPT.columns + 1}`]).not.toContain(p.id);
      }
    }
  });

  it("rug in sponning geeft groeven, geschroefd geeft schroeven", () => {
    const spon = buildCabinetModel({ ...ACCEPT, rugMount: "sponning" });
    const schroef = buildCabinetModel({ ...ACCEPT, rugMount: "geschroefd" });
    expect(
      spon.panels.some((p) => p.ops.some((o) => o.layer === "RUG_SPONNING")),
    ).toBe(true);
    expect(
      schroef.panels.some((p) => p.ops.some((o) => o.layer === "RUG_SPONNING")),
    ).toBe(false);
    expect(schroef.hardware.some((h) => h.name.includes("Spaanplaatschroef"))).toBe(true);
    expect(spon.hardware.some((h) => h.name.includes("Spaanplaatschroef"))).toBe(false);
  });
});

describe("stabiliteit en modules", () => {
  it("waarschuwt zonder rug en zonder muurbevestiging", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      wallMount: false,
      cellFills: Object.fromEntries(
        Array.from({ length: 4 * 5 }, (_, i) => [
          `0:${i % 4}:${Math.floor(i / 4)}`,
          "open" as const,
        ]),
      ),
    });
    expect(model.warnings.some((w) => w.includes("schranken"))).toBe(true);
  });

  it("splitst hoge kasten in modules", () => {
    const model = buildCabinetModel({ ...ACCEPT, height: 3000 });
    expect(model.moduleCount).toBe(2);
    const staanders = model.panels.filter((p) => p.type === "staander");
    expect(staanders).toHaveLength(10);
    for (const s of staanders) {
      expect(s.length).toBeLessThanOrEqual(2400);
    }
  });
});
