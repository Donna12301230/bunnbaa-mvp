import { tr } from "@/lib/i18n";
import { Plus } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Link } from "wouter";

const FAQS = [
  {
    q: tr("要怎麼預購餐點？", "How do I pre-order a meal?"),
    a: tr(
      "在「預購餐點」選早餐／午餐／晚餐與單點或方案，點便當後在價格日期列選取餐日（最遠 30 天），點圖片選主菜、配菜（候選菜點了就是許願）與飯量，加入購物車後用 LINE Pay 結帳。取餐前一天 20:00 截單，截單前可修改或取消。",
      "Go to Pre-order, pick a meal and a bento, then choose the pickup day (up to 30 days ahead), main, sides (tapping a candidate is a wish) and rice. Check out with LINE Pay. Orders close at 20:00 the day before."
    ),
  },
  {
    q: tr("早鳥折扣怎麼算？", "How does the early-bird discount work?"),
    a: tr(
      "越早訂，越開心：訂明天的 95 折，提前 2 天以上 8 折（最遠 30 天）。白飯一碗半 +10、半碗 −5、配菜少一道 −5、第四道加菜 +10（設為備案不加價），直接反映在金額上。",
      "Book early, save more: 5% off for tomorrow, 20% off 2+ days ahead (up to 30 days). 1.5 bowls of rice +10, half a bowl −5, one fewer side −5, a 4th add-on side +10 (free as a backup)."
    ),
  },
  {
    q: tr("臨時去不了怎麼辦？", "What if I can't make it after ordering?"),
    a: tr(
      "截單前可以直接取消，全額退款。截單後可以到「我的餐點」轉讓、贈送、分享代領連結，或在取餐當天按「捐為愛心餐」。",
      "Before cutoff you can cancel for a full refund. After cutoff you can transfer, gift, share a proxy pickup link, or donate it as a charity meal on the day."
    ),
  },
  {
    q: tr("沒去取餐會怎樣？", "What happens if I don't show up to pick up my order?"),
    a: tr(
      "取餐時段結束 30 分鐘後仍未取餐，便當會轉為愛心餐，開放給需要的人領取。不退款，但這筆訂單的抽獎券照常發放。",
      "Meals not picked up 30 minutes after the window become charity meals for people in need. There's no refund, but your reward tickets are still issued."
    ),
  },
  {
    q: tr("店家沒有出餐怎麼辦？", "What if the vendor doesn't serve my order?"),
    a: tr(
      "請到「聯絡客服」回報，平台會跟店家確認並協助處理。颱風、停班停課時，當天的訂單會自動取消並全額退款。",
      "Let us know via Contact us — we'll check with the vendor and help sort it out. On typhoon or work-suspension days, that day's orders are cancelled and fully refunded automatically."
    ),
  },
  {
    q: tr("可以用什麼方式付款？", "What payment methods are supported?"),
    a: tr(
      "目前透過 LINE Pay 付款，結帳時會導到 LINE Pay 完成付款再回到平台。",
      "Payment is handled through LINE Pay — checkout redirects you to LINE Pay to complete payment, then brings you back to BunnBaa."
    ),
  },
  {
    q: tr("取餐前會有提醒嗎？", "Will I get a reminder before pickup?"),
    a: tr(
      "會，取餐時段結束前 30 分鐘還沒取餐會提醒你；許願未成立、停班停課退款、抽獎開池也會通知（右上角鈴鐺）。",
      "Yes — we remind you 30 minutes before the pickup window ends, and notify you about wishes, work-suspension refunds and reward draws (see the bell icon)."
    ),
  },
  {
    q: tr("怎麼成為合作店家？", "How can my store become a partner?"),
    a: tr(
      "到「加入我們」頁面看合作方式，或直接在登入頁的「廠商申請」分頁送出申請，管理員審核通過後就能使用商家後台。",
      "See the Join us page for details, or go straight to the Vendors tab on the sign-in page to apply. Once an admin approves your application, you'll get access to the vendor portal."
    ),
  },
];

export default function FaqPage() {
  return (
    <CustomerLayout
      active={null}
      hero={<PageHero eyebrow={tr("支援", "Support")} title={tr("常見問題", "FAQ")} description={tr("關於預購、取餐、退款最常被問到的問題。", "Answers to the questions we hear most about pre-ordering, pickup, and refunds.")} />}
    >
      {/* 桌機兩欄：左邊 sticky 的「找不到答案？」，右邊問答 */}
      <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-16 items-start py-4 md:py-8">
        <aside className="lg:sticky lg:top-24 rounded-[1.75rem] border border-ink bg-accent p-7 space-y-3">
          <p className="font-heading text-2xl font-semibold">{tr("沒找到你想問的？", "Didn't find your answer?")}</p>
          <p className="text-sm text-muted-foreground">{tr("寫信給我們，通常 1～2 個工作天內回覆。", "Write to us — we usually reply within 1–2 business days.")}</p>
          <Link href="/contact" className="inline-flex items-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-hover transition-colors">
            {tr("聯絡客服", "Contact support")}
          </Link>
        </aside>

        <div className="border-t border-ink">
          {FAQS.map(({ q, a }, i) => (
            <details key={q} className="group border-b border-ink">
              <summary className="flex items-start gap-5 cursor-pointer list-none py-6 md:py-7 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                <span className="font-heading italic text-primary text-base w-7 shrink-0 pt-1" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex-1 font-heading text-xl md:text-2xl font-semibold leading-snug">{q}</span>
                <span className="w-10 h-10 shrink-0 rounded-full border border-ink flex items-center justify-center transition-[transform,background-color] duration-300 group-open:rotate-45 group-open:bg-secondary" aria-hidden="true">
                  <Plus className="w-5 h-5" />
                </span>
              </summary>
              <p className="text-muted-foreground leading-[1.85] pb-7 pl-12 pr-14 -mt-1">{a}</p>
            </details>
          ))}
        </div>
      </div>
    </CustomerLayout>
  );
}
