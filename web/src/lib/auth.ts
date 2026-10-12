import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  RecaptchaVerifier,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signOut,
  updateProfile,
  type ConfirmationResult,
  type User,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import { ADMIN_EMAILS } from "./adminAuth";
import type { UserProfile } from "@/types";
import { tr } from "./i18n";

// Platform sign-in now uses real Firebase Auth (email/password), replacing the old mockAuth.ts.
// Role resolution:
//   - admin: email is on the ADMIN_EMAILS allowlist (same list as firestore.rules / Functions)
//   - vendor: some vendors/{id}.owner_uid equals this uid (same logic as assertAdminOrVendorOwner)
//   - every other account is a customer
// Since 2026-09-24 anonymous sign-in is no longer used: lock / order / resale all require sign-in (firestore.rules
// isSignedInUser() and Functions assertSignedInUser() also block anonymous identities).
// Roles on the frontend only affect the UI; the real permission boundary is still firestore.rules and Functions.

interface AuthState {
  user: UserProfile | null;
  loading: boolean;
}

let _state: AuthState = { user: null, loading: true };
const _listeners = new Set<() => void>();

function setState(next: AuthState) {
  _state = next;
  _listeners.forEach((fn) => fn());
}

async function resolveProfile(u: User): Promise<UserProfile> {
  const email = u.email ?? "";
  let role: UserProfile["role"] = "customer";
  let vendorId: string | undefined;

  // Phone-number sign-in has no email, and admin is always the email allowlist, so this can't misidentify;
  // vendor is likewise looked up by owner_uid, regardless of email/phone sign-in.
  if (email && ADMIN_EMAILS.includes(email)) {
    role = "admin";
  } else {
    // vendors is publicly readable, so query owner_uid directly; if the query fails treat them as a regular user and don't block sign-in
    try {
      const snap = await getDocs(query(collection(db, "vendors"), where("owner_uid", "==", u.uid), limit(1)));
      if (!snap.empty) {
        role = "vendor";
        vendorId = snap.docs[0].id;
      }
    } catch (err) {
      console.error("查詢店家綁定失敗", err);
    }
  }

  // users/{uid} is the profile written at sign-up (phone, school, department); sign-in works without it.
  // orderBanned/noPickupCount were written by the old no-show suspension rule; donated_count is written by Functions when donating a charity meal.
  let extra: {
    display_name?: string;
    phone?: string;
    department?: string;
    orderBanned?: boolean;
    noPickupCount?: number;
    lang?: "zh" | "en";
    home_geo?: string;
    donated_count?: number;
    muted_kinds?: string[];
    charity_nearby_push?: boolean;
  } = {};
  try {
    const snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) extra = snap.data();
  } catch (err) {
    console.error("讀取個人資料失敗", err);
  }

  const phone = extra.phone || u.phoneNumber || undefined;

  return {
    id: u.uid,
    username: email ? email.split("@")[0] : phone || u.uid,
    email,
    displayName: u.displayName || extra.display_name || (email ? email.split("@")[0] : phone) || undefined,
    phone,
    department: extra.department || undefined,
    role,
    vendorId,
    orderBanned: extra.orderBanned || false,
    noPickupCount: extra.noPickupCount || 0,
    lang: extra.lang,
    homeGeo: extra.home_geo,
    donatedCount: extra.donated_count || 0,
    mutedKinds: extra.muted_kinds || [],
    charityNearbyPush: !!extra.charity_nearby_push,
  };
}

// Abuse detection (spec §9.5 "more than 2 accounts claiming coupons on the same device"): a random device id stored locally in the browser, recorded at sign-in to
// users/{uid}.device_id. Used only for platform abuse flags, nothing else; skipped if reads/writes fail (private mode).
function recordDevice(uid: string) {
  try {
    let id = localStorage.getItem("bunnbaa.device");
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem("bunnbaa.device", id);
    }
    setDoc(doc(db, "users", uid), { device_id: id }, { merge: true }).catch(() => undefined);
  } catch {
    // Without localStorage, don't record it
  }
}

let _resolveSeq = 0;
async function refresh(u: User | null) {
  const seq = ++_resolveSeq;
  if (!u || u.isAnonymous) {
    // Sign out any anonymous identity left in the browser; it is no longer reused
    if (u?.isAnonymous) signOut(auth).catch(console.error);
    setState({ user: null, loading: false });
    return;
  }
  setState({ user: _state.user, loading: true });
  const profile = await resolveProfile(u);
  recordDevice(u.uid);
  // If the account changed in the meantime, discard this older result
  if (seq === _resolveSeq) setState({ user: profile, loading: false });
}
onAuthStateChanged(auth, refresh);

export const authStore = {
  getSnapshot: () => _state,
  subscribe(fn: () => void) {
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  },
};

function friendlyAuthError(err: unknown): Error {
  const code = (err as { code?: string })?.code ?? "";
  const wrongLogin = tr("Email 或密碼錯誤", "Incorrect email or password");
  const messages: Record<string, string> = {
    "auth/invalid-email": tr("Email 格式不正確", "Invalid email address"),
    "auth/invalid-credential": wrongLogin,
    "auth/wrong-password": wrongLogin,
    "auth/user-not-found": wrongLogin,
    "auth/email-already-in-use": tr("這個 Email 已經註冊過了", "This email is already registered"),
    "auth/weak-password": tr("密碼至少需要 6 個字元", "Password must be at least 6 characters"),
    "auth/too-many-requests": tr("嘗試次數過多，請稍後再試", "Too many attempts. Please try again later"),
    "auth/network-request-failed": tr("網路連線失敗，請稍後再試", "Network error. Please try again later"),
    "auth/invalid-phone-number": tr("手機號碼格式不正確", "Invalid phone number"),
    "auth/missing-phone-number": tr("請輸入手機號碼", "Please enter your phone number"),
    "auth/invalid-verification-code": tr("驗證碼錯誤，請重新輸入", "Wrong verification code. Please try again"),
    "auth/code-expired": tr("驗證碼已過期，請重新取得", "The code has expired. Please request a new one"),
    "auth/quota-exceeded": tr("簡訊發送已達上限，請稍後再試", "SMS limit reached. Please try again later"),
  };
  return new Error(messages[code] ?? (err as Error)?.message ?? tr("發生未知錯誤", "Something went wrong"));
}

// Form fields are always trimmed; a field with only whitespace counts as empty.
function clean(value?: string): string {
  return (value ?? "").trim();
}

// Passwords aren't trimmed (that would change the password the user actually set), but sign-up rejects all-whitespace and leading/trailing spaces
// so an accidental extra space doesn't leave them unable to sign in later.
function assertValidNewPassword(password: string) {
  if (!password.trim()) throw new Error(tr("請輸入密碼", "Please enter a password"));
  if (password !== password.trim()) throw new Error(tr("密碼前後不能有空白", "Password can't start or end with a space"));
}

export async function login(email: string, password: string): Promise<void> {
  if (!email.trim() || !password) throw new Error(tr("請輸入 Email 與密碼", "Please enter your email and password"));
  try {
    await signInWithEmailAndPassword(auth, email.trim(), password);
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

export async function register(input: {
  email: string;
  password: string;
  displayName?: string;
  phone?: string;
  school?: string;
  department?: string;
}): Promise<void> {
  const email = clean(input.email);
  const displayName = clean(input.displayName);
  if (!email) throw new Error(tr("請輸入 Email", "Please enter your email"));
  assertValidNewPassword(input.password);
  try {
    const { user } = await createUserWithEmailAndPassword(auth, email, input.password);
    if (displayName) await updateProfile(user, { displayName });
    await setDoc(doc(db, "users", user.uid), {
      display_name: displayName,
      phone: clean(input.phone),
      school: clean(input.school),
      department: clean(input.department),
      created_at: serverTimestamp(),
    });
    // onAuthStateChanged fired before the display name / profile were written, so resolve once more manually
    await refresh(user);
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

/**
 * Vendor application: creates the account (role starts as customer) + writes vendor_applications/{uid};
 * vendors/{id}.owner_uid is bound to this account only when an admin approves it at /admin/vendors.
 */
export async function applyAsVendor(input: {
  email: string;
  password: string;
  storeName: string;
  phone?: string;
}): Promise<void> {
  const storeName = clean(input.storeName);
  // Check before creating the account, otherwise an empty account without an application is left behind
  if (!storeName) throw new Error(tr("請填寫店家名稱", "Please enter a store name"));
  await register({ email: input.email, password: input.password, displayName: storeName, phone: input.phone });
  const user = auth.currentUser;
  if (!user) throw new Error(tr("帳號建立失敗，請重試", "Couldn't create the account. Please try again"));
  await setDoc(doc(db, "vendor_applications", user.uid), {
    store_name: storeName,
    phone: clean(input.phone),
    email: clean(input.email),
    status: "pending",
    created_at: serverTimestamp(),
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  if (!email.trim()) throw new Error(tr("請輸入 Email", "Please enter your email"));
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

export async function logout(): Promise<void> {
  await signOut(auth);
}

/* ------------------------------------------------------------------ *
 * Phone-number OTP sign-in (the two-step flow from the Login.dc.html mockup): send an SMS code first,
 * then enter the code to sign in. Phone and password sign-in use the same Firebase Auth project, but
 * a different provider; role resolution without an email is already handled in resolveProfile above.
 * ------------------------------------------------------------------ */

let _recaptchaVerifier: RecaptchaVerifier | null = null;

/** Invisible reCAPTCHA bound to the given DOM node; the same verifier can be reused to send to different numbers. */
function getRecaptchaVerifier(containerId: string): RecaptchaVerifier {
  if (!_recaptchaVerifier) {
    _recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  }
  return _recaptchaVerifier;
}

/** "0912-345-678" / "0912345678" -> "+886912345678"; numbers already starting with +886 are sent as is. */
export function toE164TaiwanPhone(input: string): string {
  const digits = input.trim().replace(/[\s-]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("886")) return `+${digits}`;
  if (digits.startsWith("09") && digits.length === 10) return `+886${digits.slice(1)}`;
  throw new Error(tr("請輸入正確的手機號碼（例如 0912345678）", "Please enter a valid phone number (e.g. 0912345678)"));
}

export async function sendOtp(phoneInput: string, recaptchaContainerId: string): Promise<ConfirmationResult> {
  const phone = toE164TaiwanPhone(phoneInput);
  try {
    return await signInWithPhoneNumber(auth, phone, getRecaptchaVerifier(recaptchaContainerId));
  } catch (err) {
    // If sending fails (e.g. Firebase rejects the format), rebuild the verifier so the same widget doesn't get stuck and can retry
    _recaptchaVerifier?.clear();
    _recaptchaVerifier = null;
    throw friendlyAuthError(err);
  }
}

export async function confirmOtp(confirmation: ConfirmationResult, code: string): Promise<void> {
  if (!code.trim()) throw new Error(tr("請輸入驗證碼", "Please enter the verification code"));
  try {
    const { user } = await confirmation.confirm(code.trim());
    // Phone sign-in has no sign-up form to write users/{uid} first, so create one on first sign-in (create if missing, skip if it exists).
    const ref = doc(db, "users", user.uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, { display_name: "", phone: user.phoneNumber ?? "", school: "", department: "", created_at: serverTimestamp() });
    }
    await refresh(user);
  } catch (err) {
    throw friendlyAuthError(err);
  }
}
