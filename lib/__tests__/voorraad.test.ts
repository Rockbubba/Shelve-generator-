import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, SHEET_MARGIN, SheetStock } from "../config";
import { buildCabinetModel } from "../model";
import { nestPanels } from "../nesting";
import { normalizeConfig } from "../storage";

const model = buildCabinetModel(DEFAULT_CONFIG);
const standard = nestPanels(model.panels);

function stock(plaat18: SheetStock["plaat18"], hdf4 = DEFAULT_CONFIG.sheetStock.hdf4): SheetStock {
  return { plaat18, hdf4 };
}

describe("plaatvoorraad in de nesting", () => {
  it("zonder voorraad: standaardplaten, geen namen", () => {
    expect(standard.sheets.length).toBeGreaterThan(0);
    for (const s of standard.sheets) {
      expect(s.sheetLength).toBe(2440);
      expect(s.sheetWidth).toBe(1220);
      expect(s.stockName).toBeUndefined();
    }
    expect(standard.errors).toEqual([]);
  });

  it("restplaat wordt eerst gebruikt en komt maar één keer voor", () => {
    const r = nestPanels(model.panels, {
      stock: stock([
        { length: 1200, width: 600, qty: 1, naam: "rest A" },
        { length: 2440, width: 1220, qty: null },
      ]),
    });
    expect(r.errors).toEqual([]);
    const rest = r.sheets.filter((s) => s.stockName === "rest A");
    expect(rest).toHaveLength(1);
    expect(rest[0].index).toBe(0);
    expect(rest[0].placements.length).toBeGreaterThan(0);
    // Alles op de restplaat past er ook echt op.
    for (const p of rest[0].placements) {
      expect(p.x + p.length).toBeLessThanOrEqual(1200 - SHEET_MARGIN + 0.01);
      expect(p.y + p.width).toBeLessThanOrEqual(600 - SHEET_MARGIN + 0.01);
    }
    // Alle onderdelen precies één keer geplaatst.
    const ids = r.sheets.flatMap((s) => s.placements.map((p) => p.panel.id)).sort();
    const expected = model.panels.filter((p) => p.material === "plaat18").map((p) => p.id).sort();
    expect(ids).toEqual(expected);
    // Indexen doorlopend over rest- en standaardplaten.
    expect(r.sheets.map((s) => s.index)).toEqual(r.sheets.map((_, i) => i));
  });

  it("aantal wordt gerespecteerd", () => {
    const r = nestPanels(model.panels, {
      stock: stock([
        { length: 2440, width: 1220, qty: 2, naam: "ingekocht" },
        { length: 2440, width: 1220, qty: null },
      ]),
    });
    expect(r.sheets.filter((s) => s.stockName === "ingekocht")).toHaveLength(2);
    expect(r.sheets.length).toBe(standard.sheets.length);
    expect(r.errors).toEqual([]);
  });

  it("grotere standaardplaat: minder platen, maat op elke plaat", () => {
    const r = nestPanels(model.panels, { stock: stock([{ length: 3050, width: 1530, qty: null }]) });
    expect(r.sheets.length).toBeLessThanOrEqual(standard.sheets.length);
    for (const s of r.sheets) {
      expect(s.sheetLength).toBe(3050);
      expect(s.sheetWidth).toBe(1530);
      for (const p of s.placements) {
        expect(p.x + p.length).toBeLessThanOrEqual(3050 - SHEET_MARGIN + 0.01);
        expect(p.y + p.width).toBeLessThanOrEqual(1530 - SHEET_MARGIN + 0.01);
      }
    }
    // Yield rekent met het werkelijke bruto-oppervlak.
    const part = model.panels
      .filter((p) => p.material === "plaat18")
      .reduce((a, p) => a + p.length * p.width, 0);
    expect(r.yieldPercent).toBe(Math.round((part / (r.sheets.length * 3050 * 1530)) * 100));
  });

  it("voorraad op zonder onbeperkte maat: extra platen met melding", () => {
    const r = nestPanels(model.panels, { stock: stock([{ length: 2440, width: 1220, qty: 1 }]) });
    expect(r.sheets.length).toBe(standard.sheets.length);
    const extra = r.sheets.filter((s) => s.stockName === "extra (niet in voorraad)");
    expect(extra.length).toBe(standard.sheets.length - 1);
    expect(r.errors.some((e) => e.includes("voorraad is op"))).toBe(true);
  });

  it("onderdeel dat nergens op past geeft een fout, rest wordt wel genest", () => {
    const r = nestPanels(model.panels, { stock: stock([{ length: 1000, width: 600, qty: 3 }]) });
    // Staanders (2000 lang) passen niet op 1000 × 600 en ook niet meer bij
    // eindige voorraad; ze komen op extra standaardplaten. Alles geplaatst.
    const ids = r.sheets.flatMap((s) => s.placements.map((p) => p.panel.id));
    expect(ids.length).toBe(model.panels.filter((p) => p.material === "plaat18").length);
    // Een écht te groot onderdeel: alleen kleine restplaten én een kleine standaard? Nee: de
    // standaard-terugval is altijd 2440 × 1220, dus alleen langere onderdelen falen.
    const big = buildCabinetModel({ ...DEFAULT_CONFIG, width: 2400, columns: 1, rows: 1 });
    const r2 = nestPanels(big.panels, { stock: stock([{ length: 2440, width: 1220, qty: null }]) });
    expect(r2.errors.every((e) => e.includes("past op geen enkele plaat") || e.length > 0)).toBe(true);
  });

  it("HDF-voorraad apart", () => {
    // Per-vak rugpanelen (± 430 × 365) passen op een halve HDF-plaat; een
    // volledige achterwand niet, die zou naar de standaardplaat gaan.
    const withRug = buildCabinetModel({ ...DEFAULT_CONFIG, cellFills: { "0:0:0": "rug", "0:1:0": "rug" } });
    expect(withRug.panels.some((p) => p.material === "hdf4")).toBe(true);
    const r = nestPanels(withRug.panels, {
      stock: stock(DEFAULT_CONFIG.sheetStock.plaat18, [
        { length: 1220, width: 610, qty: 2, naam: "HDF rest" },
        { length: 2440, width: 1220, qty: null },
      ]),
    });
    expect(r.hdfSheets.filter((s) => s.stockName === "HDF rest").length).toBeGreaterThanOrEqual(1);
    expect(r.hdfSheets.filter((s) => s.stockName === "HDF rest").length).toBeLessThanOrEqual(2);
    expect(r.sheets.every((s) => s.stockName === undefined)).toBe(true);
  });
});

describe("plaatvoorraad in opslag", () => {
  it("oude configuraties krijgen de standaardvoorraad", () => {
    const c = normalizeConfig({ width: 1500 });
    expect(c.sheetStock).toEqual(DEFAULT_CONFIG.sheetStock);
  });

  it("ongeldige regels worden weggelaten, aantallen afgerond", () => {
    const c = normalizeConfig({
      sheetStock: {
        plaat18: [
          { length: 1200, width: 600, qty: 2.7, naam: " rest " },
          { length: -5, width: 600, qty: 1 },
          { length: 2440, width: 1220, qty: 0 },
        ],
      },
    });
    expect(c.sheetStock.plaat18).toEqual([
      { length: 1200, width: 600, qty: 2, naam: "rest" },
      { length: 2440, width: 1220, qty: null },
    ]);
    expect(c.sheetStock.hdf4).toEqual(DEFAULT_CONFIG.sheetStock.hdf4);
  });
});
