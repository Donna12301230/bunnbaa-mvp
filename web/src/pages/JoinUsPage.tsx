import { tr } from "@/lib/i18n";
import { useLocation } from "wouter";
import { ClipboardCheck, PiggyBank, TrendingUp, Users2 } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Button } from "@/components/ui/button";

const BENEFITS = [
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
      "商家頁、分類搜尋、轉讓市集都會曝光你的店，不用自己另外經營行銷管道。",
      "Your store shows up in vendor listings, category search, and the transfer marketplace — no separate marketing channel needed."
    ),
  },
  {
    icon: ClipboardCheck,
    title: tr("後台一站管理", "Everything in one dashboard"),
    body: tr(
      "菜單、取餐時段、每日備料、訂單核銷、營收報表都在同一個商家後台完成。",
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
          {BENEFITS.map(({ icon: Icon, title, body }, i) => (
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
        <section className="grid gap-8 md:grid-cols-[1fr_1.1fr] items-center rounded-[2rem] md:rounded-[3rem] border border-ink bg-accent p-8 md:p-14">
          <div className="space-y-4">
            <h2 className="font-heading text-3xl md:text-4xl font-semibold flex items-center gap-3">
              <PiggyBank className="w-8 h-8 text-primary" aria-hidden="true" /> {tr("合作方案", "Pricing")}
            </h2>
            <p className="text-muted-foreground leading-relaxed">
              {tr(
                "首月免費試用，之後每月 NT$1,999，沒有其他上架或抽成費用。到期前平台會主動聯絡您確認續約。",
                "The first month is free. After that it's NT$1,999 / month, with no other listing fees or commission. We'll reach out to confirm renewal before your trial ends."
              )}
            </p>
          </div>
          <div className="rounded-[1.75rem] border border-ink bg-card p-8 md:p-10">
            <span className="inline-block text-xs font-bold px-3 py-1 rounded-full bg-[#f29e0c] text-[#2b180d]">{tr("首月免費", "First month free")}</span>
            <p className="mt-5 font-heading font-semibold leading-none">
              <span className="text-2xl align-top mr-1">NT$</span>
              <span className="text-[clamp(64px,9vw,112px)] tracking-[-0.04em]">1,999</span>
              <span className="text-lg text-muted-foreground font-normal ml-2">{tr("／月", "/ mo")}</span>
            </p>
            <p className="mt-4 text-sm text-muted-foreground">{tr("0 抽成・0 上架費", "0% commission · no listing fees")}</p>
          </div>
        </section>

        <section className="text-center space-y-5 max-w-2xl mx-auto">
          <h2 className="font-heading text-[clamp(36px,5vw,64px)] font-semibold leading-tight">{tr("準備好了嗎？", "Ready to get started?")}</h2>
          <p className="text-muted-foreground leading-relaxed">
            {tr("申請只要留下店名、聯絡方式與帳號，審核通過後就能使用商家後台。", "Just leave your store name and contact details — once approved, you'll get access to the vendor portal.")}
          </p>
          <Button onClick={() => navigate("/login")} className="h-14 px-8 rounded-full text-base">
            {tr("前往廠商申請", "Apply as a vendor")}
          </Button>
        </section>
      </div>
    </CustomerLayout>
  );
}
