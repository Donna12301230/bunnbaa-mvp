import { tr } from "@/lib/i18n";
import { liveConfig } from "@/lib/platformConfig";
import { policy } from "@/lib/policy";
import { Plus } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { Link } from "wouter";

// Rule numbers always come from lib/policy.ts (platform settings); written as a function so it is regenerated when the language switches
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const faqs = () => {
  const c = liveConfig();
  return [
    {
      q: tr("要怎麼預購餐點？", "How do I pre-order a meal?"),
      a: tr(
        `在「預購餐點」選早餐／午餐／晚餐與單點或方案，點便當後在價格日期列選取餐日（${policy.bookingRange()}），點圖片選主菜、配菜（候選菜點了就是許願）與飯量，加入購物車後用 LINE Pay 結帳（有平台點數可以先折抵）。${policy.cutoff()}，截單前可以修改。`,
        `Go to Pre-order, pick a meal and a bento, then choose the pickup day (${policy.bookingRange()}), main, sides (tapping a candidate is a wish) and rice. Check out with LINE Pay (BunnBaa points are applied first if you have any). ${cap(policy.cutoff())}; you can change your order until then.`
      ),
    },
    {
      q: tr("早鳥折扣怎麼算？", "How does the early-bird discount work?"),
      a: tr(
        `越早訂，越開心：${policy.earlyBird()}（${policy.bookingRange()}）。白飯一碗半 +${c.riceAddPrice}、半碗 ${c.riceLessPrice}、配菜少一道 ${c.slotRemovePrice}、第四道加菜 +${c.addonSidePrice}（設為備案不加價），直接反映在金額上。`,
        `Book early, save more: ${policy.earlyBird()} (${policy.bookingRange()}). 1.5 bowls of rice +${c.riceAddPrice}, half a bowl ${c.riceLessPrice}, one fewer side ${c.slotRemovePrice}, a 4th add-on side +${c.addonSidePrice} (free as a backup).`
      ),
    },
    {
      q: tr("臨時去不了怎麼辦？", "What if I can't make it after ordering?"),
      a: tr(
        `${policy.cancel()}，到「我的餐點」按「取消換券」。來不及取消的話，可以轉讓、贈送、請朋友代領（給他代領碼），或在取餐當天按「捐為愛心餐」。`,
        `${cap(policy.cancel())} — tap Cancel in My meals. After that you can transfer or gift it, ask a friend to pick it up (give them your proxy code), or donate it as a charity meal on the day.`
      ),
    },
    {
      q: tr("沒去取餐會怎樣？", "What happens if I don't show up to pick up my order?"),
      a: tr(`${policy.noShow()}，開放給需要的人領取。`, `${cap(policy.noShow())}, open to people in need.`),
    },
    {
      q: tr("退款會退到哪裡？", "Where do refunds go?"),
      a: tr(`${policy.refunds()}。`, `${cap(policy.refunds())}.`),
    },
    {
      q: tr("店家沒有出餐怎麼辦？", "What if the vendor doesn't serve my order?"),
      a: tr(`${policy.vendorFailed()}。${policy.disaster()}。`, `${cap(policy.vendorFailed())}. ${cap(policy.disaster())}.`),
    },
    {
      q: tr("可以用什麼方式付款？", "What payment methods are supported?"),
      a: tr(
        "透過 LINE Pay 付款，結帳時會導到 LINE Pay 完成付款再回到平台；有平台點數的話可以先折抵，全額折抵就不用經過 LINE Pay。",
        "Payment is handled through LINE Pay — checkout redirects you there and back. BunnBaa points can be applied first; if they cover everything, LINE Pay is skipped."
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
        "到「加入我們」頁面看合作方式，或直接在登入頁的「店家申請」分頁送出申請，管理員審核通過後就能使用店家後台。",
        "See the Join us page for details, or apply on the Vendor application tab of the sign-in page. Once an admin approves it, you'll get access to the vendor portal."
      ),
    },
  ];
};

export default function FaqPage() {
  return (
    <CustomerLayout
      active={null}
      hero={<PageHero eyebrow={tr("支援", "Support")} title={tr("常見問題", "FAQ")} description={tr("關於預購、取餐、退款最常被問到的問題。", "Answers to the questions we hear most about pre-ordering, pickup, and refunds.")} />}
    >
      {/* Desktop two columns: sticky "Can't find an answer?" on the left, Q&A on the right */}
      <div className="grid gap-10 lg:grid-cols-[320px_1fr] lg:gap-16 items-start py-4 md:py-8">
        <aside className="lg:sticky lg:top-24 rounded-card border border-ink bg-accent p-7 space-y-3">
          <p className="font-heading text-2xl font-semibold">{tr("沒找到你想問的？", "Didn't find your answer?")}</p>
          <p className="text-sm text-muted-foreground">{tr("寫信給我們，通常 1～2 個工作天內回覆。", "Write to us — we usually reply within 1–2 business days.")}</p>
          <Link href="/contact" className="inline-flex items-center h-11 px-5 rounded-full bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary-hover transition-colors">
            {tr("聯絡客服", "Contact support")}
          </Link>
        </aside>

        <div className="border-t border-ink">
          {faqs().map(({ q, a }, i) => (
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
