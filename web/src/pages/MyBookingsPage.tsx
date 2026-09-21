import { useState } from "react";
import { ChevronLeft, ChevronRight, QrCode, CheckCircle2, Gift, Repeat } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

// 對應 UI草圖 MyBookings.dc.html「我的商品」（2026-09-21 改名「我的餐點」，只給
// 一般使用者看；廠商端這個 nav 分頁換成接受端的核對取餐，見 MarketplaceHeader.tsx）
// ——一週餐點行事曆（列＝早/午/晚，
// 欄＝週一~日），每格可「使用（QR核銷）／贈送（指名朋友）／交易（上架轉讓）／
// 留下回饋」。
//
// TODO(firebase): 這頁目前完全是版面骨架 + 前端 local state 示意，資料是寫死的
// mock 陣列，還沒接 Firestore 的 locks collection。接後端時要處理：
//   - 「使用」核銷：串 markLockOutcome（functions/src/index.js，client 不可直接
//     改 lock 狀態）
//   - 「贈送」指名轉移：目前 claimResoldLock 只支援不指名、任何人接手，指名贈送
//     需要新的 Cloud Function（TODO.md「草圖裡後端還接不上的功能」第 2 項）
//   - 「交易」上架轉讓：對應現有 for_resale 狀態（消費者端「轉賣這份」按鈕的邏輯，
//     可參照 MyBookings 尚未串接的頁面）
//   - 「留下回饋」：無對應 collection，需另外設計（第 3 項）

type CellStatus = "used" | "no_show" | "pending";
type TransferMode = "gift" | "sell" | null;

interface BookingCell {
  key: string;
  type: "計畫型" | "單點型";
  restaurant: string;
  dish: string;
  time: string;
  status: CellStatus;
  isPast: boolean;
}

const DAYS = ["星期一", "星期二", "星期三", "星期四", "星期五", "星期六", "星期日"];
const TODAY_INDEX = 3; // 星期四

const SINGLE_ORDER = [
  { dish: "舒肥雞胸溫沙拉餐盒", time: "12:00–12:30 取餐" },
  { dish: "塔香牛肉藜麥碗", time: "11:30–12:00 取餐" },
  { dish: "地中海鮪魚酪梨碗", time: "12:30–13:00 取餐" },
];

const RAW_ROWS: { label: string; raw: [BookingCell["type"], string, string, string, boolean][] }[] = [
  {
    label: "早餐",
    raw: [
      ["單點型", "校園咖啡廳", SINGLE_ORDER[0].dish, "07:30–08:00 取餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[1].dish, "07:30–08:00 取餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[2].dish, "07:30–08:00 取餐", true],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[0].dish, "07:30–08:00 取餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[1].dish, "07:30–08:00 取餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[2].dish, "07:30–08:00 取餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[0].dish, "07:30–08:00 取餐", false],
    ],
  },
  {
    label: "午餐",
    raw: [
      ["計畫型", "一頭牛日式燒肉丼", "A方案：減脂健身餐・第1/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案：減脂健身餐・第2/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案：減脂健身餐・第3/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案：減脂健身餐・第4/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案：減脂健身餐・第5/5天", "每日午餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[1].dish, SINGLE_ORDER[1].time, false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[2].dish, SINGLE_ORDER[2].time, false],
    ],
  },
  {
    label: "晚餐",
    raw: [
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第1/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第2/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第3/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第4/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第5/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第6/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案：全穀養生餐・第7/7天", "每日晚餐", false],
    ],
  },
];

const MEAL_ROWS = RAW_ROWS.map((row, rowIndex) => ({
  label: row.label,
  cells: row.raw.map(([type, restaurant, dish, time, noShow], dayIndex): BookingCell => {
    const isPast = dayIndex < TODAY_INDEX;
    return {
      key: `${rowIndex}-${dayIndex}`,
      type, restaurant, dish, time,
      status: noShow ? "no_show" : isPast ? "used" : "pending",
      isPast,
    };
  }),
}));

const STATUS_STYLE: Record<CellStatus, { label: string; className: string }> = {
  used: { label: "已取餐", className: "bg-green-50 text-green-700" },
  no_show: { label: "No-show", className: "bg-red-50 text-red-600" },
  pending: { label: "待取餐", className: "bg-amber-50 text-amber-700" },
};

const TYPE_COLOR: Record<BookingCell["type"], string> = {
  計畫型: "text-green-700",
  單點型: "text-orange-600",
};

export default function MyBookingsPage() {
  const { toast } = useToast();
  const [weekOffset, setWeekOffset] = useState(0);
  const [useOpen, setUseOpen] = useState<Record<string, boolean>>({});
  const [usedCells, setUsedCells] = useState<Record<string, boolean>>({});
  const [transferMode, setTransferMode] = useState<Record<string, TransferMode>>({});
  const [giftDraft, setGiftDraft] = useState<Record<string, string>>({});
  const [sellDraft, setSellDraft] = useState<Record<string, string>>({});
  const [transferResult, setTransferResult] = useState<Record<string, { type: "gift" | "sell"; text: string }>>({});
  const [feedbackOpen, setFeedbackOpen] = useState<Record<string, boolean>>({});
  const [feedbackDraft, setFeedbackDraft] = useState<Record<string, string>>({});
  const [feedbackSubmitted, setFeedbackSubmitted] = useState<Record<string, string>>({
    "0-0": "份量剛好，很滿足！",
    "0-1": "口味偏鹹，可以調整",
    "0-2": "睡過頭，沒吃到，殘念",
    "2-0": "全穀餐很喜歡，會續訂",
    "2-2": "晚餐很棒，續訂了",
  });

  function confirmUse(key: string) {
    setUsedCells(prev => ({ ...prev, [key]: true }));
    setUseOpen(prev => ({ ...prev, [key]: false }));
    toast({ title: "核銷完成", description: "示意畫面：實際核銷需串接 markLockOutcome。" });
  }

  function confirmGift(key: string) {
    const name = (giftDraft[key] || "").trim();
    if (!name) return;
    setTransferResult(prev => ({ ...prev, [key]: { type: "gift", text: `已贈送給 ${name}` } }));
    setTransferMode(prev => ({ ...prev, [key]: null }));
    toast({ title: "已贈送", description: "示意畫面：指名贈送尚未有對應後端功能。" });
  }

  function confirmSell(key: string) {
    const price = (sellDraft[key] || "").trim();
    if (!price) return;
    setTransferResult(prev => ({ ...prev, [key]: { type: "sell", text: `已上架交易・$${price}` } }));
    setTransferMode(prev => ({ ...prev, [key]: null }));
    toast({ title: "已上架轉讓市集" });
  }

  function cancelTransferResult(key: string) {
    setTransferResult(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }

  function submitFeedback(key: string) {
    const text = (feedbackDraft[key] || "").trim();
    if (!text) return;
    setFeedbackSubmitted(prev => ({ ...prev, [key]: text }));
    setFeedbackOpen(prev => ({ ...prev, [key]: false }));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="bookings" />

      {/* ── Hero ── */}
      <section className="px-4 md:px-6 py-6 flex items-center justify-between flex-wrap gap-3 max-w-[1400px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold mb-1">我的餐點</h1>
          <p className="text-sm text-muted-foreground">
            09/22（一）－ 09/28（日）這週的餐點行事曆・今天是 09/25（四）
            {weekOffset !== 0 && `（週偏移 ${weekOffset > 0 ? "+" : ""}${weekOffset}，示意用）`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w - 1)}>
            <ChevronLeft className="w-4 h-4 mr-1" /> 上週
          </Button>
          <Button variant="outline" size="sm" onClick={() => setWeekOffset(w => w + 1)}>
            下週 <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      </section>

      {/* ── Body ── */}
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 pb-10 space-y-4">
        {/* legend */}
        <div className="flex items-center justify-between flex-wrap gap-3 text-xs">
          <div className="flex gap-4">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-700 inline-block" /> 計畫型（訂閱制，每日供餐）</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" /> 單點型（校園咖啡廳單次預購）</span>
          </div>
          <div className="flex gap-2">
            {Object.values(STATUS_STYLE).map(s => (
              <span key={s.label} className={`px-2 py-0.5 rounded-full font-semibold ${s.className}`}>{s.label}</span>
            ))}
          </div>
        </div>

        {/* calendar grid */}
        <div className="bg-white border border-border rounded-2xl overflow-x-auto">
          <div className="min-w-[980px] grid" style={{ gridTemplateColumns: "80px repeat(7, 1fr)" }}>
            <div className="border-b border-border" />
            {DAYS.map((d, i) => (
              <div
                key={d}
                className={`border-b border-l border-border px-2 py-2 text-center text-xs font-semibold ${
                  i === TODAY_INDEX ? "bg-orange-50 text-orange-600" : "text-muted-foreground"
                }`}
              >
                {d}
              </div>
            ))}

            {MEAL_ROWS.map(row => (
              <div key={row.label} className="contents">
                <div className="border-b border-border px-2 py-3 text-xs font-bold text-muted-foreground flex items-start">
                  {row.label}
                </div>
                {row.cells.map(cell => {
                  const statusInfo = STATUS_STYLE[cell.status];
                  const canTransfer = !cell.isPast;
                  const isUsed = canTransfer && !!usedCells[cell.key];
                  const isUseOpen = canTransfer && !!useOpen[cell.key] && !isUsed;
                  const result = transferResult[cell.key];
                  const mode = transferMode[cell.key];
                  const showGiftForm = canTransfer && mode === "gift" && !result && !isUsed && !isUseOpen;
                  const showSellForm = canTransfer && mode === "sell" && !result && !isUsed && !isUseOpen;
                  const showTransferButtons = canTransfer && !result && !isUsed && !showGiftForm && !showSellForm && !isUseOpen;
                  const redeemCode = `BB-${cell.key.replace("-", "")}`;
                  const submittedText = feedbackSubmitted[cell.key];
                  const isFeedbackOpen = !!feedbackOpen[cell.key] && !submittedText;

                  return (
                    <div key={cell.key} className="border-b border-l border-border p-2 flex flex-col gap-1.5 min-h-[132px]">
                      <span className={`self-start text-[10px] font-bold px-1.5 py-0.5 rounded-full ${statusInfo.className}`}>
                        {statusInfo.label}
                      </span>
                      <p className={`text-[10px] font-bold ${TYPE_COLOR[cell.type]}`}>{cell.type}</p>
                      <p className="text-xs font-semibold leading-snug line-clamp-1">{cell.restaurant}</p>
                      <p className="text-xs leading-snug line-clamp-2 text-muted-foreground">{cell.dish}</p>
                      <p className="text-[10px] text-muted-foreground">{cell.time}</p>

                      {showTransferButtons && (
                        <div className="mt-auto flex flex-col gap-1 pt-1">
                          <button
                            onClick={() => setUseOpen(prev => ({ ...prev, [cell.key]: true }))}
                            className="text-[11px] font-bold py-1 rounded-md bg-orange-500 text-white"
                          >
                            使用
                          </button>
                          <div className="flex gap-1">
                            <button
                              onClick={() => setTransferMode(prev => ({ ...prev, [cell.key]: "gift" }))}
                              className="flex-1 text-[10px] font-semibold py-1 rounded-md border border-border"
                            >
                              贈送
                            </button>
                            <button
                              onClick={() => setTransferMode(prev => ({ ...prev, [cell.key]: "sell" }))}
                              className="flex-1 text-[10px] font-semibold py-1 rounded-md border border-border"
                            >
                              交易
                            </button>
                          </div>
                        </div>
                      )}

                      {isUseOpen && (
                        <div className="mt-auto flex flex-col items-center gap-1 pt-1 text-center">
                          <QrCode className="w-8 h-8" />
                          <span className="text-[10px] font-bold">核銷碼 {redeemCode}</span>
                          <span className="text-[9px] text-muted-foreground">請於取餐時向店員出示</span>
                          <div className="flex gap-1 w-full">
                            <button onClick={() => confirmUse(cell.key)} className="flex-1 text-[10px] font-bold py-1 rounded-md bg-green-700 text-white">完成核銷</button>
                            <button onClick={() => setUseOpen(prev => ({ ...prev, [cell.key]: false }))} className="flex-1 text-[10px] font-semibold py-1 rounded-md border border-border">返回</button>
                          </div>
                        </div>
                      )}

                      {isUsed && (
                        <div className="mt-auto flex items-center gap-1 pt-1 text-[10px] font-semibold text-green-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> 已完成核銷取餐
                        </div>
                      )}

                      {showGiftForm && (
                        <div className="mt-auto flex flex-col gap-1 pt-1">
                          <label htmlFor={`gift-${cell.key}`} className="sr-only">朋友的暱稱</label>
                          <input
                            id={`gift-${cell.key}`}
                            value={giftDraft[cell.key] || ""}
                            onChange={e => setGiftDraft(prev => ({ ...prev, [cell.key]: e.target.value }))}
                            placeholder="朋友的暱稱/學號"
                            className="text-[10px] border border-border rounded-md px-1.5 py-1"
                          />
                          <div className="flex gap-1">
                            <button onClick={() => confirmGift(cell.key)} className="flex-1 text-[10px] font-bold py-1 rounded-md bg-green-700 text-white">確認贈送</button>
                            <button onClick={() => setTransferMode(prev => ({ ...prev, [cell.key]: null }))} className="flex-1 text-[10px] font-semibold py-1 rounded-md border border-border">取消</button>
                          </div>
                        </div>
                      )}

                      {showSellForm && (
                        <div className="mt-auto flex flex-col gap-1 pt-1">
                          <label htmlFor={`sell-${cell.key}`} className="sr-only">轉讓價格</label>
                          <input
                            id={`sell-${cell.key}`}
                            inputMode="numeric"
                            value={sellDraft[cell.key] || ""}
                            onChange={e => setSellDraft(prev => ({ ...prev, [cell.key]: e.target.value }))}
                            placeholder="轉讓價格（$）"
                            className="text-[10px] border border-border rounded-md px-1.5 py-1"
                          />
                          <div className="flex gap-1">
                            <button onClick={() => confirmSell(cell.key)} className="flex-1 text-[10px] font-bold py-1 rounded-md bg-orange-500 text-white">上架交易</button>
                            <button onClick={() => setTransferMode(prev => ({ ...prev, [cell.key]: null }))} className="flex-1 text-[10px] font-semibold py-1 rounded-md border border-border">取消</button>
                          </div>
                        </div>
                      )}

                      {result && (
                        <div className="mt-auto flex flex-col gap-1 pt-1">
                          <p className="text-[10px] font-semibold flex items-center gap-1">
                            {result.type === "gift" ? <Gift className="w-3 h-3" /> : <Repeat className="w-3 h-3" />} {result.text}
                          </p>
                          <button onClick={() => cancelTransferResult(cell.key)} className="text-[10px] font-semibold py-1 rounded-md border border-red-300 text-red-600">取消交易</button>
                        </div>
                      )}

                      {cell.isPast && submittedText && (
                        <p className="mt-auto text-[10px] text-muted-foreground pt-1 line-clamp-2">已回饋：「{submittedText}」</p>
                      )}
                      {cell.isPast && !submittedText && !isFeedbackOpen && (
                        <button
                          onClick={() => setFeedbackOpen(prev => ({ ...prev, [cell.key]: true }))}
                          className="mt-auto text-[10px] font-semibold py-1 rounded-md border border-border"
                        >
                          留下回饋
                        </button>
                      )}
                      {isFeedbackOpen && (
                        <div className="mt-auto flex flex-col gap-1 pt-1">
                          <label htmlFor={`fb-${cell.key}`} className="sr-only">留下回饋</label>
                          <input
                            id={`fb-${cell.key}`}
                            value={feedbackDraft[cell.key] || ""}
                            onChange={e => setFeedbackDraft(prev => ({ ...prev, [cell.key]: e.target.value }))}
                            placeholder="這餐的心得…"
                            className="text-[10px] border border-border rounded-md px-1.5 py-1"
                          />
                          <button onClick={() => submitFeedback(cell.key)} className="text-[10px] font-bold py-1 rounded-md bg-orange-500 text-white">送出回饋</button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
