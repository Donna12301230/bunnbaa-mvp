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
      active={undefined}
      hero={<PageHero title={tr("加入我們", "Join us")} description={tr("成為飯飽合作店家，讓預購幫你穩定備料、減少浪費。", "Become a BunnBaa partner vendor — let pre-orders help you prep with confidence and waste less.")} />}
    >
      <div className="max-w-3xl mx-auto space-y-10">
        <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {BENEFITS.map(({ icon: Icon, title, body }) => (
            <div key={title} className="bg-white rounded-xl border border-border p-4">
              <Icon className="w-6 h-6 text-orange-500 mb-2" />
              <h3 className="font-semibold text-sm mb-1">{title}</h3>
              <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
            </div>
          ))}
        </section>

        <section className="bg-white rounded-xl border border-border p-6 space-y-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <PiggyBank className="w-5 h-5 text-orange-500" /> {tr("合作方案", "Pricing")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tr(
              "首月免費試用，之後每月 NT$1,999，沒有其他上架或抽成費用。到期前平台會主動聯絡您確認續約。",
              "The first month is free. After that it's NT$1,999 / month, with no other listing fees or commission. We'll reach out to confirm renewal before your trial ends."
            )}
          </p>
        </section>

        <section className="text-center space-y-3">
          <h2 className="text-lg font-bold">{tr("準備好了嗎？", "Ready to get started?")}</h2>
          <p className="text-sm text-muted-foreground">
            {tr("申請只要留下店名、聯絡方式與帳號，審核通過後就能使用商家後台。", "Just leave your store name and contact details — once approved, you'll get access to the vendor portal.")}
          </p>
          <Button onClick={() => navigate("/login")} className="mt-1">
            {tr("前往廠商申請", "Apply as a vendor")}
          </Button>
        </section>
      </div>
    </CustomerLayout>
  );
}
