import { tr } from "@/lib/i18n";
import { useState, type FormEvent, type ReactNode } from "react";
import { signInWithEmailAndPassword } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useAdminUser } from "@/lib/adminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// These gates ask for a real Firebase Auth sign-in on pages not wrapped in the
// platform layouts. The platform login (useAuth / lib/auth.ts) now uses the
// same Firebase Auth session, so signing in on either one satisfies both.
// What the signed-in account may actually read or write is enforced by
// firestore.rules and the Functions, never by the gate itself.

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
      setError(tr("登入失敗，請確認帳號密碼是否正確。", "Sign-in failed. Please check your email and password."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-sm mx-auto bg-card rounded-xl border border-border shadow-sm p-5">
      <h2 className="text-h3 mb-1">{title}</h2>
      <p className="text-sm text-muted-foreground mb-4">{description}</p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          aria-label="Email"
          autoComplete="username"
          required
        />
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder={tr("密碼", "Password")}
          autoComplete="current-password"
          required
          aria-label={tr("密碼", "Password")}
        />
        {error && <p role="alert" className="text-caption text-red-600">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? tr("登入中…", "Signing in…") : tr("登入", "Sign in")}
        </Button>
      </form>
    </div>
  );
}

export default function RequireRealAdmin({ children }: { children: ReactNode }) {
  const { isAdmin, loading } = useAdminUser();

  if (loading) return <p className="text-sm text-muted-foreground">{tr("確認登入狀態中…", "Checking sign-in…")}</p>;
  if (isAdmin) return <>{children}</>;

  return (
    <RealSignInForm
      title={tr("這裡動到真實資料庫", "This touches the live database")}
      description={tr("請用真實管理員帳號（Firebase Auth）登入，跟平台登入頁的帳號是分開的。", "Sign in with a real admin account (Firebase Auth).")}
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

  if (loading) return <p className="text-sm text-muted-foreground">{tr("確認登入狀態中…", "Checking sign-in…")}</p>;
  if (user && !user.isAnonymous) return <>{children}</>;

  return (
    <RealSignInForm
      title={tr("店家登入", "Vendor sign-in")}
      description={tr("這裡有撥款與履約資料，請用店家帳號登入（帳號由平台管理員建立並綁定店家）。", "This page has payout and fulfilment data. Sign in with your vendor account (created and linked by a platform admin).")}
    />
  );
}
