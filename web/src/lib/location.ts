import { useSyncExternalStore } from "react";
import type { Vendor } from "@/types";
import { AREA_EN } from "@/constants/taiwanDistricts";
import { tr } from "@/lib/i18n";

// Top bar "Choose area": county/city + (optional) township/district; home / vendor list / resale market filter by vendor address.
// Stored in localStorage as this device's browsing preference only; if reads/writes fail (private mode), treat it as nothing selected.
export interface SelectedArea {
  county: string;
  town?: string;
}

const STORAGE_KEY = "bunnbaa.area";
const listeners = new Set<() => void>();

function read(): SelectedArea | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.county === "string" ? parsed : null;
  } catch {
    return null;
  }
}

let current: SelectedArea | null = read();

export function setSelectedArea(area: SelectedArea | null) {
  current = area;
  try {
    if (area) localStorage.setItem(STORAGE_KEY, JSON.stringify(area));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // If it can't be saved, it only lasts for this visit
  }
  listeners.forEach((fn) => fn());
}

export function useSelectedArea(): SelectedArea | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current
  );
}

/** Display name of a county/city, or of a township/district within it (English UI: romanized; stored values stay Chinese) */
export function areaName(county: string, town?: string): string {
  const zh = town ?? county;
  return tr(zh, AREA_EN[town ? `${county}|${town}` : county] ?? zh);
}

export function areaLabel(area: SelectedArea | null): string {
  if (!area) return "";
  return tr(`${area.county}${area.town ? ` ${area.town}` : ""}`, area.town ? `${areaName(area.county, area.town)}, ${areaName(area.county)}` : areaName(area.county));
}

// Addresses often mix 台 and 臺; normalize to 臺 before comparing
const normalize = (s: string) => s.replace(/台/g, "臺").replace(/\s+/g, "");

/** No area selected = everything matches; otherwise check whether the vendor address contains that county/city (and township/district). Vendors without an address don't match. */
export function vendorInArea(vendor: Pick<Vendor, "address"> | undefined, area: SelectedArea | null): boolean {
  if (!area) return true;
  const address = normalize(vendor?.address ?? "");
  if (!address.includes(normalize(area.county))) return false;
  return !area.town || address.includes(normalize(area.town));
}
