import { useSyncExternalStore } from "react";
import { enUS, zhTW } from "date-fns/locale";

// UI language (Chinese / English). Strings are written side by side in the components: t("預購餐點", "Pre-order"),
// with no separate key table: with only two languages, side by side is easier to compare and nothing gets missed.
// Database content (store names, dish names, vendor descriptions) is shown as written, not translated.
// Language order: ?lang=en|zh in the URL (also accepted inside the hash, e.g. #/?lang=en; it is
// remembered) → the choice saved in localStorage → the browser language (zh-* gets Chinese,
// anything else English, so judges and overseas visitors land on the English UI).
export type Lang = "zh" | "en";

const STORAGE_KEY = "bunnbaa.lang";
const listeners = new Set<() => void>();

function langFromUrl(): Lang | null {
  if (typeof window === "undefined") return null;
  const hashQuery = window.location.hash.split("?")[1] ?? "";
  const v =
    new URLSearchParams(window.location.search).get("lang") ?? new URLSearchParams(hashQuery).get("lang");
  return v === "en" || v === "zh" ? v : null;
}

function browserLang(): Lang {
  if (typeof navigator === "undefined") return "zh";
  return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

function readLang(): Lang {
  const fromUrl = langFromUrl();
  try {
    if (fromUrl) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "en" || saved === "zh") return saved;
  } catch {
    // Storage unavailable (some private windows): fall through
  }
  return fromUrl ?? browserLang();
}

let current: Lang = readLang();
applyHtmlLang(current);

function applyHtmlLang(lang: Lang) {
  if (typeof document === "undefined") return;
  document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
  // The tab title in index.html is Chinese; English visitors (e.g. ?lang=en) would otherwise see it on the tab
  document.title = lang === "en" ? "BunnBaa | Book early, eat happy" : "BunnBaa 飯飽｜越早訂，越開心";
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // If it can't be saved, it only lasts for this visit
  }
  applyHtmlLang(lang);
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return current;
}

/**
 * Picks the string for the current language. App.tsx uses the language as the Router key, so switching remounts the whole route tree;
 * that makes it safe to use directly in component renders, toasts and utility functions. useI18n also provides the date-fns locale.
 */
export function tr(zh: string, en: string): string {
  return current === "en" ? en : zh;
}

/**
 * Localized fields for database content: the English UI reads `${field}_en` first (auto-translated by Functions with Gemini),
 * falling back to the original Chinese. E.g. loc(vendor, "name"), loc(lock, "item_name").
 */
export function loc<T extends object>(obj: T | null | undefined, field: keyof T & string): string {
  if (!obj) return "";
  const zh = (obj as Record<string, unknown>)[field];
  if (current === "en") {
    const en = (obj as Record<string, unknown>)[`${field}_en`];
    if (typeof en === "string" && en.trim()) return en;
  }
  return typeof zh === "string" ? zh : "";
}

/**
 * Dish names, side categories and custom-field text inside a menu item: the English UI reads the item's dish_names_en map
 * (filled by Functions translateMenuItem), falling back to the original Chinese. E.g. dishName(item, slot.default.name).
 */
export function dishName(item: { dish_names_en?: Record<string, string> } | null | undefined, name: string): string {
  if (current === "en") {
    const en = item?.dish_names_en?.[name];
    if (typeof en === "string" && en.trim()) return en;
  }
  return name;
}

/** Strips "・第1/5天" / " · Day 1/5" from meal-plan order item names so one plan merges into a single entry in summaries */
export function planBaseName(itemName: string): string {
  return itemName.split("・第")[0].split(" · Day ")[0];
}

/** date-fns locale (for the current language) */
export function dateLocale() {
  return current === "en" ? enUS : zhTW;
}

export function useI18n() {
  const lang = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current
  );
  return {
    lang,
    isEn: lang === "en",
    t: (zh: string, en: string) => (lang === "en" ? en : zh),
    /** date-fns locale */
    dateLocale: lang === "en" ? enUS : zhTW,
  };
}
