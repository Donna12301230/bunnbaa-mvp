import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { db, functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { useToast } from "@/hooks/use-toast";
import { tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface Dish {
  id: string;
  name: string;
  aliases?: string[];
  category?: string;
}

/**
 * 開放許願（規格 §4.4）：先從平台菜色庫選，找不到再自由輸入（由 Gemini 歸類到標準菜名）。
 * 以人數計、近 30 天，達門檻通知店家列入參考名單。許願不保證供應。
 */
export default function OpenWishDialog({ open, onOpenChange, vendorId, vendorName }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  vendorName: string;
}) {
  const [text, setText] = useState("");
  const [picked, setPicked] = useState<Dish | null>(null);
  const [busy, setBusy] = useState(false);
  const requireLogin = useRequireLogin();
  const { toast } = useToast();

  const { data: dishes = [] } = useQuery({
    queryKey: ["dishLibrary"],
    queryFn: async () => (await getDocs(collection(db, "dishLibrary"))).docs.map((d) => ({ id: d.id, ...d.data() }) as Dish),
    enabled: open,
    staleTime: 60 * 60 * 1000,
  });

  const matches = useMemo(() => {
    const q = text.trim();
    if (!q) return dishes.slice(0, 12);
    return dishes.filter((d) => d.name.includes(q) || d.aliases?.some((a) => a.includes(q))).slice(0, 12);
  }, [dishes, text]);

  async function submit() {
    if (!requireLogin()) return;
    setBusy(true);
    try {
      const fn = httpsCallable(functions, "placeOpenWish");
      const res = await fn(picked ? { vendor_id: vendorId, dish_id: picked.id } : { vendor_id: vendorId, text: text.trim() });
      const { dish_name: name } = res.data as { dish_name: string };
      toast({ title: tr("已許願", "Wish sent"), description: tr(`「${name}」已記下，店家上架時會通知你。`, `We noted "${name}" and will let you know if it's added.`) });
      setText("");
      setPicked(null);
      onOpenChange(false);
    } catch (err) {
      toast({ title: tr("許願失敗", "Couldn't send your wish"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr(`向「${vendorName}」許願`, `Wish for a dish at ${vendorName}`)}</DialogTitle>
          <DialogDescription>{tr("先從菜色庫挑，找不到就直接輸入，我們會幫你歸類成標準菜名。同一道菜重複許願只算一次。", "Pick from the dish library, or type it in and we'll match it. Repeat wishes for the same dish count once.")}</DialogDescription>
        </DialogHeader>
        <Input
          value={picked ? picked.name : text}
          onChange={(e) => {
            setPicked(null);
            setText(e.target.value);
          }}
          placeholder={tr("例如：地瓜葉、麻婆豆腐", "e.g. sweet potato leaves, mapo tofu")}
          maxLength={30}
          aria-label={tr("想吃的菜", "Dish")}
        />
        <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto">
          {matches.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setPicked(d)}
              className={cn("px-2.5 py-1 rounded-full border text-xs", picked?.id === d.id ? "border-orange-500 bg-orange-50 text-orange-700" : "border-border")}
            >
              {d.name}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{tr("許願不保證供應；近 30 天達 20 人時會通知店家參考。", "Wishes don't guarantee the dish; the vendor is notified once 20 people wish within 30 days.")}</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>{tr("取消", "Cancel")}</Button>
          <Button onClick={submit} disabled={busy || (!picked && !text.trim())}>{busy ? tr("送出中…", "Sending…") : tr("送出許願", "Send wish")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
