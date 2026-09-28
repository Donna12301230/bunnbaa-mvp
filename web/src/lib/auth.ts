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

// 平台登入改接真正的 Firebase Auth（email/密碼），取代原本的 mockAuth.ts。
// 角色判斷：
//   - admin：email 在 ADMIN_EMAILS 白名單（跟 firestore.rules / Functions 同一份）
//   - vendor：有某個 vendors/{id}.owner_uid 等於這個 uid（跟 assertAdminOrVendorOwner 同一套）
//   - 其他帳號都是 customer
// 2026-09-24 起不再使用匿名登入：鎖定／下單／轉讓都要先登入（firestore.rules
// isSignedInUser()、Functions assertSignedInUser() 也會擋匿名身分）。
// 前端的角色只影響 UI；真正的權限邊界仍是 firestore.rules 與 Functions。

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

  // 手機門號登入沒有 email，admin 一定是 email 白名單，所以這裡不會誤判；
  // vendor 一樣靠 owner_uid 查，跟 email/phone 登入方式無關。
  if (email && ADMIN_EMAILS.includes(email)) {
    role = "admin";
  } else {
    // vendors 是公開可讀，直接查 owner_uid；查失敗就當一般使用者，不擋登入
    try {
      const snap = await getDocs(query(collection(db, "vendors"), where("owner_uid", "==", u.uid), limit(1)));
      if (!snap.empty) {
        role = "vendor";
        vendorId = snap.docs[0].id;
      }
    } catch (err) {
      console.error("查詢商家綁定失敗", err);
    }
  }

  // users/{uid} 是註冊時寫的個人資料（電話、學校、科系），沒有也不影響登入。
  // orderBanned/noPickupCount 是 markLockOutcome 在標記 no_show 時順手寫的。
  let extra: {
    display_name?: string;
    phone?: string;
    department?: string;
    orderBanned?: boolean;
    noPickupCount?: number;
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
  };
}

let _resolveSeq = 0;
async function refresh(u: User | null) {
  const seq = ++_resolveSeq;
  if (!u || u.isAnonymous) {
    // 之前留在瀏覽器裡的匿名身分直接登出，不再沿用
    if (u?.isAnonymous) signOut(auth).catch(console.error);
    setState({ user: null, loading: false });
    return;
  }
  setState({ user: _state.user, loading: true });
  const profile = await resolveProfile(u);
  // 期間如果又換了帳號，丟掉這次比較舊的結果
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

// 表單欄位一律去掉前後空白；只有空白的欄位視同沒填。
function clean(value?: string): string {
  return (value ?? "").trim();
}

// 密碼不 trim（會改到使用者真正設定的密碼），但註冊時擋掉全空白和前後空白，
// 避免不小心多打一個空格、之後怎麼登都登不進去。
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
    // onAuthStateChanged 在寫入顯示名稱／個人資料之前就觸發了，手動再解析一次
    await refresh(user);
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

/**
 * 廠商申請：建立帳號（角色先是 customer）＋寫一筆 vendor_applications/{uid}，
 * 管理員在 /admin/vendors 核准時才會把 vendors/{id}.owner_uid 綁到這個帳號。
 */
export async function applyAsVendor(input: {
  email: string;
  password: string;
  storeName: string;
  phone?: string;
}): Promise<void> {
  const storeName = clean(input.storeName);
  // 先檢查再建帳號，不然會留下一個沒有申請單的空帳號
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
 * 手機門號 OTP 登入（草圖 Login.dc.html 的兩段式流程）：先送簡訊驗證碼，
 * 再輸入驗證碼完成登入。號碼跟密碼登入是同一個 Firebase Auth 專案，但
 * provider 不同——沒有 email 時的角色判斷已經在上面的 resolveProfile 處理。
 * ------------------------------------------------------------------ */

let _recaptchaVerifier: RecaptchaVerifier | null = null;

/** invisible reCAPTCHA 綁在指定的 DOM 節點上，同一個 verifier 可以重複用來送不同號碼。 */
function getRecaptchaVerifier(containerId: string): RecaptchaVerifier {
  if (!_recaptchaVerifier) {
    _recaptchaVerifier = new RecaptchaVerifier(auth, containerId, { size: "invisible" });
  }
  return _recaptchaVerifier;
}

/** "0912-345-678" / "0912345678" -> "+886912345678"；已經是 +886 開頭就原樣送出。 */
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
    // 送出失敗（例如格式被 Firebase 拒絕）就重建 verifier，避免同一個 widget 卡死不能重試
    _recaptchaVerifier?.clear();
    _recaptchaVerifier = null;
    throw friendlyAuthError(err);
  }
}

export async function confirmOtp(confirmation: ConfirmationResult, code: string): Promise<void> {
  if (!code.trim()) throw new Error(tr("請輸入驗證碼", "Please enter the verification code"));
  try {
    const { user } = await confirmation.confirm(code.trim());
    // 手機登入沒有註冊表單可以先寫 users/{uid}，第一次登入時順手建一筆（沒有就建，已存在就跳過）。
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
