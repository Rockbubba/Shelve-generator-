import { describe, expect, it } from "vitest";
import {
  CabinetConfig,
  DEFAULT_CONFIG,
  KERF,
  MAX_PART_LENGTH,
  SHEET_LENGTH,
  SHEET_MARGIN,
  SHEET_WIDTH,
  SHEET_MATERIALS,
  depthOption,
} from "../config";
import {
  buildCabinetModel,
  cabineoPocketContour,
  CircleOp,
  RectOp,
} from "../model";
import { nestPanels } from "../nesting";
import { panelContour, panelContourInBedFrame, placementContour, placementOps, sheetToDxf } from "../dxf";
import { estimateMachining, MACHINE } from "../costing";
import { decodeConfig, encodeConfig, normalizeConfig } from "../storage";

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
      cab.panels.some((p) => p.ops.some((o) => o.layer === "CABINEO_11MM")),
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
  const nesting = nestPanels(model.panels);

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
  const nesting = nestPanels(model.panels);
  const dxf = sheetToDxf(nesting.sheets[0]);

  it("bevat header, lagen en gesloten polylines in mm (R12)", () => {
    expect(dxf).toContain("$ACADVER");
    expect(dxf).toContain("AC1009"); // R12: maximaal compatibel (ook Illustrator)
    expect(dxf).toContain("$INSUNITS");
    expect(dxf).toContain("CONTOUR");
    expect(dxf).toContain("DADO_7MM");
    expect(dxf).toContain("GRAVURE");
    expect(dxf).toContain("POLYLINE");
    expect(dxf).toContain("SEQEND");
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
    expect(all).not.toMatch(/^BOOR_8MM\r?$/m);
    expect(all).not.toMatch(/^BOOR_8MM_B\r?$/m);
  });

  it("cabineo-boutgaten: binnenstaanders doorlopend, buitenstaanders blind", () => {
    const cab = buildCabinetModel({ ...ACCEPT, joinery: "cabineo" });
    const cabNesting = nestPanels(cab.panels);
    const all = cabNesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).toContain("BOOR_5MM_DOOR");
    expect(all).toContain("BOOR_5MM_D8"); // buitenstaanders: blind, officiële diepte
    expect(all).toContain("CABINEO_11MM");

    // Geen doorlopend gat in een buitenwang (zichtbaar van buiten).
    const outerIds = ["S1", `S${ACCEPT.columns + 1}`];
    for (const id of outerIds) {
      const outer = cab.panels.find((p) => p.id === id)!;
      const holes = outer.ops.filter(
        (op): op is CircleOp => op.kind === "circle",
      );
      expect(holes.length).toBeGreaterThan(0);
      expect(holes.every((h) => !h.through)).toBe(true);
    }
    // Binnenstaander: wél doorlopend (uitgang afgedekt door de plank).
    const inner = cab.panels.find((p) => p.id === "S2")!;
    expect(
      inner.ops
        .filter((op): op is CircleOp => op.kind === "circle")
        .every((h) => h.through),
    ).toBe(true);
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

  it("cabineo-pocket volgt het Lamello-maatblad (3 × Ø15 op 3,6/14,8/26)", () => {
    // Variant boor15: drie boringen Ø15 per pocket.
    const boor = buildCabinetModel({
      ...ACCEPT,
      joinery: "cabineo",
      cabineoVariant: "boor15",
    });
    const boorPlank = boor.panels.find((p) => p.type === "plank")!;
    const holes = boorPlank.ops.filter(
      (op): op is CircleOp => op.kind === "circle" && op.layer === "BOOR_15MM",
    );
    expect(holes.length).toBe(3 * 2 * 2); // 3 cirkels × 2 posities × 2 naden
    const leftXs = Array.from(
      new Set(
        holes
          .filter((h) => h.cx < boorPlank.length / 2)
          .map((h) => h.cx),
      ),
    ).sort((a, b) => a - b);
    expect(leftXs).toEqual([3.6, 14.8, 26]);
    for (const h of holes) expect(h.diameter).toBe(15);

    // Gefreesde varianten: exacte verenigingscontour van de drie cirkels.
    for (const variant of ["frees10", "frees12"] as const) {
      const contour = cabineoPocketContour(variant);
      const xs = contour.map(([x]) => x);
      const ys = contour.map(([, y]) => y);
      // Diepste punt = derde cirkel + straal (26 + 7,5), breedte = Ø15.
      expect(Math.max(...xs)).toBeCloseTo(33.5, 1);
      expect(Math.max(...ys)).toBeCloseTo(7.5, 1);
      expect(Math.min(...ys)).toBeCloseTo(-7.5, 1);
      // Aan de naadrand is de opening 2 × 6,6 breed.
      const first = contour[0];
      expect(first[0]).toBeCloseTo(0, 1);
      expect(Math.abs(first[1])).toBeCloseTo(6.6, 1);
    }
    // frees12 heeft rechte brugjes op y = ±6 tussen de cirkels.
    const f12 = cabineoPocketContour("frees12");
    expect(
      f12.some(([x, y]) => Math.abs(y - 6) < 0.05 && Math.abs(x - 8.1) < 0.1),
    ).toBe(true);
    expect(
      f12.some(([x, y]) => Math.abs(y - 6) < 0.05 && Math.abs(x - 10.3) < 0.1),
    ).toBe(true);
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
    const cabNesting = nestPanels(cab.panels);
    const all = cabNesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).not.toMatch(/_B\r?$/m);
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

describe("eigen kastdiepte", () => {
  it("diepte 200 mm nest in 5 stroken en respecteert de marges", () => {
    const model = buildCabinetModel({ ...ACCEPT, depth: 200 });
    const nesting = nestPanels(model.panels);
    expect(nesting.errors).toHaveLength(0);
    for (const p of model.panels.filter((x) => x.material === "plaat18")) {
      expect(p.width).toBeLessThanOrEqual(200);
    }
    // 5 stroken van 200 + 4 freesbanen = 1032 ≤ 1200.
    const ys = new Set(
      nesting.sheets.flatMap((s) => s.placements.map((pl) => pl.y)),
    );
    expect(ys.size).toBeLessThanOrEqual(5);
    for (const sheet of nesting.sheets) {
      for (const pl of sheet.placements) {
        expect(pl.y + pl.width).toBeLessThanOrEqual(SHEET_WIDTH - SHEET_MARGIN + 0.01);
      }
    }
  });

  it("cabineo-posities schalen mee bij ondiepe kasten", () => {
    const model = buildCabinetModel({ ...ACCEPT, depth: 200, joinery: "cabineo" });
    const inner = model.panels.find((p) => p.id === "S2")!;
    const cys = inner.ops
      .filter((op): op is CircleOp => op.kind === "circle")
      .map((op) => op.cy)
      .sort((a, b) => a - b);
    // Vier verdeelde posities (a, b, D−b, D−a), minimaal 20 mm uit elkaar.
    const unique = Array.from(new Set(cys));
    expect(unique.length).toBe(4);
    for (let i = 1; i < unique.length; i++) {
      expect(unique[i] - unique[i - 1]).toBeGreaterThanOrEqual(20);
    }
    expect(model.warnings.some((w) => w.includes("Cabineo"))).toBe(false);
  });

  it("waarschuwt wanneer de diepte te klein is voor cabineo", () => {
    const model = buildCabinetModel({ ...ACCEPT, depth: 130, joinery: "cabineo" });
    expect(model.warnings.some((w) => w.includes("Cabineo"))).toBe(true);
  });
});

describe("materiaal, cabineo-maat en kosten", () => {
  it("cabineo 12 boort 12 mm diep; dikke plaat geeft geen waarschuwing", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      joinery: "cabineo",
      cabineoSize: 12,
      materialId: "multiplex",
      nominalThickness: 21,
      thickness: 21,
    });
    const nesting = nestPanels(model.panels);
    const all = nesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).toContain("BOOR_5MM_D12");
    expect(model.warnings.some((w) => w.includes("Cabineo 12"))).toBe(false);
    expect(model.hardware.some((h) => h.name === "Lamello Cabineo 12")).toBe(true);
  });

  it("cabineo 12 op 18 mm plaat waarschuwt", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      joinery: "cabineo",
      cabineoSize: 12,
    });
    expect(model.warnings.some((w) => w.includes("Cabineo 12"))).toBe(true);
  });

  it("hpl gebruikt Ø5,5-boutgaten (eigen laag)", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      joinery: "cabineo",
      materialId: "hpl",
    });
    const staander = model.panels.find((p) => p.id === "S2")!;
    const holes = staander.ops.filter(
      (op): op is CircleOp => op.kind === "circle",
    );
    expect(holes.every((h) => h.layer === "BOOR_5_5MM")).toBe(true);
    expect(holes.every((h) => Math.abs(h.diameter - 5.5) < 0.01)).toBe(true);
  });

  it("machinetijd-schatting geeft plausibele waardes en rekent prijzen mee", () => {
    const model = buildCabinetModel(ACCEPT);
    const nesting = nestPanels(model.panels);
    const est = estimateMachining(model, nesting, MACHINE, 50);
    expect(est.minutes).toBeGreaterThan(10);
    expect(est.minutes).toBeLessThan(600);
    expect(est.contourMeters).toBeGreaterThan(10);
    expect(est.drillCount).toBeGreaterThan(0);
    expect(est.materialCost).toBe(nesting.sheets.length * 50);
    expect(est.totalCost).toBeCloseTo(est.machineCost + est.materialCost!, 1);

    // Zonder prijs: geen materiaal-/totaalprijs, wel machinetijd.
    const zonder = estimateMachining(model, nesting);
    expect(zonder.materialCost).toBeUndefined();
    expect(zonder.totalCost).toBeUndefined();
  });
});

describe("speelse indeling: planken weglaten", () => {
  it("weggelaten plank verdwijnt incl. dado's en de vakken versmelten", () => {
    const model = buildCabinetModel({ ...ACCEPT, omittedShelves: { "0:1:2": true } });
    const planken = model.panels.filter((p) => p.type === "plank");
    expect(planken).toHaveLength(4 * 6 - 1);

    const dadosOf = (id: string, side: "A" | "B") =>
      model.panels
        .find((p) => p.id === id)!
        .ops.filter(
          (o): o is RectOp => o.kind === "rect" && o.layer === "DADO_7MM" && o.side === side,
        );
    // S2 (i = 1): zijde A grenst aan kolom 1 (plank weg), zijde B aan kolom 0.
    expect(dadosOf("S2", "A")).toHaveLength(5);
    expect(dadosOf("S2", "B")).toHaveLength(6);
    // S3 (i = 2): zijde B grenst aan kolom 1.
    expect(dadosOf("S3", "B")).toHaveLength(5);
    expect(dadosOf("S3", "A")).toHaveLength(6);

    const col1 = model.cells.filter((c) => c.col === 1);
    expect(col1).toHaveLength(4);
    const merged = col1.find((c) => c.rowSpan === 2)!;
    expect(merged.row).toBe(1);
    const single = col1.find((c) => c.row === 0)!;
    expect(merged.h).toBeCloseTo(single.h * 2 + ACCEPT.thickness, 0);

    expect(model.ghostShelves).toHaveLength(1);
    expect(model.ghostShelves[0].key).toBe("0:1:2");
    // Tussenplanken zijn aantikbaar, boven-/onderplank niet.
    expect(planken.filter((p) => p.shelfKey).length).toBe(4 * 4 - 1);
  });
});

describe("vakhoogtes per kolom (plankverschuiving)", () => {
  it("verschuift plank en bijbehorende dado's in één kolom, andere kolommen niet", () => {
    const base = buildCabinetModel(ACCEPT);
    const model = buildCabinetModel({ ...ACCEPT, shelfOffsets: { "0:1:2": 80 } });
    const plankOf = (mdl: typeof base, key: string) =>
      mdl.panels.find((p) => p.shelfKey === key)!;
    expect(plankOf(model, "0:1:2").place.y).toBeCloseTo(plankOf(base, "0:1:2").place.y + 80, 1);
    // Buurkolom ongewijzigd.
    expect(plankOf(model, "0:2:2").place.y).toBeCloseTo(plankOf(base, "0:2:2").place.y, 1);

    // Dado in S2 (zijde A = kolom 1) volgt de plank; zijde B (kolom 0) niet.
    const s2 = model.panels.find((p) => p.id === "S2")!;
    const dadoXs = (side: "A" | "B") =>
      s2.ops
        .filter((o): o is RectOp => o.kind === "rect" && o.layer === "DADO_7MM" && o.side === side)
        .map((o) => Math.round(o.x * 10) / 10)
        .sort((a, b) => a - b);
    const plankY = Math.round(plankOf(model, "0:1:2").place.y * 10) / 10;
    expect(dadoXs("A")).toContain(plankY);
    expect(dadoXs("B")).not.toContain(plankY);

    // Vakken in kolom 1 veranderen mee van hoogte; som blijft gelijk.
    const col1 = model.cells.filter((c) => c.col === 1).sort((a, b) => a.row - b.row);
    const col1Base = base.cells.filter((c) => c.col === 1).sort((a, b) => a.row - b.row);
    expect(col1[1].h).toBeCloseTo(col1Base[1].h + 80, 1);
    expect(col1[2].h).toBeCloseTo(col1Base[2].h - 80, 1);
  });

  it("begrenst de verschuiving op de minimale vakhoogte", () => {
    const model = buildCabinetModel({ ...ACCEPT, shelfOffsets: { "0:0:1": 5000 } });
    const col0 = model.cells.filter((c) => c.col === 0);
    for (const c of col0) expect(c.h).toBeGreaterThanOrEqual(120 - 0.1);
    // Nesting blijft foutloos (planklengtes ongewijzigd).
    expect(nestPanels(model.panels).errors).toHaveLength(0);
  });
});

describe("voorkantprofiel", () => {
  it("golf: staanders krijgen eigen diepte, planken een gebogen contour binnen de strook", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      frontProfile: { type: "golf", amplitude: 80, periodes: 2 },
    });
    const staanders = model.panels.filter((p) => p.type === "staander");
    expect(new Set(staanders.map((s) => s.width)).size).toBeGreaterThan(1);
    for (const s of staanders) {
      expect(s.width).toBeLessThanOrEqual(ACCEPT.depth + 0.01);
      expect(s.width).toBeGreaterThanOrEqual(ACCEPT.depth - 80 - 0.1);
    }

    const plank = model.panels.find((p) => p.type === "plank")!;
    expect(plank.contour).toBeDefined();
    expect(plank.width).toBeLessThanOrEqual(ACCEPT.depth + 0.01);
    // Uiteinden sluiten aan op de staanderdiepte (inkeping = diepte − 34).
    const s1 = model.panels.find((p) => p.id === "S1")!;
    const s2 = model.panels.find((p) => p.id === "S2")!;
    const c = plank.contour!;
    const leftTop = Math.max(...c.filter(([x]) => Math.abs(x) < 0.01).map(([, y]) => y));
    const rightTop = Math.max(
      ...c.filter(([x]) => Math.abs(x - plank.length) < 0.01).map(([, y]) => y),
    );
    expect(Math.abs(leftTop - (s1.width - 34))).toBeLessThan(5);
    expect(Math.abs(rightTop - (s2.width - 34))).toBeLessThan(5);

    // Nesting blijft foutloos; DXF-contour van de ondersteboven liggende
    // plank is over de korte zijde gespiegeld.
    const nesting = nestPanels(model.panels);
    expect(nesting.errors).toHaveLength(0);
    const bed = panelContourInBedFrame(plank);
    expect(
      bed.some(
        ([x, y]) => Math.abs(x - plank.length) < 0.01 && Math.abs(y - leftTop) < 0.01,
      ),
    ).toBe(true);
  });

  it("amplitude wordt begrensd zodat de kast minimaal 120 mm diep blijft", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      frontProfile: { type: "schuin", amplitude: 500, periodes: 1 },
    });
    expect(model.warnings.some((w) => w.includes("Profielamplitude"))).toBe(true);
    for (const s of model.panels.filter((p) => p.type === "staander")) {
      expect(s.width).toBeGreaterThanOrEqual(120 - 0.1);
    }
  });
});

describe("achterzijde: scheve muur en muurplint", () => {
  it("verloop achter: staanders korter naar één kant, planken met schuine achterrand, naden blijven kloppen", () => {
    const model = buildCabinetModel({ ...ACCEPT, backTaper: { left: 0, right: 40 } });
    const s1 = model.panels.find((p) => p.id === "S1")!;
    const s5 = model.panels.find((p) => p.id === "S5")!;
    expect(s1.width).toBeCloseTo(ACCEPT.depth, 0);
    expect(s5.width).toBeCloseTo(ACCEPT.depth - 40, 0);
    expect(s5.place.z).toBeCloseTo(40, 0);
    // Plank: schuine achterrand → contour, breedte ≤ D.
    const plank = model.panels.find((p) => p.type === "plank")!;
    expect(plank.contour).toBeDefined();
    expect(plank.width).toBeLessThanOrEqual(ACCEPT.depth + 0.01);
    // Deuvelgat plank (globaal) valt samen met deuvelgat in de dadobodem van S2.
    const s2 = model.panels.find((p) => p.id === "S2")!;
    const s2Holes = s2.ops
      .filter((o): o is CircleOp => o.kind === "circle" && o.side === "A")
      .map((o) => Math.round((o.cy + s2.place.z) * 10) / 10);
    const plankRightHole = plank.ops.filter(
      (o): o is CircleOp => o.kind === "circle",
    )[1];
    const gPlank = Math.round((plankRightHole.cy + plank.place.z) * 10) / 10;
    expect(s2Holes).toContain(gPlank);
    expect(nestPanels(model.panels).errors).toHaveLength(0);
  });

  it("muurplint: inkeping achter-onder in staanders en ingekorte onderste planken", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      wallSkirting: { height: 100, depth: 20 },
    });
    const s1 = model.panels.find((p) => p.id === "S1")!;
    expect(s1.contour).toBeDefined();
    // Inkeping: 100 hoog × 20 diep aan de achterkant (lokaal y = 0).
    expect(s1.contour!.some(([x, y]) => Math.abs(x - 100) < 0.01 && Math.abs(y - 20) < 0.01)).toBe(true);
    // Onderste plank (y = 0 < 100) is 20 mm smaller, een hogere plank niet.
    const bottom = model.panels.find((p) => p.type === "plank" && p.place.y < 1)!;
    const higher = model.panels.find((p) => p.type === "plank" && p.place.y > 300)!;
    expect(bottom.width).toBeCloseTo(ACCEPT.depth - 20, 0);
    expect(bottom.place.z).toBeCloseTo(20, 0);
    expect(higher.width).toBeCloseTo(ACCEPT.depth, 0);
    // Dado van de onderste naad begint pas achter de inkeping.
    const bottomDado = s1.ops.find(
      (o): o is RectOp => o.kind === "rect" && o.layer === "DADO_7MM" && o.x < 1,
    )!;
    expect(bottomDado.y).toBeCloseTo(20, 0);
  });
});

describe("pootjes en kleur", () => {
  it("pootjes: romp verkort, 2 poten per staander, plaatsingen onder de staanders", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      base: "pootjes",
      feet: { type: "conisch", height: 120, size: 40, color: "#000000" },
    });
    expect(model.bodyBase).toBe(120);
    expect(model.feet).toHaveLength(2 * (ACCEPT.columns + 1));
    const s1 = model.panels.find((p) => p.id === "S1")!;
    expect(s1.place.y).toBe(120);
    expect(s1.length).toBeCloseTo(ACCEPT.height - 120, 0);
    for (const f of model.feet) {
      expect(f.place.h).toBe(120);
      expect(f.type).toBe("conisch");
    }
    expect(model.hardware.some((h) => h.name.startsWith("Pootje") && h.qty === 10)).toBe(true);
  });

  it("schuin profiel spiegelen draait de richting om", () => {
    const a = buildCabinetModel({
      ...ACCEPT,
      frontProfile: { type: "schuin", amplitude: 60, periodes: 1, mirror: false },
    });
    const b = buildCabinetModel({
      ...ACCEPT,
      frontProfile: { type: "schuin", amplitude: 60, periodes: 1, mirror: true },
    });
    const w = (m: typeof a, id: string) => m.panels.find((p) => p.id === id)!.width;
    expect(w(a, "S1")).toBeGreaterThan(w(a, "S5"));
    expect(w(b, "S1")).toBeLessThan(w(b, "S5"));
    expect(w(a, "S1")).toBeCloseTo(w(b, "S5"), 0);
  });
});

describe("kolombreedtes en volledige achterwand", () => {
  it("staander verschuiven verandert de planklengtes van beide buurkolommen", () => {
    const base = buildCabinetModel(ACCEPT);
    const model = buildCabinetModel({ ...ACCEPT, columnOffsets: { "1": 60 } });
    const s2 = model.panels.find((p) => p.id === "S2")!;
    expect(s2.place.x).toBeCloseTo(base.panels.find((p) => p.id === "S2")!.place.x + 60, 1);
    expect(s2.staanderKey).toBe("col:1");
    const plankLen = (mdl: typeof base, col: number) =>
      mdl.panels.find((p) => p.type === "plank" && Math.abs(p.place.x - (mdl.panels.find((s) => s.id === `S${col + 1}`)!.place.x + ACCEPT.thickness - 7)) < 0.6)!.length;
    expect(plankLen(model, 0)).toBeCloseTo(plankLen(base, 0) + 60, 1);
    expect(plankLen(model, 1)).toBeCloseTo(plankLen(base, 1) - 60, 1);
    expect(plankLen(model, 2)).toBeCloseTo(plankLen(base, 2), 1);
    // Buitenstaanders vast, totale breedte gelijk.
    expect(model.panels.find((p) => p.id === "S1")!.place.x).toBe(0);
    expect(model.snappedWidth).toBe(base.snappedWidth);
    expect(nestPanels(model.panels).errors).toHaveLength(0);
  });

  it("kolombreedte wordt begrensd op de minimale vakbreedte", () => {
    const model = buildCabinetModel({ ...ACCEPT, columnOffsets: { "1": -5000, "2": 5000 } });
    for (const c of model.cells) expect(c.w).toBeGreaterThanOrEqual(150 - 0.1);
  });

  it("samengevoegd vak krijgt precies één rugpaneel over de volle hoogte", () => {
    // Kolom 0: rij 0 heeft standaard een rug; plank tussen rij 0 en 1 weg.
    const base = buildCabinetModel(ACCEPT);
    const model = buildCabinetModel({ ...ACCEPT, omittedShelves: { "0:0:1": true } });
    const rugsCol0 = (mdl: typeof base) =>
      mdl.panels.filter((p) => p.type === "rug" && p.place.x < 100);
    expect(rugsCol0(base)).toHaveLength(2); // hoekvak onder + hoekvak boven
    const merged = rugsCol0(model);
    expect(merged).toHaveLength(2);
    const bottom = merged.sort((a, b) => a.place.y - b.place.y)[0];
    const cellH = base.cells.find((c) => c.col === 0 && c.row === 0)!.h;
    expect(bottom.place.h).toBeCloseTo(2 * cellH + ACCEPT.thickness + ACCEPT.thickness, 0);
  });

  it("volledige achterwand: stukken ≤ 1200 mm breed met naden achter staanders, geheel gedekt", () => {
    const model = buildCabinetModel({ ...ACCEPT, rugMode: "volledig" });
    const rugs = model.panels.filter((p) => p.type === "rug").sort((a, b) => a.place.x - b.place.x);
    expect(rugs.length).toBeGreaterThanOrEqual(2);
    let x = 0;
    for (const r of rugs) {
      expect(r.place.x).toBeCloseTo(x, 1); // aansluitend
      expect(r.place.w).toBeLessThanOrEqual(1200 + 0.01);
      expect(r.place.h).toBeCloseTo(ACCEPT.height, 0);
      x = r.place.x + r.place.w;
    }
    expect(x).toBeCloseTo(model.snappedWidth, 1);
    // Naad ligt op een staanderhart.
    const seam = rugs[0].place.x + rugs[0].place.w;
    const centers = model.panels
      .filter((p) => p.type === "staander")
      .map((p) => p.place.x + ACCEPT.thickness / 2);
    expect(centers.some((c) => Math.abs(c - seam) < 0.6)).toBe(true);
    // Alle vakken tellen als rug; nesting van HDF foutloos.
    expect(model.cells.every((c) => c.fill === "rug")).toBe(true);
    const nesting = nestPanels(model.panels);
    expect(nesting.errors).toHaveLength(0);
    expect(nesting.hdfSheets.length).toBeGreaterThan(0);
    expect(model.hardware.some((h) => h.name.startsWith("HDF achterwand"))).toBe(true);
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

/** Geen twee onderdelen op dezelfde plaat overlappen (incl. freesbaan). */
function expectNoOverlap(sheets: ReturnType<typeof nestPanels>["sheets"]) {
  for (const sheet of sheets) {
    const pls = sheet.placements;
    for (let i = 0; i < pls.length; i++) {
      for (let j = i + 1; j < pls.length; j++) {
        const a = pls[i];
        const b = pls[j];
        const sepX =
          a.x + a.length + KERF <= b.x + 0.01 || b.x + b.length + KERF <= a.x + 0.01;
        const sepY =
          a.y + a.width + KERF <= b.y + 0.01 || b.y + b.width + KERF <= a.y + 0.01;
        expect(sepX || sepY, `${a.panel.id} overlapt ${b.panel.id}`).toBe(true);
      }
      expect(pls[i].x + pls[i].length).toBeLessThanOrEqual(sheet.sheetLength - SHEET_MARGIN + 0.01);
      expect(pls[i].y + pls[i].width).toBeLessThanOrEqual(sheet.sheetWidth - SHEET_MARGIN + 0.01);
    }
  }
}

describe("slimmere nesting: variabele stroken, stapelen, restbreedte", () => {
  it("plaatst nooit overlappende onderdelen", () => {
    const configs: Partial<CabinetConfig>[] = [
      {},
      { base: "plint" },
      { depth: 200, base: "plint" },
      { backTaper: { left: 300, right: 0 }, base: "plint" },
      { omittedShelves: { "0:1:2": true, "0:2:3": true } },
      { columnOffsets: { "1": 80, "3": -60 }, rugMode: "volledig" },
    ];
    for (const patch of configs) {
      const nesting = nestPanels(buildCabinetModel({ ...ACCEPT, ...patch }).panels);
      expect(nesting.errors).toHaveLength(0);
      expectNoOverlap(nesting.sheets);
      expectNoOverlap(nesting.hdfSheets);
    }
  });

  it("gebruikt de restbreedte van een plaat voor de plint (diepte 200: 2 platen i.p.v. 3)", () => {
    const model = buildCabinetModel({ ...ACCEPT, depth: 200, base: "plint" });
    const nesting = nestPanels(model.panels);
    expect(nesting.sheets).toHaveLength(2);
    const plint = nesting.sheets
      .flatMap((s) => s.placements.map((pl) => ({ ...pl, sheet: s.index })))
      .find((pl) => pl.panel.type === "plint")!;
    // 5 stroken van 200 + freesbanen = 1032 → de plint ligt in de rest daarboven.
    expect(plint.y).toBeGreaterThanOrEqual(SHEET_MARGIN + 5 * 208 - 0.01);
    expect(plint.y + plint.width).toBeLessThanOrEqual(SHEET_WIDTH - SHEET_MARGIN + 0.01);
  });

  it("geeft smallere onderdelen een lage strook (verloop 300: 3 platen i.p.v. 4)", () => {
    const model = buildCabinetModel({ ...ACCEPT, backTaper: { left: 300, right: 0 } });
    const nesting = nestPanels(model.panels);
    expect(nesting.errors).toHaveLength(0);
    expect(nesting.sheets).toHaveLength(3);
    expect(nesting.yieldPercent).toBeGreaterThan(55);
  });

  it("stapelt rugpanelen van gewone vakken in de strook van een samengevoegd vak", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      omittedShelves: { "0:1:2": true },
      cellFills: { "0:1:1": "rug", "0:1:2": "rug", "0:2:1": "rug", "0:2:2": "rug", "0:3:1": "rug" },
    });
    const nesting = nestPanels(model.panels);
    expect(nesting.hdfSheets).toHaveLength(1);
    const pls = nesting.hdfSheets[0].placements;
    const merged = pls.reduce((a, b) => (b.width > a.width ? b : a));
    // Minstens één gewoon rugpaneel ligt gestapeld boven een ander (zelfde x, hogere y).
    const stacked = pls.some((a) => pls.some((b) => b !== a && b.x === a.x && b.y > a.y));
    expect(stacked).toBe(true);
    // Strookhoogte volgt het samengevoegde vak; alles binnen één strook + evt. lage strook.
    expect(nesting.hdfSheets[0].strips[0].height).toBeCloseTo(merged.width, 1);
    expectNoOverlap(nesting.hdfSheets);
  });

  it("kiest best-fit: de laatste plaat houdt een bruikbare reststrook over", () => {
    const nesting = nestPanels(buildCabinetModel({ ...ACCEPT, base: "plint" }).panels);
    const last = nesting.sheets[nesting.sheets.length - 1];
    expect(nesting.sheetCountFraction).toBeLessThan(nesting.sheets.length);
    expect(last.strips.every((st) => st.usedLength <= SHEET_LENGTH - 2 * SHEET_MARGIN + 0.01)).toBe(true);
  });
});

describe("plint: teruggelegd, vlak of eigen maat", () => {
  const minFrontOf = (model: ReturnType<typeof buildCabinetModel>) =>
    Math.min(...model.panels.filter((p) => p.type === "staander").map((p) => p.place.z + p.place.d));

  it("ligt standaard 40 mm terug", () => {
    const model = buildCabinetModel({ ...ACCEPT, base: "plint" });
    const plint = model.panels.find((p) => p.type === "plint")!;
    expect(plint.place.z + plint.place.d).toBeCloseTo(minFrontOf(model) - 40, 1);
  });

  it("kan vlak met de voorkant (0) en op eigen maat", () => {
    const flush = buildCabinetModel({ ...ACCEPT, base: "plint", plinthSetback: 0 });
    const pf = flush.panels.find((p) => p.type === "plint")!;
    expect(pf.place.z + pf.place.d).toBeCloseTo(minFrontOf(flush), 1);

    const eigen = buildCabinetModel({ ...ACCEPT, base: "plint", plinthSetback: 65 });
    const pe = eigen.panels.find((p) => p.type === "plint")!;
    expect(pe.place.z + pe.place.d).toBeCloseTo(minFrontOf(eigen) - 65, 1);
  });

  it("volgt het ondiepste punt bij een voorkantprofiel", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      base: "plint",
      plinthSetback: 0,
      frontProfile: { type: "bol", amplitude: 60, periodes: 2, mirror: false },
    });
    const plint = model.panels.find((p) => p.type === "plint")!;
    expect(plint.place.z + plint.place.d).toBeCloseTo(minFrontOf(model), 1);
    expect(minFrontOf(model)).toBeLessThan(ACCEPT.depth);
  });
});

describe("gedraaide onderdelen in de nesting", () => {
  const model = buildCabinetModel({
    ...ACCEPT,
    omittedShelves: { "0:1:2": true },
    cellFills: { "0:1:1": "rug", "0:1:2": "rug", "0:2:1": "rug", "0:2:2": "rug", "0:3:1": "rug" },
  });

  it("draait HDF-rugpanelen zodat ze naast een samengevoegd paneel op één plaat passen", () => {
    const nesting = nestPanels(model.panels);
    expect(nesting.hdfSheets).toHaveLength(1);
    const rotated = nesting.hdfSheets[0].placements.filter((pl) => pl.rotated);
    expect(rotated.length).toBeGreaterThan(0);
    for (const pl of rotated) {
      expect(pl.length).toBeCloseTo(pl.panel.width, 1);
      expect(pl.width).toBeCloseTo(pl.panel.length, 1);
    }
  });

  it("contour en bewerkingen van een gedraaid onderdeel liggen binnen de voetafdruk", () => {
    const nesting = nestPanels(model.panels, { allowRotation: true });
    for (const sheet of [...nesting.sheets, ...nesting.hdfSheets]) {
      for (const pl of sheet.placements) {
        const inside = (x: number, y: number) =>
          x >= pl.x - 0.01 && x <= pl.x + pl.length + 0.01 && y >= pl.y - 0.01 && y <= pl.y + pl.width + 0.01;
        for (const [x, y] of placementContour(pl)) expect(inside(x, y), `${pl.panel.id} contour`).toBe(true);
        for (const op of placementOps(pl)) {
          if (op.kind === "rect") {
            expect(inside(op.x, op.y), `${pl.panel.id} rect`).toBe(true);
            expect(inside(op.x + op.w, op.y + op.h), `${pl.panel.id} rect`).toBe(true);
          } else if (op.kind === "circle") {
            expect(inside(op.cx, op.cy), `${pl.panel.id} circle`).toBe(true);
          } else if (op.kind === "path") {
            for (const [x, y] of op.points) expect(inside(x, y), `${pl.panel.id} path`).toBe(true);
          } else {
            expect(inside(op.x, op.y), `${pl.panel.id} text`).toBe(true);
            if (pl.rotated) expect(op.rotation).toBe(90);
          }
        }
      }
    }
  });

  it("draait een 18mm-plank correct: dado-inkeping en boringen wisselen van as", () => {
    const plank = model.panels.find((p) => p.type === "plank")!;
    const flat = { panel: plank, x: 100, y: 50, length: plank.length, width: plank.width, rotated: false };
    const rot = { panel: plank, x: 100, y: 50, length: plank.width, width: plank.length, rotated: true };
    const circlesFlat = placementOps(flat).filter((o) => o.kind === "circle") as Extract<ReturnType<typeof placementOps>[number], { kind: "circle" }>[];
    const circlesRot = placementOps(rot).filter((o) => o.kind === "circle") as typeof circlesFlat;
    expect(circlesRot).toHaveLength(circlesFlat.length);
    // (x, y) → (W − y, x): een boring op relatieve (bx, by) komt op (W − by, bx).
    for (const c of circlesFlat) {
      const bx = c.cx - flat.x;
      const by = c.cy - flat.y;
      const match = circlesRot.find(
        (r) => Math.abs(r.cx - (rot.x + plank.width - by)) < 0.01 && Math.abs(r.cy - (rot.y + bx)) < 0.01,
      );
      expect(match, `boring ${bx},${by}`).toBeDefined();
    }
    // De DXF van een plaat met gedraaid onderdeel blijft geldig R12.
    const dxf = sheetToDxf({ index: 0, material: "plaat18", sheetLength: 2440, sheetWidth: 1220, placements: [rot], strips: [] });
    expect(dxf).toContain("AC1009");
    expect(dxf).toMatch(/\r?\n50\r?\n90/);
  });
});

describe("opslag: normaliseren en deellink", () => {
  it("vult een oude/onvolledige configuratie aan met standaardwaarden", () => {
    const c = normalizeConfig({ width: 1234, feet: { height: 120 }, cellFills: { "0:0:0": "rug" } });
    expect(c.width).toBe(1234);
    expect(c.plinthSetback).toBe(DEFAULT_CONFIG.plinthSetback);
    expect(c.feet.height).toBe(120);
    expect(c.feet.type).toBe(DEFAULT_CONFIG.feet.type);
    expect(c.cellFills["0:0:0"]).toBe("rug");
    expect(normalizeConfig(null)).toEqual(DEFAULT_CONFIG);
  });

  it("codeert alleen afwijkingen en decodeert terug naar dezelfde configuratie", () => {
    const config: CabinetConfig = {
      ...ACCEPT,
      width: 2222,
      omittedShelves: { "0:1:2": true },
      columnOffsets: { "1": 60 },
      frontProfile: { type: "golf", amplitude: 40, periodes: 3, mirror: true },
      rugColor: "#123456",
    };
    const encoded = encodeConfig(config);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeConfig(encoded)).toEqual(config);
    expect(encodeConfig(DEFAULT_CONFIG).length).toBeLessThan(encoded.length);
    expect(decodeConfig("dit is geen geldige link")).toBeNull();
  });
});

describe("betonplex, LED-verlichting en dichtvak", () => {
  it("betonplex is beschikbaar als nerfloos materiaal", () => {
    const b = SHEET_MATERIALS.find((m) => m.id === "betonplex")!;
    expect(b).toBeDefined();
    expect(b.diktes).toContain(18);
    expect(b.nerf).toBeFalsy();
    const model = buildCabinetModel({ ...ACCEPT, materialId: "betonplex" });
    expect(model.warnings.filter((w) => w.includes("materiaal"))).toHaveLength(0);
  });

  it("LED: groef en kabeldoorvoer in de planken, vrij van de verbindingen", () => {
    for (const joinery of ["dado", "cabineo"] as const) {
      const model = buildCabinetModel({
        ...ACCEPT,
        joinery,
        led: { enabled: true, side: "rechts", inbouw: true },
      });
      const planken = model.panels.filter((p) => p.type === "plank");
      for (const p of planken) {
        const holes = p.ops.filter((o) => o.kind === "circle" && o.layer === "BOOR_10MM") as CircleOp[];
        const grooves = p.ops.filter((o) => o.layer === "LED_GROEF_7MM");
        const isTop = p.place.y + p.place.h >= ACCEPT.height - 0.01;
        const isBottom = p.place.y <= 0.01;
        // Doorvoer in alle planken behalve de bovenste; groef boven elk vak (niet in de onderste plank).
        expect(holes.length, `${p.id} doorvoer`).toBe(isTop ? 0 : 1);
        expect(grooves.length, `${p.id} groef`).toBe(isBottom ? 0 : 1);
        for (const h of holes) {
          expect(h.through).toBe(true);
          expect(h.cx).toBeGreaterThan(p.length / 2); // rechts
          expect(h.cy).toBeLessThan(40); // achter
        }
        // Groef start voorbij de Cabineo-pockets (≤ 33,5 mm vanaf het uiteinde).
        for (const g of grooves) {
          if (g.kind === "rect") {
            expect(g.x).toBeGreaterThanOrEqual(33.5);
            expect(g.x + g.w).toBeLessThanOrEqual(p.length - 33.5);
            expect(g.depth).toBe(7);
          }
        }
        // Geen overlap tussen doorvoer en Cabineo-pockets/dado-deuvels.
        for (const h of holes) {
          for (const o of p.ops) {
            if (o.kind === "circle" && o !== h) {
              const dist = Math.hypot(o.cx - h.cx, o.cy - h.cy);
              expect(dist, `${p.id}: ${o.layer} vs doorvoer`).toBeGreaterThan(o.diameter / 2 + 5);
            }
            if (o.kind === "path") {
              for (const [px, py] of o.points) {
                expect(Math.hypot(px - h.cx, py - h.cy), `${p.id}: pocket vs doorvoer`).toBeGreaterThan(5);
              }
            }
          }
        }
      }
      expect(model.hardware.some((h) => h.name.startsWith("LED-strip"))).toBe(true);
      expect(model.hardware.some((h) => h.name.startsWith("LED-driver"))).toBe(true);
      expect(nestPanels(model.panels).errors).toHaveLength(0);
    }
    // Opbouw: geen groef, wel doorvoer en strip.
    const opbouw = buildCabinetModel({ ...ACCEPT, led: { enabled: true, side: "links", inbouw: false } });
    expect(opbouw.panels.some((p) => p.ops.some((o) => o.layer === "LED_GROEF_7MM"))).toBe(false);
    expect(opbouw.panels.some((p) => p.ops.some((o) => o.layer === "BOOR_10MM"))).toBe(true);
    expect(opbouw.hardware.some((h) => h.name.includes("inbouwprofiel"))).toBe(false);
    expect(opbouw.cells.every((c) => c.led)).toBe(true);
  });

  it("dichtvak: inliggende deur met Ø35-cups, montageplaatboringen in de staander en een rugpaneel", () => {
    const model = buildCabinetModel({ ...ACCEPT, cellFills: { "0:1:1": "deur" } });
    const cell = model.cells.find((c) => c.key === "0:1:1")!;
    expect(cell.fill).toBe("deur");
    const doors = model.panels.filter((p) => p.type === "deur");
    expect(doors).toHaveLength(1);
    const d = doors[0];
    expect(d.place.w).toBeCloseTo(cell.w - 4, 1);
    expect(d.place.h).toBeCloseTo(cell.h - 4, 1);
    expect(d.place.z + d.place.d).toBeCloseTo(ACCEPT.depth, 1); // vlak met de voorkant
    expect(d.machineSide).toBe("B");
    const cups = d.ops.filter((o): o is CircleOp => o.kind === "circle" && o.layer === "BOOR_35MM");
    expect(cups).toHaveLength(2);
    for (const c of cups) {
      expect(c.diameter).toBe(35);
      expect(c.depth).toBe(13);
      expect(c.through).toBe(false);
      expect(c.cx).toBeGreaterThanOrEqual(0);
      expect(c.cx).toBeLessThanOrEqual(d.length);
      expect(c.cy).toBeGreaterThanOrEqual(0);
      expect(c.cy).toBeLessThanOrEqual(d.width);
    }
    // Kolom 1 van 4 → scharnier links → staander S2 (A-zijde): 2 scharnieren × 2 boringen.
    const s2 = model.panels.find((p) => p.id === "S2")!;
    const plate = s2.ops.filter(
      (o): o is CircleOp => o.kind === "circle" && o.layer === "BOOR_5MM" && o.diameter === 5,
    );
    expect(plate).toHaveLength(4);
    for (const h of plate) {
      expect(h.side).toBe("A");
      expect(h.cy).toBeCloseTo(ACCEPT.depth - 37, 1);
    }
    const s3 = model.panels.find((p) => p.id === "S3")!;
    expect(s3.ops.filter((o) => o.kind === "circle" && o.diameter === 5)).toHaveLength(0);
    // Dichtvak heeft ook een rugpaneel.
    const rugs = model.panels.filter((p) => p.type === "rug");
    const base = buildCabinetModel(ACCEPT).panels.filter((p) => p.type === "rug");
    expect(rugs.length).toBe(base.length + 1);
    expect(model.hardware.find((h) => h.name.startsWith("Potscharnier"))?.qty).toBe(2);
    expect(model.hardware.find((h) => h.name.startsWith("Push-to-open"))?.qty).toBe(1);
    // Nesting en DXF.
    const nesting = nestPanels(model.panels);
    expect(nesting.errors).toHaveLength(0);
    const all = nesting.sheets.map((s) => sheetToDxf(s)).join("\n");
    expect(all).toContain("BOOR_35MM_D13");
  });

  it("dichtvak rechts scharniert rechts; hoge deur krijgt 3 scharnieren; volledige rug blijft mogelijk", () => {
    const model = buildCabinetModel({
      ...ACCEPT,
      omittedShelves: { "0:3:2": true, "0:3:3": true },
      cellFills: { "0:3:1": "deur" },
      rugMode: "volledig",
    });
    const door = model.panels.find((p) => p.type === "deur")!;
    expect(door.place.h).toBeGreaterThan(900);
    expect(door.ops.filter((o) => o.layer === "BOOR_35MM")).toHaveLength(3);
    const s5 = model.panels.find((p) => p.id === "S5")!; // rechter buitenstaander, B-zijde
    const plate = s5.ops.filter((o): o is CircleOp => o.kind === "circle" && o.diameter === 5);
    expect(plate).toHaveLength(6);
    expect(plate.every((h) => h.side === "B" && !h.through)).toBe(true);
    expect(model.panels.filter((p) => p.type === "rug").length).toBeGreaterThan(0);
    expect(nestPanels(model.panels).errors).toHaveLength(0);
  });
});

describe("LED-bekabeling: verticaal per kolom én horizontaal door de staanders", () => {
  const LED: Partial<CabinetConfig> = { led: { enabled: true, side: "links", inbouw: true } };

  it("geeft alleen de binnenstaanders een horizontale verzameldoorvoer", () => {
    const model = buildCabinetModel({ ...ACCEPT, ...LED });
    const holesOf = (id: string) =>
      model.panels
        .find((p) => p.id === id)!
        .ops.filter((o): o is CircleOp => o.kind === "circle" && o.layer === "BOOR_10MM");
    // 4 kolommen → S1 en S5 zijn buitenstaanders, S2/S3/S4 binnenstaanders.
    expect(holesOf("S1")).toHaveLength(0);
    expect(holesOf("S5")).toHaveLength(0);
    for (const id of ["S2", "S3", "S4"]) {
      const holes = holesOf(id);
      expect(holes, id).toHaveLength(1);
      expect(holes[0].diameter).toBe(10);
      expect(holes[0].through).toBe(true);
      // Onderin, boven de onderste plank en ruim onder de plank erboven.
      expect(holes[0].cx).toBeGreaterThan(18);
      expect(holes[0].cx).toBeLessThan(120);
      // Achterin, op dezelfde diepte als de doorvoeren in de planken.
      expect(holes[0].cy).toBeCloseTo(28, 1);
    }
    // Zonder LED geen enkele doorvoer.
    const zonder = buildCabinetModel(ACCEPT);
    expect(zonder.panels.some((p) => p.ops.some((o) => o.layer === "BOOR_10MM"))).toBe(false);
  });

  it("houdt de verzameldoorvoer vrij van dado's, Cabineo's en de rugsponning", () => {
    for (const joinery of ["dado", "cabineo"] as const) {
      for (const rugMount of ["geschroefd", "sponning"] as const) {
        const model = buildCabinetModel({ ...ACCEPT, ...LED, joinery, rugMount });
        const s = model.panels.find((p) => p.id === "S3")!;
        const hole = s.ops.find(
          (o): o is CircleOp => o.kind === "circle" && o.layer === "BOOR_10MM",
        )!;
        for (const op of s.ops) {
          if (op === hole) continue;
          if (op.kind === "circle") {
            const d = Math.hypot(op.cx - hole.cx, op.cy - hole.cy);
            expect(d, `${joinery}/${rugMount}: ${op.layer}`).toBeGreaterThan(5 + op.diameter / 2);
          }
          if (op.kind === "rect") {
            // Afstand van het hart tot de rechthoek moet groter zijn dan de boorradius.
            const dx = Math.max(op.x - hole.cx, hole.cx - (op.x + op.w), 0);
            const dy = Math.max(op.y - hole.cy, hole.cy - (op.y + op.h), 0);
            expect(Math.hypot(dx, dy), `${joinery}/${rugMount}: ${op.layer}`).toBeGreaterThan(5);
          }
        }
      }
    }
  });

  it("levert een kabelroute voor de 3D: verticaal per kolom, horizontaal verzamelend, dan omlaag", () => {
    const model = buildCabinetModel({ ...ACCEPT, ...LED, base: "plint" });
    // 4 verticale strengen + 1 horizontale verzamelstreng + 1 afdaling.
    expect(model.ledRoutes).toHaveLength(6);
    const verticaal = model.ledRoutes.filter(
      (r) => r.length === 2 && r[0][0] === r[1][0] && r[0][1] !== r[1][1],
    );
    expect(verticaal).toHaveLength(5); // 4 kolommen + de afdaling naar de driver
    const horizontaal = model.ledRoutes.find((r) => r.length === 4)!;
    expect(horizontaal).toBeDefined();
    // Verzamelstreng op één hoogte, oplopend in x over alle kolommen.
    expect(new Set(horizontaal.map((p) => p[1])).size).toBe(1);
    for (let i = 1; i < horizontaal.length; i++) {
      expect(horizontaal[i][0]).toBeGreaterThan(horizontaal[i - 1][0]);
    }
    // De verzamelstreng ligt op de hoogte van de doorvoer in de binnenstaander.
    const s3 = model.panels.find((p) => p.id === "S3")!;
    const hole = s3.ops.find((o): o is CircleOp => o.kind === "circle" && o.layer === "BOOR_10MM")!;
    expect(horizontaal[0][1]).toBeCloseTo(model.bodyBase + hole.cx, 1);
    // Zonder LED geen route.
    expect(buildCabinetModel(ACCEPT).ledRoutes).toHaveLength(0);
  });

  it("laat de bekabeling van een tweede module omlaag via de bovenste plank", () => {
    const model = buildCabinetModel({ ...ACCEPT, ...LED, height: 3000 });
    expect(model.moduleCount).toBe(2);
    const topOf = (m: number) =>
      Math.max(
        ...model.panels.filter((p) => p.type === "plank" && p.module === m).map((p) => p.place.y),
      );
    const heeftDoorvoer = (p: (typeof model.panels)[number]) =>
      p.ops.some((o) => o.layer === "BOOR_10MM");
    const planken = model.panels.filter((p) => p.type === "plank");
    for (const p of planken) {
      const isTopVanKast = p.module === 1 && p.place.y >= topOf(1) - 0.01;
      expect(heeftDoorvoer(p), `${p.id} (module ${p.module})`).toBe(!isTopVanKast);
    }
    // De verzameldoorvoer zit alleen in de onderste module.
    const collectors = model.panels.filter(
      (p) => p.type === "staander" && p.ops.some((o) => o.layer === "BOOR_10MM"),
    );
    expect(collectors.every((p) => p.module === 0)).toBe(true);
    expect(collectors).toHaveLength(3);
  });
});

describe("plint: inkeping in de binnenstaanders", () => {
  /** Ligt (u, v) binnen de contour van het paneel? (even-odd raycast) */
  const inside = (contour: [number, number][], u: number, v: number) => {
    let hit = false;
    for (let i = 0, j = contour.length - 1; i < contour.length; j = i++) {
      const [ui, vi] = contour[i];
      const [uj, vj] = contour[j];
      if (vi > v !== vj > v && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) hit = !hit;
    }
    return hit;
  };

  it("spaart de plint uit in de binnenstaanders en laat de buitenste heel", () => {
    const model = buildCabinetModel({ ...ACCEPT, base: "plint" });
    const plint = model.panels.find((p) => p.type === "plint")!;
    const plintBack = plint.place.z;
    const plintFront = plint.place.z + plint.place.d;

    for (const id of ["S2", "S3", "S4"]) {
      const s = model.panels.find((p) => p.id === id)!;
      expect(s.contour, `${id} moet een inkeping hebben`).toBeDefined();
      // Waar de plint zit is geen staandermateriaal meer.
      const v = plintBack - s.place.z + plint.place.d / 2; // hart van de plint, lokaal
      expect(inside(s.contour!, 40, v), `${id} op plinthoogte`).toBe(false);
      // Boven de plint staat de staander weer vol.
      expect(inside(s.contour!, 200, v), `${id} boven de plint`).toBe(true);
      // Achter de plint blijft de voet staan.
      expect(inside(s.contour!, 40, 100), `${id} voet achter de plint`).toBe(true);
    }
    // Buitenstaanders houden hun volle diepte; de plint stopt ernaast.
    for (const id of ["S1", "S5"]) {
      expect(model.panels.find((p) => p.id === id)!.contour).toBeUndefined();
    }
    expect(plint.place.x).toBeGreaterThan(ACCEPT.thickness);
    expect(plint.place.x + plint.place.w).toBeLessThan(model.snappedWidth - ACCEPT.thickness);
    // De inkeping loopt tot de voorkant en tot de plinthoogte.
    const s3 = model.panels.find((p) => p.id === "S3")!;
    expect(Math.max(...s3.contour!.map(([u]) => u))).toBeCloseTo(ACCEPT.height, 1);
    expect(s3.contour!.some(([u, v]) => u === 80 && v === s3.width)).toBe(true);
    expect(plintFront).toBeCloseTo(ACCEPT.depth - 40, 1);
    // Schroeven voor de plint staan in de hardwarelijst.
    expect(model.hardware.some((h) => h.name.includes("plint"))).toBe(true);
  });

  it("volgt de terugligging en combineert met de muurplint-inkeping", () => {
    for (const setback of [0, 40, 120]) {
      const model = buildCabinetModel({
        ...ACCEPT,
        base: "plint",
        plinthSetback: setback,
        wallSkirting: { height: 120, depth: 20 },
      });
      const plint = model.panels.find((p) => p.type === "plint")!;
      const s3 = model.panels.find((p) => p.id === "S3")!;
      const c = s3.contour!;
      // Voor-onder uitgespaard tot precies het achtervlak van de plint.
      const notchV = Math.min(...c.filter(([u]) => u === 80).map(([, v]) => v));
      expect(notchV).toBeCloseTo(plint.place.z - s3.place.z, 1);
      // Achter-onder blijft de muurplint-inkeping bestaan.
      expect(c.some(([u, v]) => u === 0 && v === 20)).toBe(true);
      expect(Math.min(...c.map(([, v]) => v))).toBe(0);
    }
  });

  it("waarschuwt als er te weinig staandervoet overblijft", () => {
    const ondiep = buildCabinetModel({
      ...ACCEPT,
      depth: 200,
      base: "plint",
      plinthSetback: 120,
    });
    expect(ondiep.warnings.some((w) => w.includes("staanderdiepte"))).toBe(true);
    expect(buildCabinetModel({ ...ACCEPT, base: "plint" }).warnings.some((w) => w.includes("staanderdiepte"))).toBe(false);
  });

  it("zonder plint blijven de staanders onaangetast", () => {
    for (const base of ["geen", "pootjes"] as const) {
      const model = buildCabinetModel({ ...ACCEPT, base });
      expect(model.panels.filter((p) => p.type === "staander").every((p) => !p.contour)).toBe(true);
    }
  });
});
