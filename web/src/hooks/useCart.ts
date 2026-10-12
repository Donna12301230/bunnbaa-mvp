import { useState, useEffect } from "react";
import type { ExtraSideChoice, MenuItem, RiceOption, SlotChoice } from "@/types";
import { authStore } from "@/lib/auth";
import { vendorBlockedToast } from "@/hooks/useRequireLogin";

// Shopping cart (stored in localStorage). Phase 1 spec: each line is one bento (or several with the same configuration),
// each with its own pickup date, pickup slot, main dish, side choices (including the fourth side), rice amount and coupon. Bookable up to 30 days ahead; one checkout can
// span several days, but only one vendor (coupons can only be used at the issuing vendor).
// _v3: switched to the bento format on 2026-09-30; old carts (no date / sides) are discarded.
const CART_KEY = "bento_cart_v3";

export interface CartLine {
  key: string;
  menuItem: MenuItem;
  vendorId: string;
  pickupDate: string;
  pickupWindow: string;
  choices: SlotChoice[];
  mainIndex?: number | null; // chosen main dish (index into menu_items.mains)
  extraSide?: ExtraSideChoice | null; // fourth side: fallback or extra dish
  customPicks?: number[]; // vendor custom fields: chosen option index per field
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
    // If it can't be saved, it only lasts for this visit
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

  /** Add a line; an item from another vendor clears the cart (pre-order from one vendor at a time). Vendor accounts can't order; returns false */
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
