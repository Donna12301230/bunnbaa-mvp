import { tr } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Link } from "wouter";

const FAQS = [
  {
    q: tr("要怎麼預購餐點？", "How do I pre-order a meal?"),
    a: tr(
      "在「商家」頁選一家店、點便當選取餐日（可訂到下週五）、配菜（可許願候選菜或選「不要」）與加減飯，加入購物車後用 LINE Pay 結帳。取餐前一天 20:00 截單。",
      "Go to Vendors, pick a store and a bento, then choose the pickup day (up to next Friday), sides (wish for a candidate or remove one) and rice. Check out with LINE Pay. Orders close at 20:00 the day before."
    ),
  },
  {
    q: tr("早鳥折扣怎麼算？", "How does the early-bird discount work?"),
    a: tr(
      "越早訂，越開心：訂明天的 95 折，提前 2 天以上 8 折（預訂範圍到下週五）。加飯 +10、減飯 −5、某格配菜不要 −5，直接反映在金額上。",
      "Book early, save more: 5% off for tomorrow, 20% off 2+ days ahead (you can book up to next Friday). Extra rice +10, less rice −5, and removing a side −5."
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
      "店家若未如期出餐，訂單會全額退款，並額外加贈 20 點回饋金。",
      "If a vendor fails to serve your order on time, you'll receive a full refund plus 20 bonus reward points."
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
      active={undefined}
      hero={<PageHero title={tr("常見問題", "FAQ")} description={tr("關於預購、取餐、退款最常被問到的問題。", "Answers to the questions we hear most about pre-ordering, pickup, and refunds.")} />}
    >
      <div className="max-w-2xl mx-auto space-y-2">
        {FAQS.map(({ q, a }) => (
          <details key={q} className="group bg-white rounded-xl border border-border px-4 py-3">
            <summary className="flex items-center justify-between gap-3 cursor-pointer list-none font-medium text-sm">
              {q}
              <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">{a}</p>
          </details>
        ))}

        <p className="text-sm text-muted-foreground text-center pt-4">
          {tr("沒找到你想問的？", "Didn't find what you're looking for? ")}
          <Link href="/contact" className="text-orange-600 hover:underline">{tr("聯絡客服", "Contact support")}</Link>
        </p>
      </div>
    </CustomerLayout>
  );
}
