// Return to the original page after login (2026-10-09): login used to always redirect to /home, so users arriving from a gift link, proxy pickup link,
// the resale market or other login-required pages lost their page after logging in. Before redirecting to /login we save the current path,
// and LoginPage reads it back after a successful login. sessionStorage is per-tab only; if read/write fails (private mode, blocked) we treat it as empty.
const KEY = "bunnbaa.returnPath";

/** Current hash route path plus ?query (wouter's hash routing keeps the query in the real location.search), e.g. /my-bookings?tab=market */
export function currentRoutePath(): string {
  return (window.location.hash.replace(/^#/, "").split("?")[0] || "/") + window.location.search;
}

export function rememberReturnPath(path: string = currentRoutePath()) {
  if (!path.startsWith("/") || path.startsWith("/login") || path === "/") return;
  try {
    sessionStorage.setItem(KEY, path);
  } catch {
    // Private mode etc.: go to the default page after login
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
