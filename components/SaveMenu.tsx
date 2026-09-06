"use client";

import { useEffect, useRef, useState } from "react";
import { CabinetConfig } from "@/lib/config";
import {
  SavedDesign,
  deleteDesign,
  formatSavedAt,
  listDesigns,
  saveDesign,
  shareUrl,
} from "@/lib/storage";

/** Icoonknop rechtsboven in de viewer die het opslaan-dialoog opent. */
export function SaveButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Ontwerp opslaan of laden"
      title="Opslaan / laden"
      className="btn-touch absolute right-3 top-3 z-10 flex h-11 w-11 items-center justify-center rounded-full bg-white/90 text-neutral-800 shadow-md ring-1 ring-neutral-200 backdrop-blur hover:bg-white active:scale-95"
    >
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {/* Diskette / bewaar-icoon */}
        <path d="M5 3h11l3 3v15a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" />
        <path d="M8 3v6h8V3" />
        <rect x="8" y="14" width="8" height="7" rx="1" />
      </svg>
    </button>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  config: CabinetConfig;
  onLoad: (config: CabinetConfig) => void;
  onReset: () => void;
  /** Tijdstip van de laatste automatische opslag, voor de statusregel. */
  lastSavedAt: number | null;
}

/**
 * Dialoogvenster: benoemde ontwerpen bewaren en terughalen, deellink
 * kopiëren, opnieuw beginnen. Sluit met ✕, Escape of een tik buiten het venster.
 */
export default function SaveDialog({ open, onClose, config, onLoad, onReset, lastSavedAt }: DialogProps) {
  const [naam, setNaam] = useState("");
  const [designs, setDesigns] = useState<SavedDesign[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDesigns(listDesigns());
    setFlash(null);
    const t = setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2500);
    return () => clearTimeout(t);
  }, [flash]);

  if (!open) return null;

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
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="opslaan-titel"
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:max-w-md sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div>
            <h2 id="opslaan-titel" className="text-lg font-bold">
              Ontwerp opslaan / laden
            </h2>
            <p className="text-xs text-neutral-500" aria-live="polite">
              {flash ??
                (lastSavedAt
                  ? `Automatisch bewaard ${formatSavedAt(lastSavedAt)}`
                  : "Wordt automatisch bewaard in deze browser")}
            </p>
          </div>
          <button
            type="button"
            className="btn-touch -mr-2 -mt-2 flex h-10 w-10 items-center justify-center rounded-full text-xl text-neutral-500 hover:bg-neutral-100"
            aria-label="Sluiten"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium" htmlFor="ontwerp-naam">
              Opslaan als
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="ontwerp-naam"
                ref={inputRef}
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
                className="btn-touch rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
                onClick={doSave}
              >
                Opslaan
              </button>
            </div>
          </div>

          <div>
            <p className="mb-1 text-sm font-medium">Opgeslagen ontwerpen</p>
            {designs.length === 0 ? (
              <p className="rounded-lg border border-dashed border-neutral-300 px-3 py-3 text-sm text-neutral-500">
                Nog geen opgeslagen ontwerpen.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-200 rounded-lg border border-neutral-200">
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
                      className="btn-touch rounded-lg border border-neutral-300 px-3 py-1.5 text-xs font-medium"
                      onClick={() => {
                        onLoad(d.config);
                        onClose();
                      }}
                    >
                      Laden
                    </button>
                    <button
                      type="button"
                      className="btn-touch rounded-lg px-2 py-1 text-neutral-500 hover:text-red-700"
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-touch rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm font-medium"
              onClick={copyLink}
            >
              Deellink kopiëren
            </button>
            <button
              type="button"
              className="btn-touch ml-auto rounded-lg px-3 py-2 text-sm text-red-700"
              onClick={() => {
                if (window.confirm("Alles terug naar de standaardkast? Opgeslagen ontwerpen blijven bewaard.")) {
                  onReset();
                  onClose();
                }
              }}
            >
              Opnieuw beginnen
            </button>
          </div>
          <p className="text-xs text-neutral-500">
            Ontwerpen staan in deze browser. Gebruik de deellink om een ontwerp op een ander
            apparaat te openen of naar ons te sturen.
          </p>
        </div>
      </div>
    </div>
  );
}
