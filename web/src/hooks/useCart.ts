import { useState, useEffect } from "react";
import type { ExtraSideChoice, MenuItem, RiceOption, SlotChoice } from "@/types";
import { authStore } from "@/lib/auth";
import { vendorBlockedToast } from "@/hooks/useRequireLogin";

// 購物車（存在 localStorage）。第一階段規格：每一行是一份（或多份同樣配置的）便當，
// 各自帶取餐日期、時段、主菜、配菜選擇（含第四道）、飯量、折價券——可預訂 30 天內，一次結帳可以
// 跨好幾天，但只能同一家店（折價券只能在發券店家用）。
// _v3：2026-09-30 改成便當格式，舊版購物車（沒有日期／配菜）直接丟掉。
const CART_KEY = "bento_cart_v3";
// 結帳跳去 LINE Pay 前先清空購物車（付完回來才不會重複下單），但把內容暫存在這裡：
// 付款取消／失敗回到取消頁時放回購物車，付款成功才丟掉。2026-10-12 修：以前取消付款購物車就沒了。
const PENDING_KEY = "bento_cart_pending_payment";

export interface CartLine {
  key: string;
  menuItem: MenuItem;
  vendorId: string;
  pickupDate: string;
  pickupWindow: string;
  choices: SlotChoice[];
  mainIndex?: number | null; // 選的主菜（menu_items.mains 的 index）
  extraSide?: ExtraSideChoice | null; // 第四道：備案或加菜
  customPicks?: number[]; // 店家自訂欄位：每個欄位選的選項 index
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
    && (a.mainIndex ?? null) === (b.mainIndex ?? null) && JSON.stringify(a.extraSide ?? null) === JSON.stringify(b.extraSide ?? null)
    && JSON.stringify(a.customPicks ?? []) === JSON.stringify(b.customPicks ?? []);
}

export const cartStore = {
  get lines() { return _lines; },
  get vendorId() { return _lines[0]?.vendorId ?? null; },
  get count() { return _lines.reduce((s, l) => s + l.quantity, 0); },

  /** 加入一行；別家店的品項會清空購物車（一次只跟一家店預購）。廠商帳號不能下單，回傳 false */
  add(line: Omit<CartLine, "key">): boolean {
    if (authStore.getSnapshot().user?.role === "vendor") {
      vendorBlockedToast();
      return false;
    }
    if (_lines.length > 0 && _lines[0].vendorId !== line.vendorId) _lines = [];
    const existing = _lines.find((l) => sameConfig(l, line));
    if (existing) {
      _lines = _lines.map((l) => (l === existing ? { ...l, quantity: l.quantity + line.quantity } : l));
    } else {
      _lines = [..._lines, { ...line, key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }];
    }
    save();
    return true;
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
  /** 前往付款前呼叫：暫存這次結帳的內容再清空購物車 */
  stashForPayment(orderId: string) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId, lines: _lines }));
    } catch {
      // 存不了就只是取消後要重新加入購物車
    }
    this.clear();
  },
  /** 付款取消：把同一筆訂單暫存的內容放回購物車（不給 orderId 就放回最近一筆，例如 LINE Pay 頁面直接關掉沒回到取消頁） */
  restoreAfterCancel(orderId?: string) {
    try {
      const pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as { orderId: string; lines: CartLine[] } | null;
      if (!pending || (orderId && pending.orderId !== orderId)) return;
      localStorage.removeItem(PENDING_KEY);
      if (_lines.length === 0 && pending.lines.length > 0) {
        _lines = pending.lines;
        save();
      }
    } catch {
      // 讀不到暫存就算了
    }
  },
  /** 有沒有上次沒付完的暫存（購物車空的時候提示放回） */
  get hasPending() {
    try {
      return !!JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null")?.lines?.length;
    } catch {
      return false;
    }
  },
  /** 付款成功：丟掉暫存 */
  discardPending() {
    try {
      localStorage.removeItem(PENDING_KEY);
    } catch {
      // ignore
    }
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
    add: (line: Omit<CartLine, "key">): boolean => cartStore.add(line),
    update: (key: string, patch: Partial<CartLine>) => cartStore.update(key, patch),
    remove: (key: string) => cartStore.remove(key),
    clearCart: () => cartStore.clear(),
  };
}
