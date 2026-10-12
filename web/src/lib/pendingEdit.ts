// Cross-page "open a record for editing": e.g. clicking "Used in: Chicken leg bento" on the recipes page → jump to menu management and open that item.
// Passed only within the SPA in the same tab; the target page takes it once after navigation and it is cleared.

type Target = "menu_item" | "component" | "ingredient";
let pending: { target: Target; id: string } | null = null;

export function setPendingEdit(target: Target, id: string) {
  pending = { target, id };
}

export function takePendingEdit(target: Target): string | null {
  if (pending?.target !== target) return null;
  const id = pending.id;
  pending = null;
  return id;
}
