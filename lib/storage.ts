/**
 * Opslag van ontwerpen in de browser (localStorage) plus deelbare links.
 *
 * - Concept: elke wijziging wordt automatisch bewaard, zodat een refresh of
 *   het per ongeluk sluiten van de tab niets kost.
 * - Opgeslagen ontwerpen: benoemde momentopnames die de klant later kan
 *   terughalen of verwijderen.
 * - Deellink: de complete configuratie in de URL (`?o=…`), zodat een
 *   ontwerp naar een ander apparaat of naar ons gestuurd kan worden.
 *
 * Alles is per browser/apparaat; er is geen backend.
 */

import { CabinetConfig, DEFAULT_CONFIG } from "./config";

const DRAFT_KEY = "boekenkast-concept";
const DESIGNS_KEY = "boekenkast-ontwerpen";
export const URL_PARAM = "o";

export interface Draft {
  config: CabinetConfig;
  step: number;
  /** Tijdstip van de laatste wijziging (ms sinds epoch). */
  savedAt: number;
}

export interface SavedDesign {
  id: string;
  naam: string;
  savedAt: number;
  config: CabinetConfig;
}

/**
 * Vul een (mogelijk oudere of onvolledige) configuratie aan met de
 * standaardwaarden, zodat velden die later zijn toegevoegd altijd bestaan.
 */
export function normalizeConfig(raw: unknown): CabinetConfig {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<CabinetConfig>;
  const obj = <T extends object>(base: T, v: unknown): T =>
    v && typeof v === "object" ? { ...base, ...(v as Partial<T>) } : base;
  return {
    ...DEFAULT_CONFIG,
    ...r,
    cellFills: obj(DEFAULT_CONFIG.cellFills, r.cellFills),
    omittedShelves: obj(DEFAULT_CONFIG.omittedShelves, r.omittedShelves),
    shelfOffsets: obj(DEFAULT_CONFIG.shelfOffsets, r.shelfOffsets),
    columnOffsets: obj(DEFAULT_CONFIG.columnOffsets, r.columnOffsets),
    frontProfile: obj(DEFAULT_CONFIG.frontProfile, r.frontProfile),
    backTaper: obj(DEFAULT_CONFIG.backTaper, r.backTaper),
    wallSkirting: obj(DEFAULT_CONFIG.wallSkirting, r.wallSkirting),
    feet: obj(DEFAULT_CONFIG.feet, r.feet),
    led: obj(DEFAULT_CONFIG.led, r.led),
  };
}

function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

// ---- Concept (automatisch) --------------------------------------------------

export function loadDraft(): Draft | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Draft>;
    if (!parsed.config) return null;
    return {
      config: normalizeConfig(parsed.config),
      step: typeof parsed.step === "number" ? parsed.step : 0,
      savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveDraft(config: CabinetConfig, step: number): void {
  const s = storage();
  if (!s) return;
  try {
    const draft: Draft = { config, step, savedAt: Date.now() };
    s.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Opslag vol of geblokkeerd: dan alleen in het geheugen van deze tab.
  }
}

export function clearDraft(): void {
  storage()?.removeItem(DRAFT_KEY);
}

// ---- Opgeslagen ontwerpen ---------------------------------------------------

export function listDesigns(): SavedDesign[] {
  const s = storage();
  if (!s) return [];
  try {
    const raw = s.getItem(DESIGNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((d) => d && typeof d.id === "string" && d.config)
      .map((d) => ({
        id: d.id,
        naam: String(d.naam ?? "Ontwerp"),
        savedAt: typeof d.savedAt === "number" ? d.savedAt : 0,
        config: normalizeConfig(d.config),
      }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function writeDesigns(designs: SavedDesign[]): void {
  const s = storage();
  if (!s) return;
  try {
    s.setItem(DESIGNS_KEY, JSON.stringify(designs));
  } catch {
    // zie saveDraft
  }
}

/** Sla op onder een naam; een bestaande naam wordt overschreven. */
export function saveDesign(naam: string, config: CabinetConfig): SavedDesign {
  const trimmed = naam.trim() || `Ontwerp ${new Date().toLocaleDateString("nl-NL")}`;
  const designs = listDesigns().filter((d) => d.naam.toLowerCase() !== trimmed.toLowerCase());
  const design: SavedDesign = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    naam: trimmed,
    savedAt: Date.now(),
    config,
  };
  writeDesigns([design, ...designs]);
  return design;
}

export function deleteDesign(id: string): void {
  writeDesigns(listDesigns().filter((d) => d.id !== id));
}

// ---- Deellink ---------------------------------------------------------------

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Alleen de velden die afwijken van de standaard, compact als base64url. */
export function encodeConfig(config: CabinetConfig): string {
  const diff: Record<string, unknown> = {};
  for (const key of Object.keys(config) as (keyof CabinetConfig)[]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(DEFAULT_CONFIG[key])) {
      diff[key] = config[key];
    }
  }
  return toBase64Url(JSON.stringify(diff));
}

export function decodeConfig(encoded: string): CabinetConfig | null {
  try {
    return normalizeConfig(JSON.parse(fromBase64Url(encoded)));
  } catch {
    return null;
  }
}

export function shareUrl(config: CabinetConfig): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set(URL_PARAM, encodeConfig(config));
  return url.toString();
}

/** Configuratie uit de huidige URL (deellink), of null. */
export function configFromUrl(): CabinetConfig | null {
  if (typeof window === "undefined") return null;
  const param = new URLSearchParams(window.location.search).get(URL_PARAM);
  return param ? decodeConfig(param) : null;
}

export function formatSavedAt(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("nl-NL", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
