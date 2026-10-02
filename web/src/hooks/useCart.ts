import { useState, useEffect } from "react";
import type { ExtraSideChoice, MenuItem, RiceOption, SlotChoice } from "@/types";

// 購物車（存在 localStorage）。第一階段規格：每一行是一份（或多份同樣配置的）便當，
// 各自帶取餐日期、時段、主菜、配菜選擇（含第四道）、飯量、折價券——可預訂 30 天內，一次結帳可以
// 跨好幾天，但只能同一家店（折價券只能在發券店家用）。
// _v3：2026-09-30 改成便當格式，舊版購物車（沒有日期／配菜）直接丟掉。
const CART_KEY = "bento_cart_v3";

export interface CartLine {
  key: string;
  menuItem: MenuItem;
  vendorId: string;
  pickupDate: string;
  pickupWindow: string;
  choices: SlotChoice[];
  mainIndex?: number | null; // 選的主菜（menu_items.mains 的 index）
  extraSide?: ExtraSideChoice | null; // 第四道：備案或加菜
  rice: RiceOption;
  quantity: number;
  note: string;
  couponId?: string | null;
}

function load(): CartLine[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

let _lines: CartLine[] = load();
const _listeners = new Set<() => void>();

function save() {
  try {
    localStorage.setItem(CART_KEY, JSON.stringify(_lines));
  } catch {
    // 存不了就只在這次瀏覽有效
  }
  _listeners.forEach((fn) => fn());
}

function sameConfig(a: Omit<CartLine, "key" | "quantity">, b: Omit<CartLine, "key" | "quantity">) {
  return a.menuItem.id === b.menuItem.id && a.pickupDate === b.pickupDate && a.pickupWindow === b.pickupWindow
    && a.rice === b.rice && a.note === b.note && JSON.stringify(a.choices) === JSON.stringify(b.choices) && !a.couponId && !b.couponId
    && (a.mainIndex ?? null) === (b.mainIndex ?? null) && JSON.stringify(a.extraSide ?? null) === JSON.stringify(b.extraSide ?? null);
}

export const cartStore = {
  get lines() { return _lines; },
  get vendorId() { return _lines[0]?.vendorId ?? null; },
  get count() { return _lines.reduce((s, l) => s + l.quantity, 0); },

  /** 加入一行；別家店的品項會清空購物車（一次只跟一家店預購） */
  add(line: Omit<CartLine, "key">) {
    if (_lines.length > 0 && _lines[0].vendorId !== line.vendorId) _lines = [];
    const existing = _lines.find((l) => sameConfig(l, line));
    if (existing) {
      _lines = _lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + line.quantity } : l));
    } else {
      _lines = [..._lines, { ...line, key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }];
    }
    save();
  },
  update(key: string, patch: Partial<CartLine>) {
    _lines = _lines.map((l) => (l.key === key ? { ...l, ...patch } : l)).filter((l) => l.quantity > 0);
    save();
  },
  remove(key: string) {
    _lines = _lines.filter((l) => l.key !== key);
    save();
  },
  clear() {
    _lines = [];
    save();
  },
  subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};

export function useCart() {
  const [, forceUpdate] = useState(0);
  useEffect(() => cartStore.subscribe(() => forceUpdate((n) => n + 1)), []);
  return {
    lines: cartStore.lines,
    vendorId: cartStore.vendorId,
    count: cartStore.count,
    add: (line: Omit<CartLine, "key">) => cartStore.add(line),
    update: (key: string, patch: Partial<CartLine>) => cartStore.update(key, patch),
    remove: (key: string) => cartStore.remove(key),
    clearCart: () => cartStore.clear(),
  };
}
