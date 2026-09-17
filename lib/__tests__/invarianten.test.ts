import { describe, expect, it } from "vitest";
import { CabinetConfig, DEFAULT_CONFIG, depthOption, SHEET_LENGTH, SHEET_MARGIN, SHEET_WIDTH, KERF, MIN_SUBCELL_WIDTH } from "../config";
import { buildCabinetModel } from "../model";
import { nestPanels } from "../nesting";
import { placementContour, placementOps, sheetToDxf } from "../dxf";

const B: CabinetConfig = { ...DEFAULT_CONFIG, depth: depthOption(3), width: 1800, height: 2000, columns: 4, rows: 5, base: "geen", cellFills: {} };

const CASES: [string, Partial<CabinetConfig>][] = [
  ["standaard", {}],
  ["cabineo", { joinery: "cabineo" }],
  ["taper links", { backTaper: { left: 300, right: 0 } }],
  ["taper rechts", { backTaper: { left: 0, right: 200 } }],
  ["taper beide", { backTaper: { left: 150, right: 90 } }],
  ["taper + volledig", { backTaper: { left: 300, right: 0 }, rugMode: "volledig" } ],
  ["taper + sponning", { backTaper: { left: 200, right: 0 }, rugMount: "sponning" }],
  ["taper + profiel", { backTaper: { left: 200, right: 0 }, frontProfile: { type: "golf", amplitude: 60, periodes: 2, mirror: false } }],
  ["taper + plint", { backTaper: { left: 200, right: 0 }, base: "plint" }],
  ["taper + muurplint", { backTaper: { left: 150, right: 0 }, wallSkirting: { height: 120, depth: 20 } }],
  ["taper + led", { backTaper: { left: 200, right: 0 }, led: { enabled: true, side: "links", inbouw: true } }],
  ["taper + deur", { backTaper: { left: 200, right: 0 }, cellFills: { "0:1:1": "deur" } }],
  ["taper ondiep", { depth: 200, backTaper: { left: 120, right: 0 } }],
  ["profiel bol", { frontProfile: { type: "bol", amplitude: 80, periodes: 2, mirror: false } }],
  ["kolomoffsets", { columnOffsets: { "1": 80, "3": -60 } }],
  ["weggelaten", { omittedShelves: { "0:1:2": true, "0:2:3": true } }],
  ["hoog 3000", { height: 3000 }],
  ["schotten dado", { dividers: { "0:1:1": 2, "0:2:3": 1, "0:0:0": 3 } }],
  ["schotten cabineo", { joinery: "cabineo", dividers: { "0:1:1": 2, "0:3:4": 1 } }],
  ["schotten + taper + led", { backTaper: { left: 200, right: 0 }, led: { enabled: true, side: "links", inbouw: true }, dividers: { "0:1:2": 1, "0:2:2": 2 } }],
  ["schotten verschoven", { dividers: { "0:1:1": 2 }, dividerOffsets: { "0:1:1:0": -80, "0:1:1:1": 60 } }],
  ["schotten in samengevoegd vak", { omittedShelves: { "0:2:2": true }, dividers: { "0:2:1": 2 } }],
  ["alles", { height: 2600, backTaper: { left: 180, right: 40 }, base: "plint", wallSkirting: { height: 110, depth: 18 },
    frontProfile: { type: "golf", amplitude: 50, periodes: 2, mirror: true }, led: { enabled: true, side: "rechts", inbouw: true },
    columnOffsets: { "1": 50 }, omittedShelves: { "0:2:2": true }, cellFills: { "0:0:1": "deur" }, joinery: "cabineo" }],
];

describe("sweep: geometrische invarianten", () => {
  for (const [naam, patch] of CASES) {
    const cfg = { ...B, ...patch };
    const m = buildCabinetModel(cfg);

    it(`${naam}: panelen hebben positieve maten`, () => {
      for (const p of m.panels) {
        expect(p.length, `${p.id} lengte`).toBeGreaterThan(0);
        expect(p.width, `${p.id} breedte`).toBeGreaterThan(0);
        expect(p.place.w, `${p.id} w`).toBeGreaterThan(0);
        expect(p.place.h, `${p.id} h`).toBeGreaterThan(0);
        expect(p.place.d, `${p.id} d`).toBeGreaterThan(0);
      }
    });

    it(`${naam}: rugpanelen staan evenwijdig aan de achterwand`, () => {
      // Referentievlak: de staanders liggen per definitie op de achterwand.
      const st = m.panels.filter((q) => q.type === "staander" && q.module === 0);
      const xs = st.map((q) => q.place.x);
      const zs = st.map((q) => q.place.z);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const zMin = zs[xs.indexOf(xMin)], zMax = zs[xs.indexOf(xMax)];
      const backAt = (x: number) => zMin + ((zMax - zMin) * (x - xMin)) / (xMax - xMin || 1);

      for (const p of m.panels.filter((q) => q.type === "rug")) {
        const yaw = p.yaw ?? 0;
        const xc = p.place.x + p.place.w / 2;
        // Afstand tot de achterwand aan beide randen; die moet gelijk zijn,
        // anders staat het paneel scheef t.o.v. de wand.
        const offset = (edge: number) => {
          const d = (edge * p.place.w) / 2;
          const x = xc + d * Math.cos(yaw);
          const z = p.place.z - d * Math.sin(yaw);
          return z - backAt(x);
        };
        expect(
          Math.abs(offset(-1) - offset(1)),
          `${p.id} staat scheef: links ${offset(-1).toFixed(1)} mm, rechts ${offset(1).toFixed(1)} mm van de achterwand`,
        ).toBeLessThan(1);
      }
    });

    it(`${naam}: rugpanelen dekken hun opening horizontaal af`, () => {
      const t = cfg.thickness;
      // Openingen: vakken, opgedeeld door hun tussenschotten.
      const openings: { x: number; w: number; y: number; h: number }[] = [];
      for (const c of m.cells) {
        const divs = m.panels
          .filter((p) => p.type === "schot" && p.dividerKey?.startsWith(`div:${c.key}:`))
          .sort((a, b) => a.place.x - b.place.x);
        let left = c.x;
        for (const d of divs) {
          openings.push({ x: left, w: d.place.x - left, y: c.y, h: c.h });
          left = d.place.x + t;
        }
        openings.push({ x: left, w: c.x + c.w - left, y: c.y, h: c.h });
      }
      for (const p of m.panels.filter((q) => q.type === "rug")) {
        const yaw = p.yaw ?? 0;
        const overspanning = p.place.w * Math.cos(yaw);
        const l = p.place.x + (p.place.w - overspanning) / 2;
        const r = p.place.x + (p.place.w + overspanning) / 2;
        const dekking = openings.filter(
          (o) => o.y + 1 >= p.place.y && o.y + o.h - 1 <= p.place.y + p.place.h && o.x >= l - 2 && o.x + o.w <= r + 2,
        );
        expect(dekking.length, `${p.id} dekt geen enkele opening af`).toBeGreaterThan(0);
      }
    });

    it(`${naam}: 18mm-onderdelen passen binnen de kastdiepte`, () => {
      for (const p of m.panels.filter((q) => q.material === "plaat18" && q.type !== "plint" && q.type !== "deur")) {
        expect(p.width, `${p.id}`).toBeLessThanOrEqual(cfg.depth + 0.01);
      }
    });

    it(`${naam}: nesting is overlapvrij en binnen de plaat`, () => {
      const n = nestPanels(m.panels);
      expect(n.errors, naam).toHaveLength(0);
      const geplaatst = [...n.sheets, ...n.hdfSheets].flatMap((s) => s.placements).length;
      expect(geplaatst).toBe(m.panels.length);
      for (const sheet of [...n.sheets, ...n.hdfSheets]) {
        const pls = sheet.placements;
        for (let i = 0; i < pls.length; i++) {
          expect(pls[i].x).toBeGreaterThanOrEqual(SHEET_MARGIN - 0.01);
          expect(pls[i].y).toBeGreaterThanOrEqual(SHEET_MARGIN - 0.01);
          expect(pls[i].x + pls[i].length).toBeLessThanOrEqual(sheet.sheetLength - SHEET_MARGIN + 0.01);
          expect(pls[i].y + pls[i].width).toBeLessThanOrEqual(sheet.sheetWidth - SHEET_MARGIN + 0.01);
          for (let j = i + 1; j < pls.length; j++) {
            const a = pls[i], b = pls[j];
            const sepX = a.x + a.length + KERF <= b.x + 0.01 || b.x + b.length + KERF <= a.x + 0.01;
            const sepY = a.y + a.width + KERF <= b.y + 0.01 || b.y + b.width + KERF <= a.y + 0.01;
            expect(sepX || sepY, `${a.panel.id}/${b.panel.id}`).toBe(true);
          }
        }
      }
    });

    it(`${naam}: bewerkingen liggen binnen het onderdeel`, () => {
      const n = nestPanels(m.panels);
      for (const sheet of [...n.sheets, ...n.hdfSheets]) {
        for (const pl of sheet.placements) {
          const binnen = (x: number, y: number) =>
            x >= pl.x - 0.5 && x <= pl.x + pl.length + 0.5 && y >= pl.y - 0.5 && y <= pl.y + pl.width + 0.5;
          for (const [x, y] of placementContour(pl)) {
            expect(binnen(x, y), `${pl.panel.id} contour (${x.toFixed(1)},${y.toFixed(1)})`).toBe(true);
          }
          for (const op of placementOps(pl)) {
            if (op.kind === "circle") expect(binnen(op.cx, op.cy), `${pl.panel.id} ${op.layer}`).toBe(true);
            else if (op.kind === "rect") expect(binnen(op.x, op.y) && binnen(op.x + op.w, op.y + op.h), `${pl.panel.id} ${op.layer}`).toBe(true);
            else if (op.kind === "path") for (const [x, y] of op.points) expect(binnen(x, y), `${pl.panel.id} ${op.layer}`).toBe(true);
          }
        }
      }
    });

    it(`${naam}: geen NaN in model, nesting of kosten`, () => {
      const getallen: [string, number][] = [];
      for (const p of m.panels) {
        getallen.push([`${p.id}.length`, p.length], [`${p.id}.width`, p.width], [`${p.id}.thickness`, p.thickness]);
        for (const k of ["x", "y", "z", "w", "h", "d"] as const) getallen.push([`${p.id}.place.${k}`, p.place[k]]);
        if (p.yaw !== undefined) getallen.push([`${p.id}.yaw`, p.yaw]);
        for (const [i, op] of p.ops.entries()) {
          if (op.kind === "circle") getallen.push([`${p.id}.op${i}.cx`, op.cx], [`${p.id}.op${i}.cy`, op.cy], [`${p.id}.op${i}.d`, op.diameter]);
          if (op.kind === "rect") getallen.push([`${p.id}.op${i}.x`, op.x], [`${p.id}.op${i}.y`, op.y], [`${p.id}.op${i}.w`, op.w], [`${p.id}.op${i}.h`, op.h]);
          if (op.kind === "path") for (const [j, pt] of op.points.entries()) getallen.push([`${p.id}.op${i}.pt${j}.x`, pt[0]], [`${p.id}.op${i}.pt${j}.y`, pt[1]]);
        }
        for (const [i, pt] of (p.contour ?? []).entries()) getallen.push([`${p.id}.contour${i}.x`, pt[0]], [`${p.id}.contour${i}.y`, pt[1]]);
      }
      for (const c of m.cells) for (const k of ["x", "y", "z", "w", "h", "d"] as const) getallen.push([`${c.key}.${k}`, c[k]]);
      for (const r of m.ledRoutes) for (const [i, pt] of r.entries()) getallen.push([`led${i}`, pt[0] + pt[1] + pt[2]]);
      const n = nestPanels(m.panels);
      getallen.push(["sheetCountFraction", n.sheetCountFraction], ["yieldPercent", n.yieldPercent]);
      for (const h of m.hardware) getallen.push([`hardware ${h.name}`, h.qty]);
      for (const [naamVan, v] of getallen) expect(Number.isFinite(v), `${naamVan} = ${v}`).toBe(true);
    });

    it(`${naam}: vakken overlappen niet en liggen in de kast`, () => {
      for (const c of m.cells) {
        expect(c.w, c.key).toBeGreaterThan(0);
        expect(c.h, c.key).toBeGreaterThan(0);
        expect(c.x).toBeGreaterThanOrEqual(-0.01);
        expect(c.x + c.w).toBeLessThanOrEqual(m.snappedWidth + 0.01);
        expect(c.y + c.h).toBeLessThanOrEqual(cfg.height + 0.01);
      }
      for (let i = 0; i < m.cells.length; i++) {
        for (let j = i + 1; j < m.cells.length; j++) {
          const a = m.cells[i], b = m.cells[j];
          const sepX = a.x + a.w <= b.x + 0.01 || b.x + b.w <= a.x + 0.01;
          const sepY = a.y + a.h <= b.y + 0.01 || b.y + b.h <= a.y + 0.01;
          expect(sepX || sepY, `${a.key} overlapt ${b.key}`).toBe(true);
        }
      }
    });

    it(`${naam}: tussenschotten staan in hun vak en houden deelvakken breed genoeg`, () => {
      const t = cfg.thickness;
      for (const cell of m.cells) {
        const inCell = m.panels
          .filter((p) => p.type === "schot" && p.dividerKey?.startsWith(`div:${cell.key}:`))
          .sort((a, b) => a.place.x - b.place.x);
        let prevRight = cell.x;
        for (const d of inCell) {
          expect(d.place.x, `${d.id} links van zijn vak`).toBeGreaterThanOrEqual(cell.x - 0.01);
          expect(d.place.x + t, `${d.id} rechts van zijn vak`).toBeLessThanOrEqual(cell.x + cell.w + 0.01);
          expect(d.place.y, `${d.id} onder zijn vak`).toBeGreaterThanOrEqual(cell.y - 0.01);
          expect(d.place.y + d.place.h, `${d.id} steekt boven zijn vak uit`).toBeLessThanOrEqual(cell.y + cell.h + 7.01);
          expect(d.place.x - prevRight, `${d.id} deelvak te smal`).toBeGreaterThanOrEqual(MIN_SUBCELL_WIDTH - 0.01);
          prevRight = d.place.x + t;
        }
        if (inCell.length > 0) {
          expect(cell.x + cell.w - prevRight, `laatste deelvak in ${cell.key} te smal`).toBeGreaterThanOrEqual(MIN_SUBCELL_WIDTH - 0.01);
        }
      }
    });

    it(`${naam}: deuren passen in hun vak`, () => {
      for (const d of m.panels.filter((q) => q.type === "deur")) {
        const vak = m.cells.find(
          (c) => d.place.x > c.x - 1 && d.place.x + d.place.w < c.x + c.w + 1 && d.place.y > c.y - 1,
        );
        expect(vak, `${d.id} hoort bij geen vak`).toBeDefined();
        expect(d.place.h).toBeLessThanOrEqual(vak!.h + 0.01);
      }
    });

    it(`${naam}: DXF is geldig`, () => {
      const n = nestPanels(m.panels);
      for (const s of [...n.sheets, ...n.hdfSheets]) {
        const dxf = sheetToDxf(s);
        expect(dxf).toContain("AC1009");
        expect(dxf.match(/\r?\nSEQEND/g)?.length ?? 0).toBeGreaterThan(0);
      }
    });
  }
});
