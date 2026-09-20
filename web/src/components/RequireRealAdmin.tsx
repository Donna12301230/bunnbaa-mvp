import { useState, type FormEvent, type ReactNode } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAdminUser } from "@/lib/adminAuth";

/**
 * The rest of the admin backend (廠商管理/解封申訴) is gated only by the mock
 * login in useAuth/mockAuthStore — fine for UI that reads/writes mock data.
 * These pages do real Firestore writes though, which firestore.rules only
 * lets through for a real Firebase Auth session matching ADMIN_EMAILS — mock
 * login doesn't produce one. So this gate asks for that real sign-in
 * separately, inline, rather than pretending the mock session is enough.
 */
export default function RequireRealAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAdminUser();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (loading) {
    return <p className="text-sm text-muted-foreground">確認登入狀態中…</p>;
  }

  if (isAdmin) {
    return <>{children}</>;
  }

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
      <h2 className="font-semibold mb-1">這裡動到真實資料庫</h2>
      <p className="text-sm text-muted-foreground mb-4">
        請用真實管理員帳號（Firebase Auth）登入，跟平台登入頁的帳號是分開的。
      </p>
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
