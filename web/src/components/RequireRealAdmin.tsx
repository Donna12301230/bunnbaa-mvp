import { useState, type FormEvent, type ReactNode } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAdminUser } from "@/lib/adminAuth";

// The platform login (useAuth/mockAuthStore) is a mock, so it can't authorize
// real Firestore/Functions access. These gates ask for a real Firebase Auth
// sign-in instead; what the signed-in account may actually read or write is
// enforced by firestore.rules and the Functions, never by the gate itself.

function RealSignInForm({ title, description }: { title: string; description: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch {
      setError("登入失敗，請確認帳號密碼是否正確。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto bg-white rounded-xl border border-border p-5">
      <h2 className="font-semibold mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          autoComplete="username"
          required
          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="密碼"
          autoComplete="current-password"
          required
          className="w-full border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
        <button
          type="submit"
          disabled={submitting}
          className="w-full bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-lg py-2 disabled:opacity-50"
        >
          {submitting ? "登入中…" : "登入"}
        </button>
      </form>
    </div>
  );
}

export default function RequireRealAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAdminUser();

  if (loading) return <p className="text-sm text-muted-foreground">確認登入狀態中…</p>;
  if (isAdmin) return <>{children}</>;

  return (
    <RealSignInForm
      title="這裡動到真實資料庫"
      description="請用真實管理員帳號（Firebase Auth）登入，跟平台登入頁的帳號是分開的。"
    />
  );
}

/**
 * For the vendor dashboard/redeem pages: any real (non-anonymous) sign-in gets
 * past the gate. Whether that account can see a vendor's payouts or mark its
 * locks is decided by firestore.rules/Functions (admin, or vendors/{id}.owner_uid).
 */
export function RequireVendorSignIn({ children }: { children: ReactNode }) {
  const { user, loading } = useAdminUser();

  if (loading) return <p className="text-sm text-muted-foreground">確認登入狀態中…</p>;
  if (user && !user.isAnonymous) return <>{children}</>;

  return (
    <RealSignInForm
      title="商家登入"
      description="這裡有撥款與履約資料，請用商家帳號登入（帳號由平台管理員建立並綁定商家）。"
    />
  );
}
