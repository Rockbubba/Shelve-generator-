"use client";

/**
 * Admin-menu (niet gelinkt vanuit de klant-UI): machineparameters en
 * plaatprijzen. Opslag in localStorage van dit apparaat.
 */

import { useEffect, useState } from "react";
import { SHEET_MATERIALS } from "@/lib/config";
import { formatEur } from "@/lib/costing";
import {
  AdminSettings,
  loadAdminSettings,
  saveAdminSettings,
} from "@/lib/settings";

const MACHINE_FIELDS: {
  key: keyof AdminSettings["machine"];
  label: string;
  step?: number;
}[] = [
  { key: "feed", label: "Voeding frezen (mm/min)", step: 100 },
  { key: "depthPerPass", label: "Snededieptes per pass (mm)", step: 1 },
  { key: "toolDiameter", label: "Freesdiameter uitruimen (mm)", step: 1 },
  { key: "stepover", label: "Stepover (fractie van frees)", step: 0.05 },
  { key: "drillSeconds", label: "Seconden per boring", step: 0.5 },
  { key: "drillSecondsPerMm", label: "Extra seconden per mm boordiepte", step: 0.05 },
  { key: "sheetSetupMinutes", label: "Insteltijd per plaat (min)", step: 1 },
  { key: "rateEurPerHour", label: "Machinetarief (€/uur)", step: 5 },
];

export default function AdminPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setSettings(loadAdminSettings());
  }, []);

  if (!settings) return null;

  const setMachine = (key: keyof AdminSettings["machine"], value: number) =>
    setSettings({
      ...settings,
      machine: { ...settings.machine, [key]: value },
    });

  const setPrice = (materialId: string, dikte: number, value: number) =>
    setSettings({
      ...settings,
      prijzen: {
        ...settings.prijzen,
        [materialId]: {
          ...(settings.prijzen[materialId] ?? {}),
          [String(dikte)]: value,
        },
      },
    });

  return (
    <main className="mx-auto max-w-3xl p-4 pb-16">
      <h1 className="mb-1 text-xl font-bold">Admin — machine & prijzen</h1>
      <p className="mb-6 text-xs text-neutral-500">
        Deze pagina is niet gelinkt vanuit de configurator. Instellingen worden
        in de browser van dit apparaat opgeslagen (localStorage) — dit is geen
        echte beveiliging; voor een publieke omgeving hoort hier een login
        achter.
      </p>

      <h2 className="mb-2 text-base font-semibold">Machineparameters</h2>
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MACHINE_FIELDS.map((f) => (
          <label key={f.key} className="block text-sm">
            <span className="mb-1 block text-neutral-600">{f.label}</span>
            <input
              type="number"
              step={f.step ?? 1}
              value={settings.machine[f.key]}
              onChange={(e) => setMachine(f.key, Number(e.target.value))}
              className="w-full rounded-xl border border-neutral-300 px-3 py-2"
            />
          </label>
        ))}
      </div>

      <h2 className="mb-2 text-base font-semibold">Plaatprijzen (€ per plaat 2440 × 1220)</h2>
      <div className="mb-6 space-y-4">
        {SHEET_MATERIALS.map((mat) => (
          <div key={mat.id} className="rounded-2xl border border-neutral-200 p-3">
            <p className="mb-2 text-sm font-medium">{mat.naam}</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {mat.diktes.map((d) => {
                const value = settings.prijzen[mat.id]?.[String(d)] ?? "";
                return (
                  <label key={d} className="block text-xs">
                    <span className="mb-0.5 block text-neutral-500">{d} mm</span>
                    <input
                      type="number"
                      min={0}
                      step={0.5}
                      placeholder="—"
                      value={value}
                      onChange={(e) => setPrice(mat.id, d, Number(e.target.value))}
                      className="w-full rounded-lg border border-neutral-300 px-2 py-1.5"
                    />
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <label className="mb-6 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={settings.toonKosten}
          onChange={(e) =>
            setSettings({ ...settings, toonKosten: e.target.checked })
          }
        />
        Kostenblok tonen aan de klant
      </label>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="rounded-xl bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white active:bg-neutral-700"
          onClick={() => {
            saveAdminSettings(settings);
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
          }}
        >
          Opslaan
        </button>
        <button
          type="button"
          className="rounded-xl border border-neutral-300 px-4 py-2.5 text-sm font-medium active:bg-neutral-100"
          onClick={() => {
            window.localStorage.removeItem("boekenkast-admin-settings");
            setSettings(loadAdminSettings());
          }}
        >
          Terug naar standaard
        </button>
        {saved ? <span className="text-sm text-green-700">Opgeslagen ✓</span> : null}
        <span className="ml-auto text-xs text-neutral-400">
          Voorbeeld: tarief {formatEur(settings.machine.rateEurPerHour)}/uur
        </span>
      </div>
    </main>
  );
}
