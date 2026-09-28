import { arrayUnion, doc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";

// 免費領取／接受贈送都是 client 直接寫 locks，接手時要把原持有人記進
// transferred_from_uids（firestore.rules 會檢查），「我的轉讓」才查得回已被接手的
// 項目。原持有人要先讀出來，所以包成 transaction，避免讀完到寫入之間被別人搶走。
export async function takeOverLock(lockId: string, uid: string, extra: Record<string, unknown> = {}) {
  const ref = doc(db, "locks", lockId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("找不到這筆項目");
    tx.update(ref, {
      status: "locked",
      buyer_uid: uid,
      transferred_from_uids: arrayUnion(snap.data().buyer_uid),
      ...extra,
    });
  });
}
