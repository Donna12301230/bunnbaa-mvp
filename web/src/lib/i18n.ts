import { useSyncExternalStore } from "react";
import { enUS, zhTW } from "date-fns/locale";

// 介面語言（中文／英文）。字串直接中英並排寫在元件裡：t("預購餐點", "Pre-order")，
// 不另外維護 key 對照表——只有兩種語言，並排比較好對照、也不會漏翻。
// 資料庫內容（店名、菜名、店家簡介）照原文顯示，不翻譯。
// 選擇記在 localStorage，讀寫失敗（無痕模式）就用中文。
export type Lang = "zh" | "en";

const STORAGE_KEY = "bunnbaa.lang";
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    return localStorage.getItem(STORAGE_KEY) === "en" ? "en" : "zh";
  } catch {
    return "zh";
  }
}

let current: Lang = readLang();
applyHtmlLang(current);

function applyHtmlLang(lang: Lang) {
  if (typeof document !== "undefined") document.documentElement.lang = lang === "en" ? "en" : "zh-Hant-TW";
}

export function setLang(lang: Lang) {
  current = lang;
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // 存不了就只在這次瀏覽有效
  }
  applyHtmlLang(lang);
  listeners.forEach((fn) => fn());
}

export function getLang(): Lang {
  return current;
}

/**
 * 依目前語言挑字串。App.tsx 以語言當 Router 的 key，切換時整棵路由樹重新掛載，
 * 所以元件 render、toast、工具函式裡都可以直接用；useI18n 另外給 date-fns locale。
 */
export function tr(zh: string, en: string): string {
  return current === "en" ? en : zh;
}

/**
 * 資料庫內容的在地化欄位：英文介面優先讀 `${field}_en`（Functions 用 Gemini 自動翻的），
 * 沒有就顯示原本的中文。例：loc(vendor, "name")、loc(lock, "item_name")。
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

/** 計畫型訂單的品名去掉「・第1/5天」／「 · Day 1/5」，彙總時同一個方案併成一項 */
export function planBaseName(itemName: string): string {
  return itemName.split("・第")[0].split(" · Day ")[0];
}

/** date-fns 的 locale（依目前語言） */
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
    /** date-fns 的 locale */
    dateLocale: lang === "en" ? enUS : zhTW,
  };
}
