"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CABINET_COLORS,
  CabinetConfig,
  DEFAULT_CONFIG,
  MAX_PLINTH_SETBACK,
  PLINTH_HEIGHT,
  PLINTH_SETBACK,
  DEPTH_OPTIONS,
  FrontProfile,
  MIN_PROFILE_DEPTH,
  MAX_DEPTH,
  MAX_HEIGHT,
  MAX_WIDTH,
  MIN_DEPTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  SHEET_MATERIALS,
  formatMm,
  materialById,
  stripsPerSheetForDepth,
} from "@/lib/config";
import { costSummaryLines, estimateMachining } from "@/lib/costing";
import { priceForSheet, useAdminSettings } from "@/lib/settings";
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
import LayoutEditor from "./LayoutEditor";
import SaveDialog, { SaveButton } from "./SaveMenu";
import { configFromUrl, loadDraft, saveDraft } from "@/lib/storage";
import { Segmented, Stepper, Toggle } from "./controls";

const STEPS = ["Maatvoering", "Vakverdeling", "Opties", "Output"] as const;

function nlNumber(v: number, decimals = 1): string {
  return v.toFixed(decimals).replace(".", ",");
}

export default function Configurator() {
  const [config, setConfig] = useState<CabinetConfig>(DEFAULT_CONFIG);
  const [step, setStep] = useState(0);
  /** Pas na het herstellen uit de browseropslag gaan we zelf opslaan. */
  const restored = useRef(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [restoreNote, setRestoreNote] = useState<string | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);

  // Herstel: deellink in de URL gaat vóór het automatisch bewaarde concept.
  useEffect(() => {
    const fromUrl = configFromUrl();
    if (fromUrl) {
      setConfig(fromUrl);
      setRestoreNote("Ontwerp uit deellink geopend");
      window.history.replaceState(null, "", window.location.pathname);
    } else {
      const draft = loadDraft();
      if (draft) {
        setConfig(draft.config);
        setStep(Math.min(Math.max(draft.step, 0), STEPS.length - 1));
        setLastSavedAt(draft.savedAt);
        setRestoreNote("Vorige sessie hersteld");
      }
    }
    restored.current = true;
  }, []);

  // Automatisch bewaren (licht vertraagd zodat slepen niet elke ms schrijft).
  useEffect(() => {
    if (!restored.current) return;
    const t = setTimeout(() => {
      saveDraft(config, step);
      setLastSavedAt(Date.now());
    }, 400);
    return () => clearTimeout(t);
  }, [config, step]);

  useEffect(() => {
    if (!restoreNote) return;
    const t = setTimeout(() => setRestoreNote(null), 4000);
    return () => clearTimeout(t);
  }, [restoreNote]);
  const [snap, setSnap] = useState<SheetSnap>("half");
  /** Geselecteerde tussenplank (sleutel) voor hoogte/weglaten. */
  const [selectedShelf, setSelectedShelf] = useState<string | null>(null);

  const model = useMemo(() => buildCabinetModel(config), [config]);
  const nesting = useMemo(
    () => nestPanels(model.panels, { allowRotation: !materialById(config.materialId).nerf }),
    [model, config.materialId],
  );

  const admin = useAdminSettings();
  const costs = useMemo(
    () =>
      estimateMachining(
        model,
        nesting,
        admin.machine,
        priceForSheet(admin, config.materialId, config.nominalThickness),
      ),
    [model, nesting, admin, config.materialId, config.nominalThickness],
  );
  const costLines = useMemo(() => costSummaryLines(model, costs), [model, costs]);

  const [customPlinth, setCustomPlinth] = useState(false);
  const plinthMode: "standaard" | "flush" | "eigen" =
    customPlinth || (config.plinthSetback !== 0 && config.plinthSetback !== PLINTH_SETBACK)
      ? "eigen"
      : config.plinthSetback === 0
        ? "flush"
        : "standaard";

  const isCustomDepth = !DEPTH_OPTIONS.some(
    (o) => Math.abs(o.depth - config.depth) < 0.05,
  );
  const customDepthHint = useMemo(() => {
    const n = stripsPerSheetForDepth(config.depth);
    const leftover = 1200 - (n * config.depth + (n - 1) * 8);
    return `${n} stroken per plaat — rest ${formatMm(Math.max(0, leftover))} mm`;
  }, [config.depth]);

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

  // Tik op een ghost-plank zet hem terug; tik op een echte plank selecteert
  // hem (verplaatsen/weglaten gaat via de indelingseditor in stap 2).
  const onShelfTap = useCallback((key: string) => {
    setConfig((c) => {
      if (!c.omittedShelves[key]) return c;
      const omitted = { ...c.omittedShelves };
      delete omitted[key];
      return { ...c, omittedShelves: omitted };
    });
    setSelectedShelf((cur) => (cur === key ? null : key));
    setStep(1);
  }, []);

  const setShelfOffset = useCallback((key: string, offset: number) => {
    setConfig((c) => {
      const shelfOffsets = { ...c.shelfOffsets };
      if (Math.abs(offset) < 0.01) delete shelfOffsets[key];
      else shelfOffsets[key] = Math.round(offset);
      return { ...c, shelfOffsets };
    });
  }, []);

  const setColumnOffset = useCallback((index: number, offset: number) => {
    setConfig((c) => {
      const columnOffsets = { ...c.columnOffsets };
      if (Math.abs(offset) < 0.01) delete columnOffsets[String(index)];
      else columnOffsets[String(index)] = Math.round(offset);
      return { ...c, columnOffsets };
    });
  }, []);

  const selectedStaander = selectedShelf?.startsWith("col:")
    ? model.panels.find((p) => p.staanderKey === selectedShelf) ?? null
    : null;

  const omitShelf = useCallback((key: string) => {
    setConfig((c) => ({ ...c, omittedShelves: { ...c.omittedShelves, [key]: true } }));
    setSelectedShelf(null);
  }, []);

  const selectedPlank =
    selectedShelf && !selectedShelf.startsWith("col:")
      ? model.panels.find((p) => p.shelfKey === selectedShelf) ?? null
      : null;

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

  /** Overlay in de viewer: opslaan-icoon rechtsboven en herstelmelding. */
  const viewerOverlay = (
    <>
      <SaveButton onClick={() => setSaveOpen(true)} />
      {restoreNote && (
        <p
          className="pointer-events-none absolute left-3 top-3 z-10 rounded-lg bg-emerald-50/95 px-3 py-1.5 text-xs text-emerald-800 shadow"
          role="status"
        >
          {restoreNote}
        </p>
      )}
    </>
  );

  const saveDialog = (
    <SaveDialog
      open={saveOpen}
      onClose={() => setSaveOpen(false)}
      config={config}
      lastSavedAt={lastSavedAt}
      onLoad={(c) => {
        setConfig(c);
        setSelectedShelf(null);
        setStep(0);
      }}
      onReset={() => {
        setConfig(DEFAULT_CONFIG);
        setSelectedShelf(null);
        setStep(0);
      }}
    />
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
            label="Diepte"
            options={[
              ...DEPTH_OPTIONS.map((o) => ({
                value: o.depth,
                label: `${formatMm(o.depth)} mm`,
                sub: `${o.stripsPerSheet} stroken`,
              })),
              { value: -1, label: "Eigen", sub: "vrije maat" },
            ]}
            value={isCustomDepth ? -1 : config.depth}
            onChange={(depth) =>
              update({ depth: depth === -1 ? 200 : depth })
            }
          />
          {isCustomDepth && (
            <Stepper
              label="Eigen diepte"
              value={config.depth}
              min={MIN_DEPTH}
              max={MAX_DEPTH}
              step={10}
              onChange={(depth) => update({ depth })}
              hint={customDepthHint}
            />
          )}
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
          <Segmented
            label="Voorkant"
            options={[
              { value: "recht", label: "Recht" },
              { value: "golf", label: "Golf" },
              { value: "bol", label: "Bol" },
              { value: "hol", label: "Hol" },
              { value: "schuin", label: "Schuin" },
            ]}
            value={config.frontProfile.type}
            onChange={(type) =>
              update({
                frontProfile: { ...config.frontProfile, type: type as FrontProfile["type"] },
              })
            }
          />
          {config.frontProfile.type !== "recht" && (
            <Stepper
              label="Glooiing (terugwijking voorkant)"
              value={config.frontProfile.amplitude}
              min={10}
              max={Math.max(10, config.depth - MIN_PROFILE_DEPTH)}
              step={10}
              onChange={(amplitude) =>
                update({ frontProfile: { ...config.frontProfile, amplitude } })
              }
              hint="staanders krijgen elk hun eigen diepte, planken een gebogen voorrand"
            />
          )}
          {config.frontProfile.type === "golf" && (
            <Stepper
              label="Aantal golven"
              value={config.frontProfile.periodes}
              min={1}
              max={6}
              step={1}
              unit=""
              onChange={(periodes) =>
                update({ frontProfile: { ...config.frontProfile, periodes } })
              }
            />
          )}
          {config.frontProfile.type !== "recht" && (
            <Toggle
              label="Profiel spiegelen"
              hint="links ↔ rechts omdraaien"
              checked={Boolean(config.frontProfile.mirror)}
              onChange={(mirror) =>
                update({ frontProfile: { ...config.frontProfile, mirror } })
              }
            />
          )}
          <div className="mt-3 rounded-xl bg-neutral-50 p-3">
            <p className="text-sm font-medium">Achterzijde / muur</p>
            <p className="mt-1 text-xs text-neutral-500">
              Staat de muur scheef, geef dan op hoeveel mm de achterkant links en
              rechts moet worden ingekort; ertussen loopt het verloop lineair.
            </p>
            <div>
              <Stepper
                label="Inkorting links"
                value={config.backTaper.left}
                min={0}
                max={300}
                step={5}
                onChange={(left) => update({ backTaper: { ...config.backTaper, left } })}
              />
              <Stepper
                label="Inkorting rechts"
                value={config.backTaper.right}
                min={0}
                max={300}
                step={5}
                onChange={(right) => update({ backTaper: { ...config.backTaper, right } })}
              />
            </div>
            <p className="mt-2 text-xs text-neutral-500">
              Zit er een bestaande plint op de muur? De staanders krijgen dan
              achter-onder een inkeping en de onderste planken worden ingekort,
              zodat de kast strak tegen de muur valt.
            </p>
            <div>
              <Stepper
                label="Muurplint hoogte"
                value={config.wallSkirting.height}
                min={0}
                max={250}
                step={10}
                onChange={(height) =>
                  update({ wallSkirting: { ...config.wallSkirting, height } })
                }
              />
              <Stepper
                label="Muurplint diepte"
                value={config.wallSkirting.depth}
                min={0}
                max={40}
                step={2}
                onChange={(depth) =>
                  update({ wallSkirting: { ...config.wallSkirting, depth } })
                }
              />
            </div>
          </div>
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
            Vakbreedte: {formatMm(model.cellWidth)} mm.
          </p>
          <div className="mt-3">
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-sm font-medium">Indeling per kolom</span>
              <span className="text-xs text-neutral-500">
                tik of sleep een tussenplank
              </span>
            </div>
            <LayoutEditor
              model={model}
              offsets={config.shelfOffsets}
              columnOffsets={config.columnOffsets}
              selected={selectedShelf}
              onSelect={setSelectedShelf}
              onOffsetChange={setShelfOffset}
              onColumnOffsetChange={setColumnOffset}
              onRestore={onShelfTap}
            />
            {selectedStaander && selectedShelf ? (
              <div className="mt-2 rounded-xl bg-blue-50 p-3">
                <Stepper
                  label="Positie staander (hart)"
                  value={Math.round(selectedStaander.place.x + config.thickness / 2)}
                  min={0}
                  max={Math.round(model.snappedWidth)}
                  step={10}
                  onChange={(v) => {
                    const idx = Number(selectedShelf.replace("col:", ""));
                    const cur = selectedStaander.place.x + config.thickness / 2;
                    setColumnOffset(idx, (config.columnOffsets[String(idx)] ?? 0) + (v - cur));
                  }}
                  hint="minimaal 150 mm vakbreedte"
                />
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium active:bg-neutral-100"
                    onClick={() =>
                      setColumnOffset(Number(selectedShelf.replace("col:", "")), 0)
                    }
                  >
                    Terug op grid
                  </button>
                  <button
                    type="button"
                    className="btn-touch ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white active:bg-neutral-700"
                    onClick={() => setSelectedShelf(null)}
                  >
                    Klaar
                  </button>
                </div>
              </div>
            ) : null}
            {selectedPlank && selectedShelf ? (
              <div className="mt-2 rounded-xl bg-blue-50 p-3">
                <Stepper
                  label="Hoogte onderkant plank"
                  value={Math.round(selectedPlank.place.y)}
                  min={0}
                  max={config.height}
                  step={10}
                  onChange={(v) =>
                    setShelfOffset(
                      selectedShelf,
                      (config.shelfOffsets[selectedShelf] ?? 0) + (v - selectedPlank.place.y),
                    )
                  }
                  hint="minimaal 120 mm vakhoogte"
                />
                <div className="mt-1 flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium active:bg-neutral-100"
                    onClick={() => setShelfOffset(selectedShelf, 0)}
                  >
                    Terug op grid
                  </button>
                  <button
                    type="button"
                    className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium active:bg-neutral-100"
                    onClick={() => omitShelf(selectedShelf)}
                  >
                    Plank weglaten
                  </button>
                  <button
                    type="button"
                    className="btn-touch ml-auto rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white active:bg-neutral-700"
                    onClick={() => setSelectedShelf(null)}
                  >
                    Klaar
                  </button>
                </div>
              </div>
            ) : selectedStaander ? null : (
              <p className="mt-2 text-xs text-neutral-500">
                Selecteer een tussenplank (hier of in 3D) om hem hoger/lager te
                zetten of weg te laten, of een binnenstaander om hem naar links
                of rechts te schuiven. Weggelaten planken zijn gestippeld — tik
                erop om ze terug te zetten.
              </p>
            )}
            {(Object.keys(config.omittedShelves).length > 0 ||
              Object.keys(config.shelfOffsets).length > 0 ||
              Object.keys(config.columnOffsets).length > 0) && (
              <button
                type="button"
                className="btn-touch mt-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium text-neutral-700 active:bg-neutral-100"
                onClick={() => {
                  update({ omittedShelves: {}, shelfOffsets: {}, columnOffsets: {} });
                  setSelectedShelf(null);
                }}
              >
                Alles terug naar het grid
              </button>
            )}
          </div>
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
            label="Materiaal"
            options={SHEET_MATERIALS.map((mat) => ({
              value: mat.id,
              label: mat.naam.split(" ")[0],
            }))}
            value={config.materialId}
            onChange={(materialId) => {
              const mat = materialById(materialId);
              const dikte = mat.diktes.includes(config.nominalThickness)
                ? config.nominalThickness
                : mat.diktes.reduce((best, d) =>
                    Math.abs(d - config.nominalThickness) <
                    Math.abs(best - config.nominalThickness)
                      ? d
                      : best,
                  );
              update({ materialId, nominalThickness: dikte, thickness: dikte });
            }}
          />
          <Segmented
            label="Plaatdikte"
            options={materialById(config.materialId).diktes.map((d) => ({
              value: d,
              label: `${d} mm`,
            }))}
            value={config.nominalThickness}
            onChange={(nominalThickness) =>
              update({ nominalThickness, thickness: nominalThickness })
            }
          />
          {config.joinery === "cabineo" && (
            <Segmented
              label="Cabineo-maat"
              options={[
                { value: 8, label: "Cabineo 8", sub: "plaat ≥ 16 mm" },
                { value: 12, label: "Cabineo 12", sub: "plaat ≥ 19 mm" },
              ]}
              value={config.cabineoSize}
              onChange={(cabineoSize) => update({ cabineoSize })}
            />
          )}
          {config.joinery === "cabineo" && (
            <Segmented
              label="Cabineo-bewerking"
              options={[
                { value: "frees10", label: "Frees", sub: "Ø10 of kleiner" },
                { value: "frees12", label: "Frees Ø12", sub: "met brugjes" },
                { value: "boor15", label: "Boren", sub: "3 × Ø15" },
              ]}
              value={config.cabineoVariant}
              onChange={(cabineoVariant) => update({ cabineoVariant })}
            />
          )}
          <Segmented
            label="Rug"
            options={[
              { value: "per-vak", label: "Per vak", sub: "tik vakken aan/uit" },
              { value: "volledig", label: "Volledig dicht", sub: "hele achterwand" },
            ]}
            value={config.rugMode}
            onChange={(rugMode) => update({ rugMode })}
          />
          <label className="flex items-center justify-between py-2 text-sm">
            <span className="font-medium">Kleur rug</span>
            <span className="flex items-center gap-2">
              {CABINET_COLORS.slice(0, 4).map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.naam}
                  aria-label={`Rug ${c.naam}`}
                  className={`btn-touch h-8 w-8 rounded-full border-2 ${
                    config.rugColor.toLowerCase() === c.hex ? "border-accent" : "border-neutral-200"
                  }`}
                  style={{ background: c.hex }}
                  onClick={() => update({ rugColor: c.hex })}
                />
              ))}
              <input
                type="color"
                aria-label="Eigen rugkleur"
                value={config.rugColor}
                onChange={(e) => update({ rugColor: e.target.value })}
                className="h-9 w-14 cursor-pointer rounded-lg border border-neutral-300 bg-white"
              />
            </span>
          </label>
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
          {config.base === "plint" && (
            <div className="rounded-xl bg-neutral-50 p-3">
              <Segmented
                label="Plint t.o.v. voorkant"
                options={[
                  { value: "standaard", label: "Terug", sub: `${PLINTH_SETBACK} mm` },
                  { value: "flush", label: "Vlak", sub: "gelijk met voorkant" },
                  { value: "eigen", label: "Eigen", sub: "vrije maat" },
                ]}
                value={plinthMode}
                onChange={(mode) => {
                  setCustomPlinth(mode === "eigen");
                  if (mode === "standaard") update({ plinthSetback: PLINTH_SETBACK });
                  else if (mode === "flush") update({ plinthSetback: 0 });
                }}
              />
              {plinthMode === "eigen" && (
                <Stepper
                  label="Plint terugliggend"
                  value={config.plinthSetback}
                  min={0}
                  max={MAX_PLINTH_SETBACK}
                  step={5}
                  hint="0 = vlak met de voorkant"
                  onChange={(plinthSetback) => update({ plinthSetback })}
                />
              )}
              <p className="mt-1 text-xs text-neutral-500">
                Plint van {PLINTH_HEIGHT} mm hoog tussen de buitenste staanders; bij
                een voorkantprofiel ligt hij achter het ondiepste punt.
              </p>
            </div>
          )}
          {config.base === "pootjes" && (
            <div className="rounded-xl bg-neutral-50 p-3">
              <Segmented
                label="Pootjes"
                options={[
                  { value: "rond", label: "Rond" },
                  { value: "vierkant", label: "Vierkant" },
                  { value: "conisch", label: "Conisch" },
                ]}
                value={config.feet.type}
                onChange={(type) => update({ feet: { ...config.feet, type } })}
              />
              <div>
                <Stepper
                  label="Hoogte"
                  value={config.feet.height}
                  min={40}
                  max={250}
                  step={10}
                  onChange={(height) => update({ feet: { ...config.feet, height } })}
                />
                <Stepper
                  label="Dikte"
                  value={config.feet.size}
                  min={20}
                  max={100}
                  step={5}
                  onChange={(size) => update({ feet: { ...config.feet, size } })}
                />
              </div>
              <label className="mt-1 flex items-center justify-between text-sm">
                <span className="font-medium">Kleur pootjes</span>
                <input
                  type="color"
                  value={config.feet.color}
                  onChange={(e) => update({ feet: { ...config.feet, color: e.target.value } })}
                  className="h-9 w-14 cursor-pointer rounded-lg border border-neutral-300 bg-white"
                />
              </label>
              <p className="mt-1 text-xs text-neutral-500">
                2 pootjes per staander; de romp wordt met de poothoogte verkort
                zodat de totale hoogte gelijk blijft.
              </p>
            </div>
          )}
          <div className="py-2">
            <span className="text-sm font-medium">Kleur kast</span>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {CABINET_COLORS.map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  title={c.naam}
                  aria-label={c.naam}
                  className={`btn-touch h-9 w-9 rounded-full border-2 ${
                    config.color.toLowerCase() === c.hex ? "border-accent" : "border-neutral-200"
                  }`}
                  style={{ background: c.hex }}
                  onClick={() => update({ color: c.hex })}
                />
              ))}
              <input
                type="color"
                aria-label="Eigen kleur"
                value={config.color}
                onChange={(e) => update({ color: e.target.value })}
                className="h-9 w-14 cursor-pointer rounded-lg border border-neutral-300 bg-white"
              />
            </div>
          </div>
          <Stepper
            label="Gemeten plaatdikte"
            value={config.thickness}
            min={config.nominalThickness - 1.5}
            max={config.nominalThickness + 1.5}
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
              {config.rugMode === "volledig"
                ? "De hele achterzijde wordt dicht gezet met 4 mm HDF, opgedeeld in stukken die op de plaat passen; de naden vallen achter staanders."
                : "Tik op een vak in de 3D-weergave om een rugpaneel (4 mm HDF) toe te voegen of te verwijderen. De generator stelt hoekvakken en de onderste rij voor als minimale set tegen schranken."}
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
          {admin.toonKosten && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Machinetijd & kosten</h3>
              <ul className="space-y-1 rounded-2xl border border-neutral-200 p-3 text-xs text-neutral-600">
                {costLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          )}
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
      {saveDialog}
      {/* Mobiel: 3D bovenin (sticky), bottom sheet eronder. */}
      <div className="lg:hidden">
        <div className="fixed inset-x-0 top-0 h-[55dvh]">
          <Viewer3D
            model={model}
            onCellTap={onCellTap}
            onShelfTap={onShelfTap}
            selectedShelf={selectedShelf}
          />
          {viewerOverlay}
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
          <Viewer3D
            model={model}
            onCellTap={onCellTap}
            onShelfTap={onShelfTap}
            selectedShelf={selectedShelf}
          />
          {viewerOverlay}
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
          {admin.toonKosten && (
            <>
              <h3 className="mb-2 text-sm font-semibold">Machinetijd & kosten</h3>
              <ul className="mb-4 space-y-1 rounded-2xl border border-neutral-200 p-3 text-xs text-neutral-600">
                {costLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </>
          )}
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
