import { useEffect, useState, type FormEvent } from "react";
import { addDoc, collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Vendor } from "../../types";

/**
 * Manages the `vendors` collection directly. Note: the consumer page is
 * still hardcoded to a single vendor id (see ConsumerLockPage.tsx), so a
 * vendor added here won't show up there yet — that needs the product
 * browsing pages (separate task) to stop hardcoding the vendor.
 */
export default function AdminVendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [name, setName] = useState("");
  const [itemFocus, setItemFocus] = useState("");
  const [adding, setAdding] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "vendors"), (snap) => {
      setVendors(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Vendor));
    });
    return () => unsub();
  }, []);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !itemFocus.trim()) return;
    setAdding(true);
    try {
      await addDoc(collection(db, "vendors"), {
        name: name.trim(),
        item_focus: itemFocus.trim(),
        reliability_tone: "new",
        status: "active",
      });
      setName("");
      setItemFocus("");
    } finally {
      setAdding(false);
    }
  }

  async function toggleStatus(vendor: Vendor) {
    setTogglingId(vendor.id);
    try {
      await updateDoc(doc(db, "vendors", vendor.id), {
        status: vendor.status === "disabled" ? "active" : "disabled",
      });
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="page">
      <div className="kicker">BunnBaa · 管理後台</div>
      <h1>商家管理</h1>
      <p className="faint" style={{ marginTop: -12, marginBottom: 20 }}>
        新增的商家目前消費者端還看不到（消費者頁還是寫死單一商家），要等商品/商家瀏覽頁做完才會串起來。
      </p>

      <form className="card" onSubmit={handleAdd}>
        <h2>新增商家</h2>
        <div className="field">
          <label>商家名稱</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label>主打品項</label>
          <input type="text" value={itemFocus} onChange={(e) => setItemFocus(e.target.value)} required />
        </div>
        <button type="submit" disabled={adding}>
          {adding ? "新增中…" : "新增商家"}
        </button>
      </form>

      {vendors.length === 0 ? (
        <p className="faint">尚無商家資料。</p>
      ) : (
        vendors.map((v) => (
          <div key={v.id} className="card">
            <div className="row">
              <div>
                <h2>{v.name}</h2>
                <div className="muted">{v.item_focus}</div>
                <div className="faint">id: {v.id}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <span className="badge">{v.status === "disabled" ? "已停用" : "啟用中"}</span>
                <button
                  className="secondary"
                  disabled={togglingId === v.id}
                  onClick={() => toggleStatus(v)}
                >
                  {togglingId === v.id ? "處理中…" : v.status === "disabled" ? "啟用" : "停用"}
                </button>
              </div>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
