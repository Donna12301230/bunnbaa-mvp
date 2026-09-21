import { useState } from "react";
import { ChevronLeft, ChevronRight, QrCode, CheckCircle2, Gift, Repeat } from "lucide-react";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// 對應 UI草圖 MyBookings.dc.html「我的商品」(2026-09-21 改名「我的餐點」,只給
// 一般使用者看;廠商端這個 nav 分頁換成接受端的核對取餐,見 MarketplaceHeader.tsx)
// ——一週餐點行事曆(列＝早/午/晚,
// 欄＝週一~日),每格可「使用(QR核銷)／贈送(指名朋友)／交易(上架轉讓)／
// 留下回饋」。
//
// TODO(firebase): 這頁目前完全是版面骨架 + 前端 local state 示意,資料是寫死的
// mock 陣列,還沒接 Firestore 的 locks collection。接後端時要處理:
//   - 「使用」核銷:串 markLockOutcome(functions/src/index.js,client 不可直接
//     改 lock 狀態)
//   - 「贈送」指名轉移:2026-09-21 已有對應機制,不用 Cloud Function——
//     firestore.rules 新增 for_gift 狀態:買家可把自己 locked 的 lock 轉成
//     for_gift(不公開列在任何查詢),任何「非原買家」的登入用戶都能把它
//     接回 locked＋buyer_uid 換自己。「指名」是社交層面的:把連結/lock_id
//     私下傳給朋友,同 QR 取餐碼「給誰就是誰的」的信任模型。真實端到端範例
//     在 ConsumerLockPage.tsx 的 handleGift() / handleAcceptGift()
//   - 「交易」上架轉讓:對應現有 for_resale 狀態(消費者端「轉賣這份」按鈕的邏輯,
//     可參照 MyBookings 尚未串接的頁面)
//   - 「留下回饋」:不用新 collection,沿用既有 Lock.consumer_feedback 欄位
//     (原本就餵給商家校準的 buildVendorHistory)。2026-09-21 firestore.rules
//     新增規則:買家在自己的 lock 狀態是 fulfilled/resold_and_fulfilled/no_show
//     時可以寫入一次 consumer_feedback(寫過就不能再改)。範例在
//     ConsumerLockPage.tsx 的 handleSubmitFeedback()
//
// UIUX 檢視後補上:原本只有一份固定 min-w-[980px] 的 7 欄週曆 grid,手機只能整頁
// 橫向捲動,格子內文字小到 9~10px、按鈕觸控熱區也太小。這裡把每格的內容抽成
// CellBody 共用,桌機維持原本的週曆 grid(md 以上),手機改成「一天一區塊、每區塊
// 三張餐卡」的直向清單(md 以下),文字與按鈕尺寸也一併放大到至少可讀/可點的程度。

const FOCUS_RING = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-1";

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
      ["計畫型", "一頭牛日式燒肉丼", "A方案:減脂健身餐・第1/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案:減脂健身餐・第2/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案:減脂健身餐・第3/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案:減脂健身餐・第4/5天", "每日午餐", false],
      ["計畫型", "一頭牛日式燒肉丼", "A方案:減脂健身餐・第5/5天", "每日午餐", false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[1].dish, SINGLE_ORDER[1].time, false],
      ["單點型", "校園咖啡廳", SINGLE_ORDER[2].dish, SINGLE_ORDER[2].time, false],
    ],
  },
  {
    label: "晚餐",
    raw: [
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第1/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第2/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第3/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第4/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第5/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第6/7天", "每日晚餐", false],
      ["計畫型", "元氣蔬食坊", "B方案:全穀養生餐・第7/7天", "每日晚餐", false],
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

interface CellMeta {
  statusInfo: { label: string; className: string };
  canTransfer: boolean;
  isUsed: boolean;
  isUseOpen: boolean;
  result?: { type: "gift" | "sell"; text: string };
  showGiftForm: boolean;
  showSellForm: boolean;
  showTransferButtons: boolean;
  redeemCode: string;
  submittedText?: string;
  isFeedbackOpen: boolean;
  giftValue: string;
  sellValue: string;
  feedbackValue: string;
  onOpenUse: () => void;
  onConfirmUse: () => void;
  onCancelUse: () => void;
  onStartGift: () => void;
  onStartSell: () => void;
  onGiftChange: (v: string) => void;
  onConfirmGift: () => void;
  onSellChange: (v: string) => void;
  onConfirmSell: () => void;
  onCancelTransfer: () => void;
  onCancelResult: () => void;
  onOpenFeedback: () => void;
  onFeedbackChange: (v: string) => void;
  onSubmitFeedback: () => void;
}

// 每格的內容與互動邏輯——桌機週曆 grid、手機每日清單共用同一份,只靠 `dense`
// 切換字級/按鈕尺寸(手機版字級更大、按鈕熱區更高,方便點擊)。
function CellBody({ cell, meta, dense }: { cell: BookingCell; meta: CellMeta; dense: boolean }) {
  const labelSize = dense ? "text-[11px]" : "text-xs";
  const titleSize = dense ? "text-xs" : "text-sm";
  const timeSize = dense ? "text-[11px]" : "text-xs";
  const btnPad = dense ? "py-1.5" : "py-2.5";
  const btnText = dense ? "text-[11px]" : "text-xs";

  return (
    <div className="flex flex-col gap-1.5">
      <span className={cn("self-start font-bold px-1.5 py-0.5 rounded-full", labelSize, meta.statusInfo.className)}>
        {meta.statusInfo.label}
      </span>
      <p className={cn("font-bold", labelSize, TYPE_COLOR[cell.type])}>{cell.type}</p>
      <p className={cn("font-semibold leading-snug", titleSize)}>{cell.restaurant}</p>
      <p className={cn("leading-snug text-muted-foreground", titleSize, dense && "line-clamp-2")}>{cell.dish}</p>
      <p className={cn("text-muted-foreground", timeSize)}>{cell.time}</p>

      {meta.showTransferButtons && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <button
            onClick={meta.onOpenUse}
            className={cn("font-bold rounded-md bg-orange-500 text-white", btnPad, btnText, FOCUS_RING)}
          >
            使用
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={meta.onStartGift}
              className={cn("flex-1 font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}
            >
              贈送
            </button>
            <button
              onClick={meta.onStartSell}
              className={cn("flex-1 font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}
            >
              交易
            </button>
          </div>
        </div>
      )}

      {meta.isUseOpen && (
        <div className="mt-auto flex flex-col items-center gap-1.5 pt-1 text-center">
          <QrCode className={dense ? "w-8 h-8" : "w-10 h-10"} />
          <span className={cn("font-bold", labelSize)}>核銷碼 {meta.redeemCode}</span>
          <span className={cn("text-muted-foreground", dense ? "text-[9px]" : "text-[11px]")}>請於取餐時向店員出示</span>
          <div className="flex gap-1.5 w-full">
            <button onClick={meta.onConfirmUse} className={cn("flex-1 font-bold rounded-md bg-green-700 text-white", btnPad, btnText, FOCUS_RING)}>完成核銷</button>
            <button onClick={meta.onCancelUse} className={cn("flex-1 font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}>返回</button>
          </div>
        </div>
      )}

      {meta.isUsed && (
        <div className={cn("mt-auto flex items-center gap-1.5 pt-1 font-semibold text-green-700", btnText)}>
          <CheckCircle2 className="w-3.5 h-3.5" /> 已完成核銷取餐
        </div>
      )}

      {meta.showGiftForm && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <label htmlFor={`gift-${cell.key}`} className="sr-only">朋友的暱稱</label>
          <input
            id={`gift-${cell.key}`}
            value={meta.giftValue}
            onChange={e => meta.onGiftChange(e.target.value)}
            placeholder="朋友的暱稱/學號"
            className={cn("border border-border rounded-md px-2 py-1.5", btnText)}
          />
          <div className="flex gap-1.5">
            <button onClick={meta.onConfirmGift} className={cn("flex-1 font-bold rounded-md bg-green-700 text-white", btnPad, btnText, FOCUS_RING)}>確認贈送</button>
            <button onClick={meta.onCancelTransfer} className={cn("flex-1 font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}>取消</button>
          </div>
        </div>
      )}

      {meta.showSellForm && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <label htmlFor={`sell-${cell.key}`} className="sr-only">轉讓價格</label>
          <input
            id={`sell-${cell.key}`}
            inputMode="numeric"
            value={meta.sellValue}
            onChange={e => meta.onSellChange(e.target.value)}
            placeholder="轉讓價格($)"
            className={cn("border border-border rounded-md px-2 py-1.5", btnText)}
          />
          <div className="flex gap-1.5">
            <button onClick={meta.onConfirmSell} className={cn("flex-1 font-bold rounded-md bg-orange-500 text-white", btnPad, btnText, FOCUS_RING)}>上架交易</button>
            <button onClick={meta.onCancelTransfer} className={cn("flex-1 font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}>取消</button>
          </div>
        </div>
      )}

      {meta.result && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <p className={cn("font-semibold flex items-center gap-1", btnText)}>
            {meta.result.type === "gift" ? <Gift className="w-3 h-3" /> : <Repeat className="w-3 h-3" />} {meta.result.text}
          </p>
          <button onClick={meta.onCancelResult} className={cn("font-semibold rounded-md border border-red-300 text-red-600", btnPad, btnText, FOCUS_RING)}>取消交易</button>
        </div>
      )}

      {cell.isPast && meta.submittedText && (
        <p className={cn("mt-auto text-muted-foreground pt-1 line-clamp-2", timeSize)}>已回饋:「{meta.submittedText}」</p>
      )}
      {cell.isPast && !meta.submittedText && !meta.isFeedbackOpen && (
        <button
          onClick={meta.onOpenFeedback}
          className={cn("mt-auto font-semibold rounded-md border border-border", btnPad, btnText, FOCUS_RING)}
        >
          留下回饋
        </button>
      )}
      {meta.isFeedbackOpen && (
        <div className="mt-auto flex flex-col gap-1.5 pt-1">
          <label htmlFor={`fb-${cell.key}`} className="sr-only">留下回饋</label>
          <input
            id={`fb-${cell.key}`}
            value={meta.feedbackValue}
            onChange={e => meta.onFeedbackChange(e.target.value)}
            placeholder="這餐的心得…"
            className={cn("border border-border rounded-md px-2 py-1.5", btnText)}
          />
          <button onClick={meta.onSubmitFeedback} className={cn("font-bold rounded-md bg-orange-500 text-white", btnPad, btnText, FOCUS_RING)}>送出回饋</button>
        </div>
      )}
    </div>
  );
}

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
    "0-0": "份量剛好,很滿足!",
    "0-1": "口味偏鹹,可以調整",
    "0-2": "睡過頭,沒吃到,殘念",
    "2-0": "全穀餐很喜歡,會續訂",
    "2-2": "晚餐很棒,續訂了",
  });

  function confirmUse(key: string) {
    setUsedCells(prev => ({ ...prev, [key]: true }));
    setUseOpen(prev => ({ ...prev, [key]: false }));
    toast({ title: "核銷完成", description: "示意畫面:實際核銷需串接 markLockOutcome。" });
  }

  function confirmGift(key: string) {
    const name = (giftDraft[key] || "").trim();
    if (!name) return;
    setTransferResult(prev => ({ ...prev, [key]: { type: "gift", text: `已贈送給 ${name}` } }));
    setTransferMode(prev => ({ ...prev, [key]: null }));
    toast({ title: "已贈送", description: "示意畫面:指名贈送尚未有對應後端功能。" });
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

  const cellMetaByKey: Record<string, CellMeta> = {};
  for (const row of MEAL_ROWS) {
    for (const cell of row.cells) {
      const statusInfo = STATUS_STYLE[cell.status];
      const canTransfer = !cell.isPast;
      const isUsed = canTransfer && !!usedCells[cell.key];
      const isUseOpen = canTransfer && !!useOpen[cell.key] && !isUsed;
      const result = transferResult[cell.key];
      const mode = transferMode[cell.key];
      const showGiftForm = canTransfer && mode === "gift" && !result && !isUsed && !isUseOpen;
      const showSellForm = canTransfer && mode === "sell" && !result && !isUsed && !isUseOpen;
      const showTransferButtons = canTransfer && !result && !isUsed && !showGiftForm && !showSellForm && !isUseOpen;
      const submittedText = feedbackSubmitted[cell.key];
      const isFeedbackOpen = !!feedbackOpen[cell.key] && !submittedText;

      cellMetaByKey[cell.key] = {
        statusInfo, canTransfer, isUsed, isUseOpen, result,
        showGiftForm, showSellForm, showTransferButtons,
        redeemCode: `BB-${cell.key.replace("-", "")}`,
        submittedText, isFeedbackOpen,
        giftValue: giftDraft[cell.key] || "",
        sellValue: sellDraft[cell.key] || "",
        feedbackValue: feedbackDraft[cell.key] || "",
        onOpenUse: () => setUseOpen(prev => ({ ...prev, [cell.key]: true })),
        onConfirmUse: () => confirmUse(cell.key),
        onCancelUse: () => setUseOpen(prev => ({ ...prev, [cell.key]: false })),
        onStartGift: () => setTransferMode(prev => ({ ...prev, [cell.key]: "gift" })),
        onStartSell: () => setTransferMode(prev => ({ ...prev, [cell.key]: "sell" })),
        onGiftChange: v => setGiftDraft(prev => ({ ...prev, [cell.key]: v })),
        onConfirmGift: () => confirmGift(cell.key),
        onSellChange: v => setSellDraft(prev => ({ ...prev, [cell.key]: v })),
        onConfirmSell: () => confirmSell(cell.key),
        onCancelTransfer: () => setTransferMode(prev => ({ ...prev, [cell.key]: null })),
        onCancelResult: () => cancelTransferResult(cell.key),
        onOpenFeedback: () => setFeedbackOpen(prev => ({ ...prev, [cell.key]: true })),
        onFeedbackChange: v => setFeedbackDraft(prev => ({ ...prev, [cell.key]: v })),
        onSubmitFeedback: () => submitFeedback(cell.key),
      };
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <MarketplaceHeader active="bookings" />

      {/* ── Hero ── */}
      <section className="px-4 md:px-6 py-6 flex items-center justify-between flex-wrap gap-3 max-w-[1400px] mx-auto">
        <div>
          <h1 className="text-2xl font-bold mb-1">我的餐點</h1>
          <p className="text-sm text-muted-foreground">
            09/22(一)－ 09/28(日)這週的餐點行事曆・今天是 09/25(四)
            {weekOffset !== 0 && `(週偏移 ${weekOffset > 0 ? "+" : ""}${weekOffset},示意用)`}
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
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-green-700 inline-block" /> 計畫型(訂閱制,每日供餐)</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-orange-500 inline-block" /> 單點型(校園咖啡廳單次預購)</span>
          </div>
          <div className="flex gap-2">
            {Object.values(STATUS_STYLE).map(s => (
              <span key={s.label} className={`px-2 py-0.5 rounded-full font-semibold ${s.className}`}>{s.label}</span>
            ))}
          </div>
        </div>

        {/* 桌機:週曆 grid(md 以上) */}
        <div className="hidden md:block bg-white border border-border rounded-2xl overflow-x-auto">
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
                {row.cells.map(cell => (
                  <div key={cell.key} className="border-b border-l border-border p-2 flex flex-col gap-1.5 min-h-[132px]">
                    <CellBody cell={cell} meta={cellMetaByKey[cell.key]} dense />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* 手機:每天一區塊、餐卡直向排列(md 以下) */}
        <div className="md:hidden space-y-5">
          {DAYS.map((day, dayIndex) => (
            <section key={day} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5">
                <h3 className={cn("text-sm font-bold", dayIndex === TODAY_INDEX ? "text-orange-600" : "text-foreground")}>
                  {day}
                </h3>
                {dayIndex === TODAY_INDEX && (
                  <span className="text-[10px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">今天</span>
                )}
              </div>
              <div className="space-y-2">
                {MEAL_ROWS.map(row => {
                  const cell = row.cells[dayIndex];
                  return (
                    <div key={cell.key} className="bg-white border border-border rounded-xl p-3">
                      <p className="text-xs font-bold text-muted-foreground mb-2">{row.label}</p>
                      <CellBody cell={cell} meta={cellMetaByKey[cell.key]} dense={false} />
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
