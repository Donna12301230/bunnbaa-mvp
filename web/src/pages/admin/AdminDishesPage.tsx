import { useEffect, useState } from "react";
import { addDoc, collection, deleteDoc, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { BookMarked, Trash2 } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import RequireRealAdmin from "@/components/RequireRealAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { tr } from "@/lib/i18n";

interface Dish { id: string; name: string; aliases?: string[]; category?: string; tags?: string[] }
interface Template { id: string; name: string; structure: string; items?: unknown[]; components?: unknown[] }

const TAGS = ["雞", "豬", "牛", "海鮮", "素", "炸", "滷", "烤", "炒", "蒸", "辣", "清淡", "甜", "葉菜", "根莖", "瓜類"];

/**
 * 平台菜色庫與定式模板（規格 §3.1、§4.4）：開放許願先從菜色庫選、自由輸入再由 Gemini 歸類到
 * 這裡的標準菜名；定式模板給店家一鍵開店。模板內容由 scripts/seed.js 建立，這裡可檢視與刪除。
 */
function DishesContent() {
  const { toast } = useToast();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [form, setForm] = useState({ name: "", aliases: "", category: "青菜類", tags: [] as string[] });

  useEffect(() => onSnapshot(collection(db, "dishLibrary"), (s) => setDishes(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Dish).sort((a, b) => a.name.localeCompare(b.name, "zh-Hant")))), []);
  useEffect(() => onSnapshot(collection(db, "templates"), (s) => setTemplates(s.docs.map((d) => ({ id: d.id, ...d.data() }) as Template))), []);

  async function add() {
    try {
      await addDoc(collection(db, "dishLibrary"), { name: form.name.trim(), aliases: form.aliases.split(/[,，、]/).map((x) => x.trim()).filter(Boolean), category: form.category, tags: form.tags });
      setForm({ name: "", aliases: "", category: form.category, tags: [] });
    } catch (err) {
      toast({ variant: "destructive", title: (err as Error).message });
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("新增標準菜名", "Add a dish")}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <Input className="w-40" placeholder={tr("標準菜名", "Name")} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input className="w-56" placeholder={tr("別名（逗號分隔）", "Aliases")} value={form.aliases} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
            <select className="h-10 rounded-md border px-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {["青菜類", "肉類配菜", "蛋豆類", "根莖類", "主菜", "其他"].map((c) => <option key={c}>{c}</option>)}
            </select>
            <Button onClick={add} disabled={!form.name.trim()}>{tr("新增", "Add")}</Button>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            {TAGS.map((t) => (
              <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={form.tags.includes(t)} onChange={(e) => setForm({ ...form, tags: e.target.checked ? [...form.tags, t] : form.tags.filter((x) => x !== t) })} />{t}</label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr(`菜色庫（${dishes.length}）`, `Dish library (${dishes.length})`)}</CardTitle></CardHeader>
        <CardContent className="space-y-1">
          {dishes.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-sm border-b py-1">
              <span className="w-28 font-medium">{d.name}</span>
              <span className="w-20 text-xs text-muted-foreground">{d.category}</span>
              <Input
                className="h-8 flex-1"
                defaultValue={(d.aliases ?? []).join("、")}
                onBlur={(e) => updateDoc(doc(db, "dishLibrary", d.id), { aliases: e.target.value.split(/[,，、]/).map((x) => x.trim()).filter(Boolean) })}
                aria-label={tr("別名", "Aliases")}
              />
              <span className="text-xs text-muted-foreground w-32 truncate">{(d.tags ?? []).join(" ")}</span>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-red-500" onClick={() => deleteDoc(doc(db, "dishLibrary", d.id))}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">{tr("定式菜單模板", "Menu templates")}</CardTitle></CardHeader>
        <CardContent className="space-y-1 text-sm">
          {templates.map((t) => (
            <div key={t.id} className="flex items-center gap-2 border-b py-1">
              <span className="w-28 font-medium">{t.name}</span>
              <span className="flex-1 text-muted-foreground">{t.structure}</span>
              <span className="text-xs text-muted-foreground">{t.items?.length ?? 0} {tr("品項", "items")}・{t.components?.length ?? 0} {tr("半成品", "components")}</span>
            </div>
          ))}
          {templates.length === 0 && <p className="text-muted-foreground">{tr("還沒有模板，執行 scripts/seed.js --catalog-only 建立。", "No templates — run scripts/seed.js --catalog-only.")}</p>}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminDishesPage() {
  return (
    <AdminLayout>
      <h1 className="font-heading text-3xl md:text-4xl font-semibold mb-3 flex items-center gap-2"><BookMarked className="w-5 h-5" /> {tr("菜色庫與模板", "Dishes & templates")}</h1>
      <RequireRealAdmin><DishesContent /></RequireRealAdmin>
    </AdminLayout>
  );
}
