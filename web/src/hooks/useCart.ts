import { useState, useEffect } from "react";
import type { ExtraSideChoice, MenuItem, RiceOption, SlotChoice } from "@/types";
import { authStore } from "@/lib/auth";
import { vendorBlockedToast } from "@/hooks/useRequireLogin";

// Shopping cart (stored in localStorage). Each line is one bento (or several with the same configuration),
// each with its own pickup date, pickup slot, main dish, side choices (including the fourth side), rice amount and coupon. Bookable up to 30 days ahead; one checkout can
// span several days, but only one vendor (coupons can only be used at the issuing vendor).
// _v3: switched to the bento format on 2026-09-30; old carts (no date / sides) are discarded.
const CART_KEY = "bento_cart_v3";
// Before checkout redirects to LINE Pay the cart is cleared (so returning after payment can't order twice), but its contents are kept here:
// they go back into the cart when payment is cancelled or fails and the cancel page loads, and are dropped only on success. Fixed 2026-10-12: cancelling used to lose the cart.
const PENDING_KEY = "bento_cart_pending_payment";

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
  /** Call before going to payment: stash this checkout's contents, then clear the cart */
  stashForPayment(orderId: string) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify({ orderId, lines: _lines }));
    } catch {
      // If it can't be stored, the diner just has to re-add items after cancelling
    }
    this.clear();
  },
  /** Payment cancelled: put the stashed contents for this order back in the cart (without an orderId, restore the latest one, e.g. when the LINE Pay page was closed without reaching the cancel page) */
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
      // If the stash can't be read, give up quietly
    }
  },
  /** Whether an unpaid checkout is stashed (offered for restore when the cart is empty) */
  get hasPending() {
    try {
      return !!JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null")?.lines?.length;
    } catch {
      return false;
    }
  },
  /** Payment succeeded: drop the stash */
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
