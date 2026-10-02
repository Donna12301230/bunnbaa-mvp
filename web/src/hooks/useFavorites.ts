import { useSyncExternalStore } from "react";
import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";

export interface Favorite {
  vendor_id: string;
  created_at?: { toMillis?: () => number } | null;
}

/**
 * 我的最愛（§4.5）：users/{uid}/favorites/{vendorId}，僅本人可讀寫（firestore.rules）。
 * 收藏也是口味偏好的正面訊號（functions/src/insights.js onFavoriteCreated）。
 * 店家卡片上每顆愛心都會用到，所以整站共用一個 onSnapshot（依 uid）。
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
      // 依收藏時間排序（新的在前；剛按下、伺服器時間還沒回來的排最前面）
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
