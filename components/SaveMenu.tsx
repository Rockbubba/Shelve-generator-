"use client";

import { useEffect, useState } from "react";
import { CabinetConfig } from "@/lib/config";
import {
  SavedDesign,
  deleteDesign,
  formatSavedAt,
  listDesigns,
  saveDesign,
  shareUrl,
} from "@/lib/storage";

interface Props {
  config: CabinetConfig;
  onLoad: (config: CabinetConfig) => void;
  onReset: () => void;
  /** Tijdstip van de laatste automatische opslag, voor de statusregel. */
  lastSavedAt: number | null;
}

/**
 * Opslaan-menu: benoemde ontwerpen bewaren en terughalen, deellink kopiëren,
 * opnieuw beginnen. Compact genoeg voor de bottom sheet op mobiel.
 */
export default function SaveMenu({ config, onLoad, onReset, lastSavedAt }: Props) {
  const [open, setOpen] = useState(false);
  const [naam, setNaam] = useState("");
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    if (open) setDesigns(listDesigns());
  }, [open]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  const doSave = () => {
    const d = saveDesign(naam, config);
    setDesigns(listDesigns());
    setNaam("");
    setFlash(`"${d.naam}" opgeslagen`);
  };

  const copyLink = async () => {
    const url = shareUrl(config);
    try {
      if (navigator.share) {
        await navigator.share({ title: "Boekenkast-ontwerp", url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setFlash("Deellink gekopieerd");
    } catch {
      // Gebruiker annuleerde het delen of clipboard is geblokkeerd.
      window.prompt("Kopieer deze link:", url);
    }
  };

  return (
    <div className="mb-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm font-medium"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? "Sluiten" : "Opslaan / laden"}
        </button>
        <span className="text-xs text-neutral-500" aria-live="polite">
          {flash ??
            (lastSavedAt
              ? `Automatisch bewaard ${formatSavedAt(lastSavedAt)}`
              : "Wordt automatisch bewaard in deze browser")}
        </span>
      </div>

      {open && (
        <div className="mt-2 space-y-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
          <div>
            <label className="text-sm font-medium" htmlFor="ontwerp-naam">
              Ontwerp opslaan
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="ontwerp-naam"
                type="text"
                value={naam}
                onChange={(e) => setNaam(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doSave();
                }}
                placeholder="Naam, bijv. Woonkamer"
                className="min-w-0 flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
              <button
                type="button"
                className="btn-touch rounded-lg bg-neutral-900 px-3 py-2 text-sm font-medium text-white"
                onClick={doSave}
              >
                Opslaan
              </button>
            </div>
          </div>

          {designs.length > 0 && (
            <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
              {designs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{d.naam}</p>
                    <p className="text-xs text-neutral-500">
                      {formatSavedAt(d.savedAt)} · {d.config.width} × {d.config.height} ×{" "}
                      {d.config.depth} mm
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-touch rounded-lg border border-neutral-300 px-2 py-1 text-xs font-medium"
                    onClick={() => {
                      onLoad(d.config);
                      setFlash(`"${d.naam}" geladen`);
                      setOpen(false);
                    }}
                  >
                    Laden
                  </button>
                  <button
                    type="button"
                    className="btn-touch rounded-lg px-2 py-1 text-xs text-neutral-500"
                    aria-label={`Verwijder ${d.naam}`}
                    onClick={() => {
                      deleteDesign(d.id);
                      setDesigns(listDesigns());
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium"
              onClick={copyLink}
            >
              Deellink kopiëren
            </button>
            <button
              type="button"
              className="btn-touch rounded-lg px-3 py-2 text-sm text-red-700"
              onClick={() => {
                if (window.confirm("Alles terug naar de standaardkast? Opgeslagen ontwerpen blijven bewaard.")) {
                  onReset();
                  setOpen(false);
                }
              }}
            >
              Opnieuw beginnen
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            Ontwerpen staan in deze browser. Gebruik de deellink om een ontwerp op een
            ander apparaat te openen of naar ons te sturen.
          </p>
        </div>
      )}
    </div>
  );
}
