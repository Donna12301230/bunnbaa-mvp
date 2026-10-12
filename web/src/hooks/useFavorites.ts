import { useSyncExternalStore } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

export interface Favorite {
  vendor_id: string;
  created_at?: { toMillis?: () => number } | null;
}

/**
 * Favorites (§4.5): users/{uid}/favorites/{vendorId}, readable and writable only by the owner (firestore.rules).
 * A favorite is also a positive taste-preference signal (functions/src/insights.js onFavoriteCreated).
 * Every heart on vendor cards uses this, so the whole site shares one onSnapshot (per uid).
 */
interface State {
  uid: string | null;
  favorites: Favorite[];
  loading: boolean;
}
let state: State = { uid: null, favorites: [], loading: false };
let unsub: (() => void) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

function watch(uid: string | null) {
  if (state.uid === uid) return;
  unsub?.();
  unsub = null;
  state = { uid, favorites: [], loading: !!uid };
  if (!uid) return;
  unsub = onSnapshot(
    collection(db, "users", uid, "favorites"),
    (snap) => {
      const list = snap.docs.map((d) => ({ vendor_id: d.id, ...(d.data() as Omit<Favorite, "vendor_id">) }));
      // Sort by when favorited (newest first; ones just tapped whose server timestamp hasn't arrived yet go first)
      list.sort((a, b) => (b.created_at?.toMillis?.() ?? Infinity) - (a.created_at?.toMillis?.() ?? Infinity));
      state = { uid, favorites: list, loading: false };
      emit();
    },
    () => {
      state = { uid, favorites: [], loading: false };
      emit();
    }
  );
}

export function useFavorites() {
  const { user } = useAuth();
  const uid = user?.id ?? null;
  if (state.uid !== uid) watch(uid);
  const snapshot = useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => state
  );
  const ids = new Set(snapshot.favorites.map((f) => f.vendor_id));

  async function toggle(vendorId: string) {
    if (!uid) return false;
    const ref = doc(db, "users", uid, "favorites", vendorId);
    if (ids.has(vendorId)) {
      await deleteDoc(ref);
      return false;
    }
    await setDoc(ref, { vendor_id: vendorId, created_at: serverTimestamp() });
    return true;
  }

  return { favorites: snapshot.favorites, ids, loading: snapshot.loading, toggle, signedIn: !!uid };
}
