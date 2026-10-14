import { tr } from "@/lib/i18n";
import { liveConfig } from "@/lib/platformConfig";
import { policy } from "@/lib/policy";
import { BellRing, CalendarClock, HeartHandshake, Recycle, ShieldCheck, Sparkles } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import Reveal from "@/components/Reveal";

// A function so rule numbers are read from platform settings (lib/policy.ts) and regenerated when the language switches
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const values = () => [
  {
    icon: Recycle,
    title: tr("減少剩食", "Less food waste"),
    body: tr(
      "店家依實際預購量準備餐點，不用憑經驗多做，賣不完的損耗直接減少。",
      "Vendors prepare food based on actual pre-orders instead of guesswork, cutting down on unsold waste."
    ),
  },
  {
    icon: CalendarClock,
    title: tr("越早訂越划算", "Book early, save more"),
    body: tr(
      `${policy.cutoff()}，${policy.bookingRange()}；${policy.earlyBird()}；店家依確定訂單備料，不浪費。`,
      `${cap(policy.cutoff())}; ${policy.bookingRange()} — ${policy.earlyBird()}. Vendors prep only what's ordered.`
    ),
  },
  {
    icon: ShieldCheck,
    title: tr("履約有保障", "Guaranteed fulfilment"),
    body: tr(
      `${policy.cancelShort()}；去不了也可以轉讓、請朋友代領或捐為愛心餐。停班停課時當天訂單自動取消、全額退成平台點數；每累計 ${liveConfig().ticketUnit} 元一張抽獎券。`,
      `${cap(policy.cancelShort())}, or transfer, send a friend, or donate if you can't make it. On work-suspension days orders are cancelled and fully refunded as points; every NT$${liveConfig().ticketUnit} you pay earns a draw ticket.`
    ),
  },
  {
    icon: BellRing,
    title: tr("準時提醒取餐", "Pickup reminders"),
    body: tr(
      `取餐時段結束前 30 分鐘還沒取，會推播提醒你；結束 ${liveConfig().charityConvertAfterMinutes} 分鐘後仍未取餐就轉給需要的人，不會白白浪費。`,
      `If you haven't picked up 30 minutes before your window ends, we'll send a reminder; ${liveConfig().charityConvertAfterMinutes} minutes after it ends, an unclaimed meal goes to someone who needs it.`
    ),
  },
];

// Static marketing page with no database fields to read; the copy lives in the component.
// 2026-10-01 redesign: editorial layout, the story in two columns plus a large pull quote, values as a numbered list.
export default function AboutPage() {
  return (
    <CustomerLayout
      active={null}
      hero={<PageHero eyebrow={tr("關於 BunnBaa", "About BunnBaa")} title={tr("關於我們", "About us")} description={tr("飯飽 BunnBaa，讓每一餐都準時、划算、不浪費。", "BunnBaa — every meal on time, at a better price, with nothing wasted.")} />}
    >
      <div className="space-y-20 md:space-y-28 py-4 md:py-8">
        <Reveal>
          <section className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:gap-16 items-start">
            <h2 className="font-heading text-3xl md:text-5xl font-semibold leading-[1.15] flex items-start gap-3">
              <Sparkles className="w-7 h-7 md:w-9 md:h-9 text-primary shrink-0 mt-1" aria-hidden="true" /> {tr("我們的故事", "Our story")}
            </h2>
            <p className="text-base md:text-lg text-muted-foreground leading-[1.9]">
              {tr(
                "飯飽 BunnBaa 由赫滋與羊國際藝術有限公司開發，起點是校園裡常見的畫面：中午排隊排到教室外、熱門餐點賣完撲空，店家則常常猜不準今天該備多少料，猜多了報廢、猜少了讓客人失望。我們想做的，是讓學生提前鎖定想吃的那一份，店家也能照實際訂單準備，兩邊都少一點浪費、多一點確定。",
                "BunnBaa was built by Herz & Baa International Arts Co., Ltd. around a familiar campus scene: lunch queues spilling out the door, popular dishes selling out, and vendors guessing how much to prep — too much becomes waste, too little means disappointed customers. We wanted students to lock in the meal they want ahead of time, and vendors to prep against real orders instead of guesswork — less waste, more certainty, for everyone."
              )}
            </p>
          </section>
        </Reveal>

        {/* Mission: dark brown with a large pull quote */}
        <Reveal>
          <section className="rounded-card md:rounded-[3rem] bg-[var(--surface-inverse)] text-[var(--text-on-inverse)] px-6 py-14 md:px-16 md:py-24">
            <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] uppercase opacity-80 mb-6">
              <HeartHandshake className="w-4 h-4" aria-hidden="true" /> {tr("我們的使命", "Our mission")}
            </p>
            <h2 className="sr-only">{tr("我們的使命", "Our mission")}</h2>
            <blockquote className="font-heading text-[clamp(28px,4.4vw,60px)] font-semibold leading-[1.25] tracking-[-0.01em] max-w-5xl text-balance">
              {tr(
                "讓預購變成日常習慣：早一點下單、店家早一點安心備料、大家都吃得到、也吃得剛好。",
                "Make pre-ordering the everyday habit: order a little earlier, let vendors prep with confidence, and make sure everyone gets fed — with just the right amount made."
              )}
            </blockquote>
          </section>
        </Reveal>

        <section>
          <Reveal><h2 className="font-heading text-3xl md:text-5xl font-semibold mb-10">{tr("我們在意的事", "What we care about")}</h2></Reveal>
          <ol className="grid gap-x-12 md:grid-cols-2 border-t border-ink">
            {values().map(({ icon: Icon, title, body }, i) => (
              <li key={title} className="border-b border-ink">
                <Reveal delay={i * 90} className="flex gap-5 py-8 h-full">
                  <span className="font-heading italic text-primary text-lg w-8 shrink-0" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <div className="space-y-2">
                    <h3 className="font-heading text-2xl font-semibold flex items-center gap-2.5">
                      <Icon className="w-6 h-6 text-primary" aria-hidden="true" /> {title}
                    </h3>
                    <p className="text-muted-foreground leading-relaxed">{body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </CustomerLayout>
  );
}
