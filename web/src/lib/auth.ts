import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import { collection, doc, getDoc, getDocs, limit, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { auth, db } from "./firebase";
import { ADMIN_EMAILS } from "./adminAuth";
import type { UserProfile } from "@/types";

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

  // users/{uid} 是註冊時寫的個人資料（電話、學校、科系），沒有也不影響登入
  let extra: { display_name?: string; phone?: string; department?: string } = {};
  try {
    const snap = await getDoc(doc(db, "users", u.uid));
    if (snap.exists()) extra = snap.data();
  } catch (err) {
    console.error("讀取個人資料失敗", err);
  }

  return {
    id: u.uid,
    username: email.split("@")[0] || u.uid,
    email,
    displayName: u.displayName || extra.display_name || email.split("@")[0] || undefined,
    phone: extra.phone || undefined,
    department: extra.department || undefined,
    role,
    vendorId,
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
  const messages: Record<string, string> = {
    "auth/invalid-email": "Email 格式不正確",
    "auth/invalid-credential": "Email 或密碼錯誤",
    "auth/wrong-password": "Email 或密碼錯誤",
    "auth/user-not-found": "Email 或密碼錯誤",
    "auth/email-already-in-use": "這個 Email 已經註冊過了",
    "auth/weak-password": "密碼至少需要 6 個字元",
    "auth/too-many-requests": "嘗試次數過多，請稍後再試",
    "auth/network-request-failed": "網路連線失敗，請稍後再試",
  };
  return new Error(messages[code] ?? (err as Error)?.message ?? "發生未知錯誤");
}

export async function login(email: string, password: string): Promise<void> {
  if (!email.trim() || !password) throw new Error("請輸入 Email 與密碼");
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
  try {
    const { user } = await createUserWithEmailAndPassword(auth, input.email.trim(), input.password);
    if (input.displayName) await updateProfile(user, { displayName: input.displayName });
    await setDoc(doc(db, "users", user.uid), {
      display_name: input.displayName ?? "",
      phone: input.phone ?? "",
      school: input.school ?? "",
      department: input.department ?? "",
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
  await register({ email: input.email, password: input.password, displayName: input.storeName, phone: input.phone });
  const user = auth.currentUser;
  if (!user) throw new Error("帳號建立失敗，請重試");
  await setDoc(doc(db, "vendor_applications", user.uid), {
    store_name: input.storeName.trim(),
    phone: input.phone ?? "",
    email: input.email.trim(),
    status: "pending",
    created_at: serverTimestamp(),
  });
}

export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(auth, email.trim());
  } catch (err) {
    throw friendlyAuthError(err);
  }
}

export async function logout(): Promise<void> {
  await signOut(auth);
}
