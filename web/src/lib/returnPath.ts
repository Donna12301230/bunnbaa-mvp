// 登入後回到原本的頁面（2026-10-09）：之前登入成功一律導去 /home，從贈送連結、代領連結、
// 轉讓市集等需要登入的地方過來，登入完就「跳走了」找不回原頁。導去 /login 前記下目前路徑，
// 登入成功後 LoginPage 取回來；sessionStorage 只在這個分頁有效，讀寫失敗（無痕、被擋）就當沒有。
const KEY = "bunnbaa.returnPath";

/** 目前的 hash 路由路徑加上 ?query（wouter 的 hash 路由把 query 放在真正的 location.search），例：/my-bookings?tab=market */
export function currentRoutePath(): string {
  return (window.location.hash.replace(/^#/, "").split("?")[0] || "/") + window.location.search;
}

export function rememberReturnPath(path: string = currentRoutePath()) {
  if (!path.startsWith("/") || path.startsWith("/login") || path === "/") return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // 無痕模式等：登入後回預設頁
  }
}

export function takeReturnPath(): string | null {
  try {
    const path = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return path && path.startsWith("/") && !path.startsWith("//") ? path : null;
  } catch {
    return null;
  }
}
