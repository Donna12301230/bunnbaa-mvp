import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";

// Keep this in sync by hand with the isAdmin() allowlist in firestore.rules —
// there's no custom-claims backend yet (Cloud Functions blocked on Blaze),
// so this is a plain email allowlist checked on the client for UX purposes.
// The real access boundary is firestore.rules.
export const ADMIN_EMAILS = ["suw192336@gmail.com", "ckchildlikekid@gmail.com"];

// Read-only demo admin for the login page's one-tap demo sign-in (lib/demoAccounts.ts). Its password is public,
// so it gets the admin UI but firestore.rules (isAdminViewer) and Functions only let it read, never write.
export const DEMO_ADMIN_EMAIL = "admin@bunnbaa.test";

export function useAdminUser() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // The read-only demo admin passes the gate too, so it can browse; rules and Functions still refuse its writes
  const isAdmin = !!user?.email && (ADMIN_EMAILS.includes(user.email) || user.email === DEMO_ADMIN_EMAIL);
  return { user, isAdmin, loading };
}
