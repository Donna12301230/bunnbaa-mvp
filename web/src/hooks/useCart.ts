import { useState, useEffect } from "react";
import type { CartItem, MenuItemData } from "@/types";

const CART_KEY = "bento_cart";
const VENDOR_KEY = "bento_cart_vendor";

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(CART_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

let _items: CartItem[] = loadCart();
let _vendorId: string | null = localStorage.getItem(VENDOR_KEY);
const _listeners = new Set<() => void>();

function save() {
  localStorage.setItem(CART_KEY, JSON.stringify(_items));
  if (_vendorId) localStorage.setItem(VENDOR_KEY, _vendorId);
  else localStorage.removeItem(VENDOR_KEY);
  _listeners.forEach(fn => fn());
}

export const cartStore = {
  get items() { return _items; },
  get vendorId() { return _vendorId; },
  get total() { return _items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0); },
  get count() { return _items.reduce((s, i) => s + i.quantity, 0); },

  addItem(menuItem: MenuItemData, vendorId: string, note = "") {
    if (_vendorId && _vendorId !== vendorId) { _items = []; }
    _vendorId = vendorId;
    const existing = _items.find(i => i.menuItem.id === menuItem.id && i.note === note);
    if (existing) existing.quantity += 1;
    else _items = [..._items, { menuItem, quantity: 1, note }];
    save();
  },
  removeItem(menuItemId: string, note = "") {
    _items = _items.filter(i => !(i.menuItem.id === menuItemId && i.note === note));
    if (!_items.length) _vendorId = null;
    save();
  },
  updateQuantity(menuItemId: string, note: string, qty: number) {
    if (qty <= 0) { this.removeItem(menuItemId, note); return; }
    _items = _items.map(i => i.menuItem.id === menuItemId && i.note === note ? { ...i, quantity: qty } : i);
    save();
  },
  clearCart() { _items = []; _vendorId = null; save(); },
  subscribe(fn: () => void) { _listeners.add(fn); return () => { _listeners.delete(fn); }; },
};

export function useCart() {
  const [, forceUpdate] = useState(0);
  useEffect(() => {
    const unsub = cartStore.subscribe(() => forceUpdate(n => n + 1));
    return unsub;
  }, []);
  return {
    items: cartStore.items,
    vendorId: cartStore.vendorId,
    total: cartStore.total,
    count: cartStore.count,
    addItem: (item: MenuItemData, vendorId: string, note?: string) => cartStore.addItem(item, vendorId, note),
    removeItem: (id: string, note?: string) => cartStore.removeItem(id, note),
    updateQuantity: (id: string, note: string, qty: number) => cartStore.updateQuantity(id, note, qty),
    clearCart: () => cartStore.clearCart(),
  };
}
