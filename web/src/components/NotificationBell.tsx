import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { Bell } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { tr } from "@/lib/i18n";
import type { AppNotification } from "@/types";

/** 站內通知收件匣（notifications，Functions 寫、本人可讀）。推播是另外盡量送，這裡保證看得到。 */
export default function NotificationBell() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [items, setItems] = useState<AppNotification[]>([]);

  useEffect(() => {
    if (!user) {
      setItems([]);
      return;
    }
    return onSnapshot(
      query(collection(db, "notifications"), where("user_id", "==", user.id), orderBy("created_at", "desc"), limit(20)),
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AppNotification)),
      () => setItems([])
    );
  }, [user?.id]);

  if (!user) return null;
  const unread = items.filter((n) => !n.read).length;

  function open(n: AppNotification) {
    if (!n.read) updateDoc(doc(db, "notifications", n.id), { read: true }).catch(() => {});
    // wouter 的 hash navigate 會把 ?query 放到網址的 search（# 前面），路由照樣比對得到
    if (n.link) navigate(n.link);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative w-10 h-10 text-muted-foreground [&_svg]:size-5" aria-label={tr(`通知，${unread} 則未讀`, `Notifications, ${unread} unread`)}>
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 bg-destructive text-white text-micro font-bold rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center">{unread > 9 ? "9+" : unread}</span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        {items.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">{tr("目前沒有通知", "No notifications")}</p>
        ) : items.map((n) => (
          <DropdownMenuItem key={n.id} onClick={() => open(n)} className="flex flex-col items-start gap-0.5 py-2">
            <span className={`text-sm ${n.read ? "text-muted-foreground" : "font-semibold"}`}>{n.title}</span>
            <span className="text-xs text-muted-foreground whitespace-normal">{n.body}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
