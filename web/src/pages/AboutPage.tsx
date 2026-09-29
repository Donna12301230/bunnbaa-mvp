import { tr } from "@/lib/i18n";
import { CalendarClock, HeartHandshake, Recycle, ShieldCheck, Sparkles } from "lucide-react";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";

const VALUES = [
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
      "提前 1～30 天鎖定餐點，最高可享 7 折，排隊時間也留給自己。",
      "Lock in a meal 1–30 days ahead for up to 30% off, and skip the lunch-hour queue."
    ),
  },
  {
    icon: ShieldCheck,
    title: tr("履約有保障", "Guaranteed fulfilment"),
    body: tr(
      "店家若未如期出餐，全額退款並加贈回饋金；去不了也能轉讓給同學。",
      "If a vendor doesn't serve on time you get a full refund plus bonus points; can't make it? Transfer the meal to a classmate."
    ),
  },
];

// 靜態行銷內容頁，沒有資料庫欄位可讀，文案直接寫在元件裡。
export default function AboutPage() {
  return (
    <CustomerLayout
      active={undefined}
      hero={<PageHero title={tr("關於我們", "About us")} description={tr("飯飽 BunnBaa，讓每一餐都準時、划算、不浪費。", "BunnBaa — every meal on time, at a better price, with nothing wasted.")} />}
    >
      <div className="max-w-3xl mx-auto space-y-10">
        <section className="space-y-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-orange-500" /> {tr("我們的故事", "Our story")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tr(
              "飯飽 BunnBaa 由赫滋與羊國際藝術有限公司開發，起點是校園裡常見的畫面：中午排隊排到教室外、熱門餐點賣完撲空，店家則常常猜不準今天該備多少料，猜多了報廢、猜少了讓客人失望。我們想做的，是讓學生提前鎖定想吃的那一份，店家也能照實際訂單準備，兩邊都少一點浪費、多一點確定。",
              "BunnBaa was built by Herz & Baa International Arts Co., Ltd. around a familiar campus scene: lunch queues spilling out the door, popular dishes selling out, and vendors guessing how much to prep — too much becomes waste, too little means disappointed customers. We wanted students to lock in the meal they want ahead of time, and vendors to prep against real orders instead of guesswork — less waste, more certainty, for everyone."
            )}
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold flex items-center gap-2">
            <HeartHandshake className="w-5 h-5 text-orange-500" /> {tr("我們的使命", "Our mission")}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {tr(
              "讓預購變成日常習慣：早一點下單、店家早一點安心備料、大家都吃得到、也吃得剛好。",
              "Make pre-ordering the everyday habit: order a little earlier, let vendors prep with confidence, and make sure everyone gets fed — with just the right amount made."
            )}
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-lg font-bold">{tr("我們在意的三件事", "What we care about")}</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {VALUES.map(({ icon: Icon, title, body }) => (
              <div key={title} className="bg-white rounded-xl border border-border p-4">
                <Icon className="w-6 h-6 text-orange-500 mb-2" />
                <h3 className="font-semibold text-sm mb-1">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </CustomerLayout>
  );
}
