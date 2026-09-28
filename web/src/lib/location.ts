import { useSyncExternalStore } from "react";
import type { Vendor } from "@/types";

// 頂部列「選擇地區」：縣市＋（選填）鄉鎮市區，首頁／商家列表／轉讓市集依店家地址篩選。
// 記在 localStorage，只是這台裝置的瀏覽偏好，讀寫失敗（無痕模式）就當沒選。
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
    // 存不了就只在這次瀏覽有效
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

export function areaLabel(area: SelectedArea | null): string {
  return area ? `${area.county}${area.town ? ` ${area.town}` : ""}` : "";
}

// 地址常混用「台」「臺」，統一成「臺」再比對
const normalize = (s: string) => s.replace(/台/g, "臺").replace(/\s+/g, "");

/** 沒選地區＝全部符合；選了就看店家地址有沒有包含該縣市（與鄉鎮市區）。沒填地址的店家不符合。 */
export function vendorInArea(vendor: Pick<Vendor, "address"> | undefined, area: SelectedArea | null): boolean {
  if (!area) return true;
  const address = normalize(vendor?.address ?? "");
  if (!address.includes(normalize(area.county))) return false;
  return !area.town || address.includes(normalize(area.town));
}
