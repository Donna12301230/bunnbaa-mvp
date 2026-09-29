import { tr } from "@/lib/i18n";
import { ChevronDown } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Link } from "wouter";

const FAQS = [
  {
    q: tr("要怎麼預購餐點？", "How do I pre-order a meal?"),
    a: tr(
      "在「商家」頁選一家店、點想吃的品項加入購物車，結帳時選取餐日期與時段即可。提前訂通常會有早鳥折扣。",
      "Go to Vendors, pick a store and add items to your cart, then choose a pickup date and time slot at checkout. Ordering ahead usually comes with an early-bird discount."
    ),
  },
  {
    q: tr("早鳥折扣怎麼算？", "How does the early-bird discount work?"),
    a: tr(
      "依下單到取餐的天數計算：今天訂明天 95 折，提前 2～13 天 8 折，提前 14～30 天最高 7 折。",
      "It depends on how far ahead you order: 5% off for tomorrow, 20% off 2–13 days ahead, and up to 30% off 14–30 days ahead."
    ),
  },
  {
    q: tr("臨時去不了怎麼辦？", "What if I can't make it after ordering?"),
    a: tr(
      "可以到「我的餐點」把訂單轉讓或贈送給同學；如果一直沒人接手，逾時後會自動開放讓其他人 $0 領取，不會整份浪費掉。",
      "Go to My meals and transfer or gift the order to someone else. If nobody claims it in time, it's automatically opened up for anyone to claim for free — so it doesn't go to waste."
    ),
  },
  {
    q: tr("沒去取餐會怎樣？", "What happens if I don't show up to pick up my order?"),
    a: tr(
      "累計 2 次未取餐，帳號會被暫時限制下單。如果有特殊原因，可以到「會員中心」提交申訴，管理員審核後會解除限制。",
      "After 2 no-shows, your account is temporarily restricted from placing new orders. If there's a good reason, you can submit an appeal from My account — an admin will review it and lift the restriction if approved."
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
      "會，取餐時段開始前會推播通知（需先在裝置上允許通知權限）。",
      "Yes — you'll get a push notification shortly before your pickup window starts (make sure notifications are allowed on your device)."
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
