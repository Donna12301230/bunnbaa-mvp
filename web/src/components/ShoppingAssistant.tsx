import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Bot, CalendarCheck, Send, Sparkles, UtensilsCrossed } from "lucide-react";
import { BottomSheet } from "@/components/ds";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useRequireLogin } from "@/hooks/useRequireLogin";
import { functions } from "@/lib/firebase";
import { httpsCallable } from "@/lib/callable";
import { useSelectedArea } from "@/lib/location";
import { setPreferredPickup, slotLabel } from "@/lib/pickupSlots";
import { tr } from "@/lib/i18n";
import { tagEn } from "@/types";

// 對話式預購助理（AI 功能 2，functions/src/shoppingAssistant.js）。
// 助理只給候選卡片：品項卡連到品項頁（帶入建議的日期、時段），計畫卡連到店家頁；
// 不幫使用者下單，價格在結帳時由伺服器重算。

interface ItemCard {
  type: "item";
  id: string;
  vendor_id: string;
  vendor_name: string;
  name: string;
  image: string | null;
  list_price: number;
  dietary_tags: string[];
  allergens: string[];
  date: string | null;
  window: string | null;
  estimated_price: number | null;
  early_bird_percent: number;
  open_dates: string[];
  closed_dates: string[];
}

interface PlanCard {
  type: "plan";
  id: string;
  vendor_id: string;
  vendor_name: string;
  name: string;
  label: string;
  price_per_meal: number;
  days: number;
}

type Card = ItemCard | PlanCard;

interface Message {
  role: "user" | "assistant";
  text: string;
  cards?: Card[];
}

interface AssistantReply {
  reply: string;
  cards: Card[];
  disclaimer: string;
}

const EXAMPLES = [
  { zh: "下週一到五中午，預算 120，不吃牛", en: "Weekday lunches next week, under NT$120, no beef" },
  { zh: "明天想吃素食便當", en: "A vegetarian bento for tomorrow" },
  { zh: "明天晚餐有什麼不辣的？", en: "Something not spicy for dinner tomorrow?" },
];

export default function ShoppingAssistant({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [disclaimer, setDisclaimer] = useState("");
  const area = useSelectedArea();
  const requireLogin = useRequireLogin();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, busy]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    if (!requireLogin()) return;
    const next: Message[] = [...messages, { role: "user", text: q }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    try {
      const res = await httpsCallable(functions, "askShoppingAssistant")({
        messages: next.map((m) => ({ role: m.role, text: m.text })),
        area: area ?? null,
      });
      const data = res.data as AssistantReply;
      setMessages([...next, { role: "assistant", text: data.reply, cards: data.cards }]);
      setDisclaimer(data.disclaimer);
    } catch (err) {
      toast({ variant: "destructive", title: tr("助理沒有回應", "The assistant didn't respond"), description: (err as Error).message });
      setMessages(messages);
      setDraft(q);
    } finally {
      setBusy(false);
    }
  }

  function openCard(card: Card) {
    if (card.type === "item") {
      if (card.date && card.window) setPreferredPickup({ date: card.date, window: card.window });
      navigate(`/item/${card.id}`);
    } else {
      navigate(`/vendor/${card.vendor_id}`);
    }
    onClose();
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={<span className="flex items-center gap-2"><Bot className="w-5 h-5 text-primary" /> {tr("預購助理", "Meal assistant")}</span>}
      description={tr("用一句話說你想吃什麼、哪幾天、預算多少", "Tell me what, when and your budget in one sentence")}
      footer={
        <form
          className="flex gap-2 w-full"
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
        >
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={tr("例：下週一到五中午，預算 120，不吃牛", "e.g. weekday lunches next week, under NT$120")}
            aria-label={tr("輸入需求", "Your request")}
            maxLength={500}
            disabled={busy}
          />
          <Button type="submit" disabled={busy || !draft.trim()} aria-label={tr("送出", "Send")}><Send className="w-4 h-4" /></Button>
        </form>
      }
    >
      <div className="space-y-3 pb-2">
        {messages.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{tr("試試看：", "Try:")}</p>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button key={ex.zh} type="button" className="text-xs rounded-full border border-border px-3 py-1.5 hover:bg-muted" onClick={() => send(tr(ex.zh, ex.en))}>
                  {tr(ex.zh, ex.en)}
                </button>
              ))}
            </div>
            {area && <p className="text-xs text-muted-foreground">{tr(`會優先找你選的地區：${area.county}${area.town ? ` ${area.town}` : ""}`, `Searching your selected area: ${area.county}${area.town ? ` ${area.town}` : ""}`)}</p>}
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "space-y-2"}>
            <div className={m.role === "user"
              ? "max-w-[85%] rounded-2xl rounded-br-sm bg-primary text-primary-foreground px-3 py-2 text-sm"
              : "max-w-[95%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm whitespace-pre-line"}
            >
              {m.text}
            </div>
            {m.cards && m.cards.length > 0 && (
              <div className="grid gap-2">
                {m.cards.map((card) => <CandidateCard key={`${card.type}-${card.id}`} card={card} onOpen={() => openCard(card)} />)}
              </div>
            )}
          </div>
        ))}

        {busy && <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Sparkles className="w-4 h-4 animate-pulse" /> {tr("正在查詢店家與名額…", "Checking vendors and availability…")}</p>}
        {disclaimer && messages.length > 0 && <p className="text-[11px] text-muted-foreground">{disclaimer}</p>}
        <div ref={bottomRef} />
      </div>
    </BottomSheet>
  );
}

function CandidateCard({ card, onOpen }: { card: Card; onOpen: () => void }) {
  if (card.type === "plan") {
    return (
      <button type="button" onClick={onOpen} className="text-left w-full rounded-xl border border-border bg-card p-3 hover:border-primary transition-colors">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><CalendarCheck className="w-3.5 h-3.5" /> {card.vendor_name}・{card.label}</div>
        <p className="font-semibold text-sm">{card.name}</p>
        <p className="text-xs">{tr(`${card.days} 天・每餐 NT$${card.price_per_meal}`, `${card.days} days · NT$${card.price_per_meal} per meal`)}</p>
      </button>
    );
  }
  return (
    <button type="button" onClick={onOpen} className="text-left w-full rounded-xl border border-border bg-card p-3 flex gap-3 hover:border-primary transition-colors">
      <div className="w-14 h-14 rounded-lg overflow-hidden bg-accent shrink-0 flex items-center justify-center">
        {card.image ? <img src={card.image} alt="" className="w-full h-full object-cover" /> : <UtensilsCrossed className="w-5 h-5 text-brand" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground truncate">{card.vendor_name}</p>
        <p className="font-semibold text-sm truncate">{card.name}</p>
        <p className="text-xs">
          {card.estimated_price !== null && card.estimated_price < card.list_price ? (
            <><span className="font-semibold text-primary">NT${card.estimated_price}</span> <span className="line-through text-muted-foreground">{card.list_price}</span></>
          ) : (
            <span className="font-semibold">NT${card.list_price}</span>
          )}
          {card.date && <span className="text-muted-foreground">・{card.date.slice(5)}{card.window ? ` ${slotLabel(card.window)}` : ""}</span>}
        </p>
        {(card.dietary_tags.length > 0 || card.closed_dates.length > 0) && (
          <p className="text-[11px] text-muted-foreground truncate">
            {card.dietary_tags.map((tag) => tr(tag, tagEn(tag))).join(" · ")}
            {card.closed_dates.length > 0 && <span className="text-warning-text">{card.dietary_tags.length ? "・" : ""}{tr(`${card.closed_dates.map((d) => d.slice(5)).join("、")} 不能訂`, `unavailable ${card.closed_dates.map((d) => d.slice(5)).join(", ")}`)}</span>}
          </p>
        )}
      </div>
    </button>
  );
}
