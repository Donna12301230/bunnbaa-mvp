// 跨頁「打開某一筆來編輯」：例如配方頁點「用在：雞腿便當」→ 跳到菜單管理並打開該品項。
// 只在同一個分頁的 SPA 內傳遞，跳頁後由目標頁取走一次就清掉。

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
