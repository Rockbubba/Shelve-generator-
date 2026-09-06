"use client";

/**
 * Admin-instellingen: machineparameters en plaatprijzen. Niet zichtbaar in
 * de klant-UI; beheer via de (ongelinkte) /admin-pagina. Opslag in
 * localStorage van de browser — dus per apparaat, en géén echte beveiliging:
 * wie de URL kent kan erbij. Voor een publieke deploy hoort hier later een
 * echte login/backend achter.
 */

import { useEffect, useState } from "react";
import { materialById } from "./config";
import { MACHINE, MachineParams } from "./costing";

export interface AdminSettings {
  machine: MachineParams;
  /** Plaatprijs per materiaal-id per dikte (EUR per plaat 2440 × 1220). */
  prijzen: Record<string, Record<string, number>>;
  /** Kostenblok tonen aan de klant. */
  toonKosten: boolean;
}

export const DEFAULT_ADMIN_SETTINGS: AdminSettings = {
  machine: MACHINE,
  prijzen: {},
  toonKosten: true,
};

const STORAGE_KEY = "boekenkast-admin-settings";
const CHANGE_EVENT = "boekenkast-admin-settings-changed";

export function loadAdminSettings(): AdminSettings {
  if (typeof window === "undefined") return DEFAULT_ADMIN_SETTINGS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_ADMIN_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AdminSettings>;
    return {
      machine: { ...MACHINE, ...(parsed.machine ?? {}) },
      prijzen: parsed.prijzen ?? {},
      toonKosten: parsed.toonKosten ?? true,
    };
  } catch {
    return DEFAULT_ADMIN_SETTINGS;
  }
}

export function saveAdminSettings(settings: AdminSettings) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage niet beschikbaar (privémodus e.d.): instellingen gelden
    // dan alleen voor de huidige sessie.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** React-hook die live meebeweegt met wijzigingen vanaf de admin-pagina. */
export function useAdminSettings(): AdminSettings {
  const [settings, setSettings] = useState<AdminSettings>(DEFAULT_ADMIN_SETTINGS);
  useEffect(() => {
    const refresh = () => setSettings(loadAdminSettings());
    refresh();
    window.addEventListener(CHANGE_EVENT, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(CHANGE_EVENT, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return settings;
}

/** Plaatprijs: admin-invoer wint van eventuele defaults in SHEET_MATERIALS. */
export function priceForSheet(
  settings: AdminSettings,
  materialId: string,
  dikte: number,
): number | undefined {
  const admin = settings.prijzen[materialId]?.[String(dikte)];
  if (admin !== undefined && admin > 0) return admin;
  return materialById(materialId).prijsPerPlaat?.[dikte];
}
