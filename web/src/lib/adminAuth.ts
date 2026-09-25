import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth } from "./firebase";

// Keep this in sync by hand with the isAdmin() allowlist in firestore.rules —
// there's no custom-claims backend yet (Cloud Functions blocked on Blaze),
// so this is a plain email allowlist checked on the client for UX purposes.
// The real access boundary is firestore.rules.
export const ADMIN_EMAILS = ["suw192336@gmail.com", "ckchildlikekid@gmail.com"];

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

  const isAdmin = !!user?.email && ADMIN_EMAILS.includes(user.email);
  return { user, isAdmin, loading };
}
