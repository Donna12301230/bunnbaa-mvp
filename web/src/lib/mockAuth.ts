import type { UserProfile } from "@/types";

// TODO(firebase): this whole module stands in for Parse Server session/auth
// (Parse.User.logIn/signUp/logOut/currentAsync in the source project). Replace
// with real Firebase Authentication (email/password or provider sign-in) +
// a Firestore `users/{uid}` doc holding `role`, once the backend is wired up.

const STORAGE_KEY = "bunnbaa_mock_user";

function load(): UserProfile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let _user: UserProfile | null = load();
const _listeners = new Set<() => void>();

function save() {
  if (_user) localStorage.setItem(STORAGE_KEY, JSON.stringify(_user));
  else localStorage.removeItem(STORAGE_KEY);
  _listeners.forEach((fn) => fn());
}

export const mockAuthStore = {
  get user() {
    return _user;
  },
  login(profile: UserProfile) {
    _user = profile;
    save();
  },
  logout() {
    _user = null;
    save();
  },
  subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};

function mockDelay<T>(value: T, ms = 400): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

export async function mockLogin(username: string, password: string): Promise<UserProfile> {
  if (!username.trim() || !password.trim()) {
    throw new Error("請輸入帳號與密碼");
  }
  const role: UserProfile["role"] = username.includes("admin")
    ? "admin"
    : username.includes("vendor")
    ? "vendor"
    : "customer";
  const profile: UserProfile = {
    id: "mock-" + username,
    username,
    email: `${username}@example.com`,
    displayName: username,
    role,
  };
  await mockDelay(null);
  mockAuthStore.login(profile);
  return profile;
}

export async function mockRegister(input: {
  username: string;
  email: string;
  displayName?: string;
}): Promise<UserProfile> {
  const profile: UserProfile = {
    id: "mock-" + input.username,
    username: input.username,
    email: input.email,
    displayName: input.displayName || input.username,
    role: "customer",
  };
  await mockDelay(null);
  mockAuthStore.login(profile);
  return profile;
}

export async function mockVendorApply(input: {
  username: string;
  email: string;
  storeName: string;
}): Promise<UserProfile> {
  const profile: UserProfile = {
    id: "mock-" + input.username,
    username: input.username,
    email: input.email,
    displayName: input.storeName,
    role: "customer", // stays "customer" until platform admin approves — matches source flow
  };
  await mockDelay(null);
  mockAuthStore.login(profile);
  return profile;
}

export async function mockRequestPasswordReset(_email: string): Promise<void> {
  await mockDelay(undefined);
}

export async function mockLogout(): Promise<void> {
  await mockDelay(undefined, 100);
  mockAuthStore.logout();
}
