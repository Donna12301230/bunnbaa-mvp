import { tr } from "@/lib/i18n";
import { useLocation } from "wouter";
import { ClipboardCheck, PiggyBank, TrendingUp, Users2 } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Button } from "@/components/ui/button";
import { liveConfig } from "@/lib/platformConfig";

// 合作方案：不收月費，每份餐點抽成（跟平台參數的預設值同一份）
const commissionPct = () => Math.round(liveConfig().commissionRate * 1000) / 10;

const benefits = () => [
  {
    icon: TrendingUp,
    title: tr("先接單再備料", "Prep against real orders"),
    body: tr(
      "顧客提前鎖定餐點，出餐量照實際訂單準備，不用再憑經驗猜今天要做多少。",
      "Customers lock in orders ahead of time, so you prep to actual demand instead of guessing how much to make."
    ),
  },
  {
    icon: Users2,
    title: tr("穩定接觸在地客群", "Reach a steady local audience"),
    body: tr(
      "店家頁、分類搜尋、轉讓市集都會曝光你的店，不用自己另外經營行銷管道。",
      "Your store shows up in vendor listings, category search, and the transfer marketplace — no separate marketing channel needed."
    ),
  },
  {
    icon: ClipboardCheck,
    title: tr("後台一站管理", "Everything in one dashboard"),
    body: tr(
      "菜單、取餐時段、每日備料、訂單核銷、營收報表都在同一個店家後台完成。",
      "Menu, pickup windows, daily prep lists, order redemption, and revenue reports — all in one vendor portal."
    ),
  },
];

// 廠商申請流程本身在 LoginPage.tsx 的「廠商申請」分頁，這裡只做行銷說明 + 導去登入頁。
export default function JoinUsPage() {
  const [, navigate] = useLocation();
  return (
    <CustomerLayout
      active={null}
      hero={<PageHero eyebrow={tr("給店家", "For vendors")} title={tr("加入我們", "Join us")} description={tr("成為飯飽合作店家，讓預購幫你穩定備料、減少浪費。", "Become a BunnBaa partner vendor — let pre-orders help you prep with confidence and waste less.")} />}
    >
      <div className="space-y-20 md:space-y-28 py-4 md:py-8">
        <section className="grid gap-10 md:grid-cols-3 md:gap-8">
          {benefits().map(({ icon: Icon, title, body }, i) => (
            <div key={title} className="space-y-4">
              <div className="flex items-center gap-4">
                <span className="w-16 h-16 rounded-full border border-ink flex items-center justify-center bg-card">
                  <Icon className="w-7 h-7" aria-hidden="true" />
                </span>
                <span className="font-heading italic text-primary text-lg" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="font-heading text-2xl font-semibold">{title}</h3>
              <p className="text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </section>

        {/* 方案：大字價格 */}
        <section className="grid gap-8 md:grid-cols-[1fr_1.1fr] items-center rounded-card md:rounded-[3rem] border border-ink bg-accent p-8 md:p-14">
          <div className="space-y-4">
            <h2 className="font-heading text-3xl md:text-4xl font-semibold flex items-center gap-3">
              <PiggyBank className="w-8 h-8 text-primary" aria-hidden="true" /> {tr("合作方案", "Pricing")}
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {tr(
                `沒有月費、沒有上架費。平台只從每份賣出的餐點抽 ${commissionPct()}%（以消費者實付金額計），撥款時直接扣除；定價時把這 ${commissionPct()}% 加進去就好，後台會幫您換算。`,
                `No monthly fee and no listing fee. The platform only takes ${commissionPct()}% of each meal sold (of what the customer pays), deducted at payout. Just add that ${commissionPct()}% when you price — the portal does the math for you.`
              )}
            </p>
          </div>
          <div className="rounded-card border border-ink bg-card p-8 md:p-10">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-brand text-[#2b180d]">{tr("有賣才收", "Pay only when you sell")}</span>
            <p className="mt-5 font-heading font-semibold leading-none">
              <span className="text-[clamp(64px,9vw,112px)] tracking-[-0.04em]">{commissionPct()}%</span>
              <span className="text-lg text-muted-foreground font-normal ml-2">{tr("／每份餐點", "/ meal")}</span>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">{tr("0 月費・0 上架費", "No monthly fee · no listing fees")}</p>
          </div>
        </section>

        <section className="text-center space-y-5 max-w-2xl mx-auto">
          <h2 className="font-heading text-[clamp(36px,5vw,64px)] font-semibold leading-tight">{tr("準備好了嗎？", "Ready to get started?")}</h2>
          <p className="text-muted-foreground leading-relaxed">
            {tr("申請只要留下店名、聯絡方式與帳號，審核通過後就能使用店家後台。", "Just leave your store name and contact details — once approved, you'll get access to the vendor portal.")}
          </p>
          <Button onClick={() => navigate("/login")} className="h-14 px-8 rounded-full text-base">
            {tr("前往店家申請", "Apply as a vendor")}
          </Button>
        </section>
      </div>
    </CustomerLayout>
  );
}
