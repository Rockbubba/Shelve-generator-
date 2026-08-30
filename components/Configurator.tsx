"use client";

import { useCallback, useMemo, useState } from "react";
import {
  CabinetConfig,
  DEFAULT_CONFIG,
  DEPTH_OPTIONS,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  formatMm,
} from "@/lib/config";
import { buildCabinetModel, cellFillFor } from "@/lib/model";
import { nestPanels } from "@/lib/nesting";
import {
  downloadAllDxfZip,
  downloadBomCsv,
  downloadSheetDxf,
} from "@/lib/export";
import { buildBom, typeLabel } from "@/lib/bom";
import Viewer3D from "./Viewer3D";
import BottomSheet, { SheetSnap } from "./BottomSheet";
import NestingPreview from "./NestingPreview";
import BomView from "./BomView";
import { Segmented, Stepper, Toggle } from "./controls";

const STEPS = ["Maatvoering", "Vakverdeling", "Opties", "Output"] as const;

function nlNumber(v: number, decimals = 1): string {
  return v.toFixed(decimals).replace(".", ",");
}

export default function Configurator() {
  const [config, setConfig] = useState<CabinetConfig>(DEFAULT_CONFIG);
  const [step, setStep] = useState(0);
  const [snap, setSnap] = useState<SheetSnap>("half");

  const model = useMemo(() => buildCabinetModel(config), [config]);
  const nesting = useMemo(
    () => nestPanels(model.panels, config.depth),
    [model, config.depth],
  );

  const update = useCallback((patch: Partial<CabinetConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
  }, []);

  const onCellTap = useCallback((cellKey: string) => {
    setConfig((c) => {
      const [m, col, row] = cellKey.split(":").map(Number);
      const current = cellFillFor(c, m, col, row);
      const next = current === "rug" ? "open" : "rug";
      return { ...c, cellFills: { ...c.cellFills, [cellKey]: next } };
    });
  }, []);

  const peek = (
    <div className="flex items-center justify-between">
      <span className="text-sm font-semibold">
        {nlNumber(nesting.sheetCountFraction)} platen — {nesting.yieldPercent}%
      </span>
      <span className="text-xs text-neutral-500">
        {formatMm(model.snappedWidth)} × {formatMm(config.height)} ×{" "}
        {formatMm(config.depth)} mm
      </span>
    </div>
  );

  const stepNav = (
    <nav className="mb-2 flex gap-1" aria-label="Stappen">
      {STEPS.map((name, i) => (
        <button
          key={name}
          type="button"
          className={`btn-touch flex-1 rounded-lg px-1 py-2 text-xs font-medium ${
            i === step
              ? "bg-neutral-900 text-white"
              : i < step
                ? "bg-neutral-200 text-neutral-700"
                : "bg-neutral-100 text-neutral-400"
          }`}
          onClick={() => setStep(i)}
        >
          {i + 1}. {name}
        </button>
      ))}
    </nav>
  );

  const settings = (
    <div>
      {stepNav}
      {step === 0 && (
        <div>
          <Segmented
            label="Diepte (uit plaatbreedte)"
            options={DEPTH_OPTIONS.map((o) => ({
              value: o.depth,
              label: `${formatMm(o.depth)} mm`,
              sub: `${o.stripsPerSheet} stroken`,
            }))}
            value={config.depth}
            onChange={(depth) => update({ depth })}
          />
          <Stepper
            label="Breedte"
            value={config.width}
            min={MIN_WIDTH}
            max={MAX_WIDTH}
            step={10}
            onChange={(width) => update({ width })}
            hint={
              model.snap.snapped
                ? Math.abs(model.snap.delta) > 0.05
                  ? `wordt ${formatMm(model.snappedWidth)} mm — strook exact gevuld`
                  : "vult de strook exact"
                : `restlengte per strook: ${formatMm(model.snap.stripLeftover)} mm`
            }
          />
          <Stepper
            label="Hoogte"
            value={config.height}
            min={MIN_HEIGHT}
            max={MAX_HEIGHT}
            step={10}
            onChange={(height) => update({ height })}
            hint={
              model.moduleCount > 1
                ? `${model.moduleCount} gestapelde modules`
                : undefined
            }
          />
        </div>
      )}
      {step === 1 && (
        <div>
          <Stepper
            label="Kolommen"
            value={config.columns}
            min={1}
            max={8}
            step={1}
            unit=""
            onChange={(columns) => update({ columns })}
          />
          <Stepper
            label="Rijen"
            value={config.rows}
            min={1}
            max={10}
            step={1}
            unit=""
            onChange={(rows) => update({ rows })}
          />
          <p className="mt-1 text-xs text-neutral-500">
            Vakbreedte: {formatMm(model.cellWidth)} mm. Afwijkende rijhoogtes per
            kolom volgen in v2.
          </p>
        </div>
      )}
      {step === 2 && (
        <div>
          <Segmented
            label="Verbindingstype"
            options={[
              {
                value: "dado",
                label: "Blinde dado",
                sub: "gelijmd · binnenstaanders 2-zijdig",
              },
              {
                value: "cabineo",
                label: "Cabineo",
                sub: "demontabel · alles 1-zijdig",
              },
            ]}
            value={config.joinery}
            onChange={(joinery) => update({ joinery })}
          />
          <Segmented
            label="Rugbevestiging"
            options={[
              {
                value: "geschroefd",
                label: "Geschroefd",
                sub: "op achterkant · 1-zijdig",
              },
              {
                value: "sponning",
                label: "Sponning",
                sub: "in groef · 2-zijdig",
              },
            ]}
            value={config.rugMount}
            onChange={(rugMount) => update({ rugMount })}
          />
          <Segmented
            label="Onderkant"
            options={[
              { value: "plint", label: "Plint" },
              { value: "pootjes", label: "Pootjes" },
              { value: "geen", label: "Geen" },
            ]}
            value={config.base}
            onChange={(base) => update({ base })}
          />
          <Stepper
            label="Gemeten plaatdikte"
            value={config.thickness}
            min={16}
            max={20}
            step={0.1}
            onChange={(thickness) =>
              update({ thickness: Math.round(thickness * 10) / 10 })
            }
          />
          <Toggle
            label="Muurbevestiging"
            hint="2 L-beugels bovenin (verplicht boven 1500 mm)"
            checked={config.wallMount}
            onChange={(wallMount) => update({ wallMount })}
          />
          <div className="mt-2 rounded-xl bg-neutral-50 p-3 text-xs text-neutral-600">
            <p className="font-medium text-neutral-800">Rugpanelen</p>
            <p className="mt-1">
              Tik op een vak in de 3D-weergave om een rugpaneel (4 mm HDF) toe te
              voegen of te verwijderen. De generator stelt hoekvakken en de
              onderste rij voor als minimale set tegen schranken.
            </p>
            <button
              type="button"
              className="btn-touch mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 font-medium text-neutral-700 active:bg-neutral-100"
              onClick={() => update({ cellFills: {} })}
            >
              Terug naar voorstel
            </button>
          </div>
        </div>
      )}
      {step === 3 && (
        <div className="space-y-4">
          {[...model.warnings, ...nesting.errors].map((w) => (
            <p
              key={w}
              className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900"
            >
              {w}
            </p>
          ))}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-touch rounded-xl bg-neutral-900 px-4 py-3 text-sm font-medium text-white active:bg-neutral-700"
              onClick={() => downloadAllDxfZip(nesting)}
            >
              Alle DXF (zip)
            </button>
            <button
              type="button"
              className="btn-touch rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium active:bg-neutral-100"
              onClick={() => downloadBomCsv(model, nesting)}
            >
              Onderdelenlijst CSV
            </button>
            <button
              type="button"
              className="btn-touch col-span-2 rounded-xl border border-neutral-300 px-4 py-3 text-sm font-medium active:bg-neutral-100"
              onClick={() => window.print()}
            >
              Print / PDF onderdelenlijst
            </button>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Nesting</h3>
            <NestingPreview
              nesting={nesting}
              onDownload={(material, index) =>
                downloadSheetDxf(nesting, material, index)
              }
            />
          </div>
          <div>
            <h3 className="mb-2 text-sm font-semibold">Onderdelenlijst</h3>
            <BomView model={model} nesting={nesting} />
          </div>
        </div>
      )}
    </div>
  );

  const navButtons = (
    <div className="flex justify-between gap-2">
      <button
        type="button"
        disabled={step === 0}
        className="btn-touch rounded-xl border border-neutral-300 px-4 py-2 text-sm font-medium disabled:opacity-30"
        onClick={() => setStep((s) => Math.max(0, s - 1))}
      >
        ← Terug
      </button>
      {step < STEPS.length - 1 && (
        <button
          type="button"
          className="btn-touch rounded-xl bg-neutral-900 px-5 py-2 text-sm font-medium text-white active:bg-neutral-700"
          onClick={() => {
            setStep((s) => Math.min(STEPS.length - 1, s + 1));
            setSnap("half");
          }}
        >
          Volgende →
        </button>
      )}
    </div>
  );

  return (
    <div className="h-dvh">
      {/* Mobiel: 3D bovenin (sticky), bottom sheet eronder. */}
      <div className="lg:hidden">
        <div className="fixed inset-x-0 top-0 h-[55dvh]">
          <Viewer3D model={model} onCellTap={onCellTap} />
        </div>
        <BottomSheet snap={snap} onSnapChange={setSnap} peek={peek} footer={navButtons}>
          {settings}
        </BottomSheet>
      </div>

      {/* Desktop: drie kolommen. */}
      <div className="hidden h-full lg:grid lg:grid-cols-[360px_1fr_400px]">
        <aside className="overflow-y-auto border-r border-neutral-200 p-4">
          <h1 className="mb-3 text-lg font-bold">Boekenkast-configurator</h1>
          {settings}
          <div className="mt-4">{navButtons}</div>
        </aside>
        <main className="relative">
          <Viewer3D model={model} onCellTap={onCellTap} />
        </main>
        <aside className="overflow-y-auto border-l border-neutral-200 p-4">
          <div className="mb-3 rounded-2xl bg-neutral-900 p-4 text-white">
            <p className="text-2xl font-bold">
              {nlNumber(nesting.sheetCountFraction)} platen — {nesting.yieldPercent}%
            </p>
            <p className="text-sm text-neutral-300">
              {formatMm(model.snappedWidth)} × {formatMm(config.height)} ×{" "}
              {formatMm(config.depth)} mm · {config.columns} × {config.rows} vakken
            </p>
          </div>
          <h3 className="mb-2 text-sm font-semibold">Nesting</h3>
          <NestingPreview
            nesting={nesting}
            onDownload={(material, index) =>
              downloadSheetDxf(nesting, material, index)
            }
          />
          <h3 className="mb-2 mt-4 text-sm font-semibold">Onderdelenlijst</h3>
          <BomView model={model} nesting={nesting} />
        </aside>
      </div>

      {/* Printbare onderdelenlijst */}
      <div id="print-area" className="hidden print:block">
        <h1 className="mb-2 text-xl font-bold">Boekenkast — onderdelenlijst</h1>
        <p className="mb-4 text-sm">
          {formatMm(model.snappedWidth)} × {formatMm(config.height)} ×{" "}
          {formatMm(config.depth)} mm · {config.columns} kolommen ×{" "}
          {config.rows} rijen · {config.joinery === "dado" ? "blinde dado + deuvel" : "Cabineo"} ·
          plaatdikte {formatMm(config.thickness)} mm
        </p>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["ID's", "Type", "Maat (mm)", "Aantal", "Plaat"].map((h) => (
                <th key={h} className="border border-neutral-400 px-2 py-1 text-left">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {buildBom(model, nesting).map((r) => (
              <tr key={r.ids[0]}>
                <td className="border border-neutral-400 px-2 py-1">{r.ids.join(", ")}</td>
                <td className="border border-neutral-400 px-2 py-1">{typeLabel(r.type)}</td>
                <td className="border border-neutral-400 px-2 py-1">
                  {formatMm(r.length)} × {formatMm(r.width)} × {formatMm(r.thickness)}
                </td>
                <td className="border border-neutral-400 px-2 py-1">{r.qty}</td>
                <td className="border border-neutral-400 px-2 py-1">{r.sheets}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <h2 className="mb-1 mt-4 text-base font-bold">Hardware</h2>
        <ul className="text-sm">
          {model.hardware.map((h) => (
            <li key={h.name}>
              {h.name}: {h.qty} {h.unit}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
