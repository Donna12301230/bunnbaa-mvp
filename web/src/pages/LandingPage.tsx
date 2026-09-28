import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import {
  ArrowRight, BellRing, CakeSlice, CalendarClock, ChevronLeft, ChevronRight, Clock, Coffee,
  CookingPot, Croissant, Info, Mail, MapPin, Repeat, Salad, Sandwich, ShieldCheck, Soup,
  Sparkle, Star, Store, Ticket,
} from "lucide-react";
import {
  AnimatedNumber, Badge, Button, IconBox, Input, Tabs, ToastProvider, useToast,
} from "@/components/ds";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { db } from "@/lib/firebase";
import type { MenuItem, Vendor } from "@/types";
import { EARLY_BIRD_TIERS } from "@/lib/pricing";
import { useReviews } from "@/hooks/useReviews";
import { slotLabel, vendorWindows } from "@/lib/pickupSlots";
import "./LandingPage.css";
import { useI18n, type Lang, loc } from "@/lib/i18n";
import { useVendors } from "@/hooks/useVendors";

/**
 * 品牌形象頁（#/landing）
 * 版面結構參考 cafen-wbs.framer.website，視覺一律使用 BunnBaa 設計系統（tokens + @/components/ds）。
 * 沒有實拍照片，照片位置以品牌色漸層 + 線條 icon 代替；之後有素材可直接換成 <img>。
 */

// 頁尾連結用（頂部導覽列改用全站共用的 MarketplaceHeader）
// 中英並排的固定文案（行銷文字，不是資料），依 lang 挑
type Bi = { zh: string; en: string };
const pick = (text: Bi, lang: Lang) => text[lang];

const NAV: { href: string; label: Bi }[] = [
  { href: "/landing", label: { zh: "首頁", en: "Home" } },
  { href: "/home", label: { zh: "今日菜單", en: "Today's menu" } },
  { href: "/vendors", label: { zh: "合作店家", en: "Partner vendors" } },
  { href: "/marketplace", label: { zh: "轉讓市集", en: "Transfers" } },
  { href: "/my-locks", label: { zh: "我的餐點", en: "My meals" } },
];

const TICKER: Bi[] = [
  { zh: "提前 14 天預約，最高 7 折", en: "Book 14 days ahead for up to 30% off" },
  { zh: "臨時去不了？轉讓給同學，全額入袋", en: "Can't make it? Transfer your meal to a classmate" },
  { zh: "店家未出餐，全額退款再送 20 點", en: "Vendor didn't serve? Full refund plus 20 points" },
  { zh: "取餐前推播提醒，不怕忘記", en: "Push reminders before pickup" },
  { zh: "合作店家成長獎勵，有機會抽中 0 元", en: "Growth rewards: win a free meal" },
];

const FEATURES: { icon: ReactNode; title: Bi; body: Bi }[] = [
  { icon: <CalendarClock />, title: { zh: "越早訂越便宜", en: "Book early, pay less" }, body: { zh: "今天訂明天 95 折，提前 2–13 天 8 折，提前 14–30 天 7 折。", en: "5% off for tomorrow, 20% off 2–13 days ahead, 30% off 14–30 days ahead." } },
  { icon: <Repeat />, title: { zh: "去不了也不浪費", en: "Nothing goes to waste" }, body: { zh: "鎖定的餐點可轉讓給同學；逾時沒人接手，自動開放 $0 領取。", en: "Transfer a locked meal to a classmate; if nobody takes it in time, anyone can claim it for $0." } },
  { icon: <ShieldCheck />, title: { zh: "履約有保障", en: "Guaranteed fulfilment" }, body: { zh: "店家若未如期出餐，全額退款並加贈 20 點回饋金。", en: "If the vendor doesn't serve on time, you get a full refund plus 20 reward points." } },
  { icon: <BellRing />, title: { zh: "準時提醒取餐", en: "Pickup reminders" }, body: { zh: "取餐時段開始前推播通知，排隊時間留給自己。", en: "Get a push notification before your pickup window starts — no more queuing." } },
];

// 早鳥最高折扣（提前 14–30 天），跟 lib/pricing 同一套級距與四捨五入
const BEST_EARLY_BIRD = Math.max(...EARLY_BIRD_TIERS.map((t) => t.discountPercent));
const earlyBird = (price: number) => Math.round(price * (1 - BEST_EARLY_BIRD / 100));
const MENU_TAB_LIMIT = 5;
const MENU_ITEMS_PER_TAB = 4;

// 最早可提前預約天數＝早鳥級距的最大天數（lib/pricing）
const MAX_ADVANCE_DAYS = Math.max(...EARLY_BIRD_TIERS.map((t) => t.maxDays));

// 近期活動讀 landing_events（管理員在 Firestore 維護），icon 存成字串 key
const EVENT_ICONS: Record<string, ReactNode> = {
  sparkle: <Sparkle />,
  calendar: <CalendarClock />,
  repeat: <Repeat />,
  store: <Store />,
  ticket: <Ticket />,
  bell: <BellRing />,
};

interface LandingEvent {
  id: string;
  date_label: string;
  title: string;
  body: string;
  // 英文版文案（選填，沒有就顯示中文）
  date_label_en?: string;
  title_en?: string;
  body_en?: string;
  href: string;
  icon?: string;
  sort_order?: number;
  active?: boolean;
}

const GALLERY: { shape: "arch" | "circle" | "rounded"; icon: ReactNode }[] = [
  { shape: "rounded", icon: <Soup /> },
  { shape: "circle", icon: <Coffee /> },
  { shape: "arch", icon: <Croissant /> },
  { shape: "rounded", icon: <CakeSlice /> },
  { shape: "circle", icon: <Salad /> },
  { shape: "arch", icon: <Sandwich /> },
];

// 同學評價：讀 reviews 裡有公開心得、4 星以上的最近幾則
const REVIEW_LIMIT = 5;


/** 進入視窗才觸發的數字滾動（AnimatedNumber 從 0 滾到目標值）。 */
function StatNumber({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setShown(value);
        io.disconnect();
      }
    }, { threshold: 0.4 });
    io.observe(el);
    return () => io.disconnect();
  }, [value]);
  return (
    <span ref={ref} className="lp-stat__num">
      <AnimatedNumber value={shown} suffix={suffix} duration={900} />
    </span>
  );
}

/** 水平捲動列 + 左右按鈕。 */
function useScroller() {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: "smooth" });
  };
  return { ref, scroll };
}

function LinkButton({ href, variant = "primary", size = "md", children, rightIcon }: {
  href: string; variant?: "primary" | "secondary" | "outline"; size?: "sm" | "md" | "lg"; children: ReactNode; rightIcon?: ReactNode;
}) {
  return (
    <Link href={href} className={`bb-btn bb-btn--${variant} bb-btn--${size} lp-pill`}>
      <span className="bb-btn__label">{children}</span>
      {rightIcon && <span className="bb-btn__icon" aria-hidden="true">{rightIcon}</span>}
    </Link>
  );
}

function SectionTitle({ children, center = false }: { children: ReactNode; center?: boolean }) {
  return <h2 className={`lp-h2${center ? " lp-center" : ""}`}>{children}</h2>;
}

function Newsletter() {
  const { toast } = useToast();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t("請輸入有效的 Email", "Please enter a valid email"));
      return;
    }
    setError(undefined);
    // 尚未串接電子報後端，先誠實告知
    toast({ tone: "info", title: t("電子報即將開放", "Newsletter coming soon"), description: t("目前可先登入並開啟推播，第一時間收到優惠通知。", "Sign in and turn on push notifications to hear about deals first.") });
    setEmail("");
  }
  return (
    <section className="lp-section lp-newsletter" aria-labelledby="lp-newsletter-title">
      <IconBox size="lg"><Mail /></IconBox>
      <h2 id="lp-newsletter-title" className="lp-h3 lp-center">{t("訂閱新菜單與早鳥優惠", "Get new menus and early-bird deals")}<br />{t("好康不漏接", "straight to your inbox")}</h2>
      <form className="lp-newsletter__form" onSubmit={onSubmit} noValidate>
        <Input
          aria-label="Email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={error}
          containerClassName="lp-newsletter__input"
        />
        <Button type="submit" className="lp-pill">{t("立即訂閱", "Subscribe")}</Button>
      </form>
    </section>
  );
}

function LandingContent() {
  const { t, lang, isEn } = useI18n();
  // 招牌餐點：真實 menu_items（上架中），依 category 分頁，品項最多的分類排前面
  const { data: menuItems = [] } = useQuery({
    queryKey: ["landingMenu"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "menu_items"), where("is_available", "==", true)));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as MenuItem);
    },
    staleTime: 15 * 60 * 1000,
  });
  const menuByCategory = new Map<string, MenuItem[]>();
  for (const item of menuItems) {
    const key = item.category || t("其他", "Other");
    menuByCategory.set(key, [...(menuByCategory.get(key) ?? []), item]);
  }
  const menuTabs = [...menuByCategory.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, MENU_TAB_LIMIT)
    .map(([category, items], i) => ({ value: `c${i}`, key: category, label: loc(items[0], "category") || category }));
  const [tabState, setTab] = useState("c0");
  const tab = menuTabs.some((t) => t.value === tabState) ? tabState : "c0";
  const tabDishes = menuByCategory.get(menuTabs.find((t) => t.value === tab)?.key ?? "")?.slice(0, MENU_ITEMS_PER_TAB) ?? [];
  const events = useScroller();
  const [review, setReview] = useState(0);

  // 合作店家：真實 vendors（與首頁共用 queryKey），取前 3 間
  const { data: vendors = [], isLoading: vendorsLoading } = useVendors();

  const { data: landingEvents = [] } = useQuery({
    queryKey: ["landingEvents"],
    queryFn: async () => {
      const snap = await getDocs(query(collection(db, "landing_events"), orderBy("sort_order")));
      return snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as LandingEvent)
        .filter((e) => e.active !== false);
    },
    staleTime: 15 * 60 * 1000,
  });

  // 頁尾取餐時段：所有合作店家設定的時段聯集（商家後台店家設定頁維護）
  const pickupWindows = [...new Set(vendors.flatMap((v) => vendorWindows(v)))].sort();

  const { data: allReviews = [] } = useReviews();
  const reviews = allReviews.filter((x) => x.comment.trim() && x.rating >= 4).slice(0, REVIEW_LIMIT);
  const r = reviews.length > 0 ? reviews[review % reviews.length] : null;

  const heroItem = menuItems[0];
  const heroVendor = heroItem ? vendors.find((v) => v.id === heroItem.vendor_id) : undefined;
  const heroWindow = heroVendor ? vendorWindows(heroVendor)[0] : undefined;

  return (
    <div className="bb-landing">
      {/* ── Header：沿用全站共用導覽列 ── */}
      <MarketplaceHeader active="landing" />

      <main>
        {/* ── Hero ── */}
        {/* 範例票券用第一道真實上架餐點，沒有餐點時不顯示票券 */}
        <section className="lp-container lp-hero">
          <h1 className="lp-display">{t("越早訂，越開心。", "Book early, eat happy.")}<br />{t("每一口都準時開飯", "Every meal, right on time")}</h1>
          <p className="lp-lead">{t(`提前預付鎖定學校附近的好店午餐，享最高 ${(100 - BEST_EARLY_BIRD) / 10} 折早鳥價；時間到直接取餐，不用排隊。`, `Prepay and lock in lunch from great spots near campus with up to ${BEST_EARLY_BIRD}% early-bird savings — then just pick it up, no queue.`)}</p>
          <div className="lp-hero__cta">
            <LinkButton href="/home" variant="secondary" size="lg" rightIcon={<ArrowRight />}>{t("探索今日菜單", "Explore today's menu")}</LinkButton>
          </div>

          <div className="lp-hero__visual" aria-hidden="true">
            <div className="lp-hero__glow" />
            {heroItem && (
              <div className="lp-ticket">
                <div className="lp-ticket__top">
                  <span className="lp-ticket__thumb"><CookingPot /></span>
                  <div>
                    <p className="lp-ticket__name">{loc(heroItem, "name")}</p>
                    <p className="lp-ticket__meta">{[loc(heroVendor, "name"), heroWindow && slotLabel(heroWindow)].filter(Boolean).join("・")}</p>
                  </div>
                  <Badge tone="success" dot>{t("已鎖定", "Locked")}</Badge>
                </div>
                <div className="lp-ticket__price">
                  <span className="lp-strike">NT$ {heroItem.price}</span>
                  <span className="lp-ticket__now">NT$ {earlyBird(heroItem.price)}</span>
                  <Badge tone="brand" variant="solid" shape="pill">{t(`早鳥 ${(100 - BEST_EARLY_BIRD) / 10} 折`, `Early bird −${BEST_EARLY_BIRD}%`)}</Badge>
                </div>
              </div>
            )}
            <div className="lp-float lp-float--a"><Ticket /> {t("可轉讓給同學", "Transferable to classmates")}</div>
            <div className="lp-float lp-float--b"><BellRing /> {t("取餐前推播提醒", "Pickup reminder")}</div>
            <div className="lp-float lp-float--c"><ShieldCheck /> {t("未出餐全額退", "Full refund if not served")}</div>
          </div>
        </section>

        {/* ── 品牌故事 ── */}
        <section className="lp-story" aria-labelledby="lp-story-title">
          <div className="lp-container lp-story__inner">
            <img src="/飯飽R.png" alt="" className="lp-story__mark" width={72} height={64} />
            {isEn ? (
              <p id="lp-story-title" className="lp-story__statement">
                BunnBaa started with a simple idea: everyone should get to{" "}
                <span className="lp-nowrap"><span className="lp-story__pill">eat on time</span>,</span>{" "}
                and vendors should never have to guess how much to prep.
              </p>
            ) : (
              <p id="lp-story-title" className="lp-story__statement">
                BunnBaa 從一個簡單的念頭開始：讓每個人都能
                <span className="lp-nowrap"><span className="lp-story__pill">準時吃飽</span>，</span>
                也讓店家不再猜今天要備幾份。
              </p>
            )}
            <p className="lp-story__body">
              {t("學生提前預約、店家提前備餐，剩下的交給轉讓市集——不排隊、不浪費，把午休還給自己。", "Students book ahead, vendors prep ahead, and the transfer market handles the rest — no queues, no waste, and your lunch break back.")}
            </p>
          </div>
        </section>

        {/* ── 跑馬燈 ── */}
        <div className="lp-ticker" aria-label={t("最新消息", "Latest news")}>
          <div className="lp-ticker__track">
            {[...TICKER, ...TICKER].map((item, i) => (
              <span key={i} className="lp-ticker__item" aria-hidden={i >= TICKER.length || undefined}>
                <Sparkle className="lp-ticker__star" aria-hidden="true" /> {pick(item, lang)}
              </span>
            ))}
          </div>
        </div>

        {/* ── 特色 ── */}
        <section className="lp-section lp-container lp-features" aria-labelledby="lp-features-title">
          <div className="lp-features__visual" aria-hidden="true">
            <img src="/飯飽R.png" alt="" />
          </div>
          <div className="lp-features__body">
            <h2 id="lp-features-title" className="lp-h2">{t("BunnBaa 有什麼不一樣", "What makes BunnBaa different")}</h2>
            <ul className="lp-features__grid">
              {FEATURES.map((f) => (
                <li key={f.title.zh}>
                  <IconBox size="lg">{f.icon}</IconBox>
                  <h3 className="lp-h4">{pick(f.title, lang)}</h3>
                  <p className="lp-muted">{pick(f.body, lang)}</p>
                </li>
              ))}
            </ul>
            <div className="lp-features__cta">
              <LinkButton href="/home">{t("開始預約", "Start booking")}</LinkButton>
              <p className="lp-note"><Info aria-hidden="true" /> {t("全額預付、不可退款，但可轉讓過戶。", "Fully prepaid and non-refundable, but transferable.")}</p>
            </div>
          </div>
        </section>

        {/* ── 菜單 ── */}
        <section className="lp-section" aria-labelledby="lp-menu-title">
          <div className="lp-menu">
            <IconBox size="lg" className="lp-center-block"><Soup /></IconBox>
            <h2 id="lp-menu-title" className="lp-h2 lp-center">{t("大家最愛的招牌餐點", "Crowd favourites")}</h2>
            {menuTabs.length > 0 && (
              <div className="lp-menu__tabs">
                <Tabs items={menuTabs} value={tab} onValueChange={setTab} idPrefix="lp-menu" aria-label={t("餐點分類", "Menu categories")} />
              </div>
            )}
            <ul
              className="lp-menu__list"
              role="tabpanel"
              id={`lp-menu-panel-${tab}`}
              aria-labelledby={`lp-menu-tab-${tab}`}
            >
              {tabDishes.map((m) => (
                <li key={m.id} className="lp-dish">
                  <span className="lp-dish__thumb" aria-hidden="true">
                    {m.image ? <img src={m.image} alt="" style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit" }} /> : <Soup />}
                  </span>
                  <div className="lp-dish__text">
                    <h3 className="lp-h4">{loc(m, "name")}</h3>
                    <p className="lp-muted">{loc(m, "description")}</p>
                  </div>
                  <div className="lp-dish__price">
                    <span className="lp-strike">${m.price}</span>
                    <strong>${earlyBird(m.price)}</strong>
                  </div>
                </li>
              ))}
            </ul>
            {menuItems.length === 0 && <p className="lp-muted lp-center">{t("合作店家的餐點即將上架。", "Partner menus are coming soon.")}</p>}
            <p className="lp-note lp-center">{t(`價格為提前 14–${MAX_ADVANCE_DAYS} 天的早鳥 ${(100 - BEST_EARLY_BIRD) / 10} 折價；實際品項與價格以各店家菜單為準。`, `Prices shown are the ${BEST_EARLY_BIRD}% early-bird price for booking 14–${MAX_ADVANCE_DAYS} days ahead; see each vendor's menu for actual items and prices.`)}</p>
          </div>
        </section>

        {/* ── 活動 ── */}
        <section className="lp-section" aria-labelledby="lp-events-title">
          <div className="lp-container lp-row-head">
            <SectionTitle><span id="lp-events-title">{t("BunnBaa 近期活動", "What's on at BunnBaa")}</span></SectionTitle>
            <div className="lp-arrows">
              <Button variant="outline" iconOnly aria-label={t("上一個活動", "Previous event")} className="lp-round" onClick={() => events.scroll(-1)}><ChevronLeft /></Button>
              <Button variant="outline" iconOnly aria-label={t("下一個活動", "Next event")} className="lp-round" onClick={() => events.scroll(1)}><ChevronRight /></Button>
            </div>
          </div>
          <div className="lp-scroller" ref={events.ref}>
            {landingEvents.map((e) => (
              <article key={e.id} className="lp-event">
                <div className="lp-event__body">
                  <p className="lp-caption">{(isEn && e.date_label_en) || e.date_label}</p>
                  <h3 className="lp-h3">{(isEn && e.title_en) || e.title}</h3>
                  <p className="lp-muted">{(isEn && e.body_en) || e.body}</p>
                  <LinkButton href={e.href} variant="secondary" size="sm" rightIcon={<ArrowRight />}>{t("查看活動", "Learn more")}</LinkButton>
                </div>
                <div className="lp-event__visual" aria-hidden="true">{EVENT_ICONS[e.icon ?? ""] ?? <Sparkle />}</div>
              </article>
            ))}
          </div>

          <dl className="lp-container lp-stats">
            <div className="lp-stat"><dt>{t("早鳥折扣最高", "Max early-bird discount")}</dt><dd>{isEn ? <StatNumber value={BEST_EARLY_BIRD} suffix="% off" /> : <StatNumber value={(100 - BEST_EARLY_BIRD) / 10} suffix=" 折" />}</dd></div>
            <div className="lp-stat"><dt>{t("未出餐加贈回饋金", "Bonus if not served")}</dt><dd><StatNumber value={20} suffix={t(" 點", " pts")} /></dd></div>
            <div className="lp-stat"><dt>{t("最早可提前預約", "Book up to")}</dt><dd><StatNumber value={MAX_ADVANCE_DAYS} suffix={t(" 天", " days")} /></dd></div>
          </dl>
        </section>

        {/* ── 圖片牆（跑馬燈） ── */}
        <div className="lp-gallery" aria-hidden="true">
          <div className="lp-gallery__track">
            {[...GALLERY, ...GALLERY].map((g, i) => (
              <span key={i} className={`lp-shape lp-shape--${g.shape} lp-shape--t${i % 3}`}>{g.icon}</span>
            ))}
          </div>
        </div>

        {/* ── 評價（沒有公開評價時整段不顯示） ── */}
        {r && (
          <section className="lp-section lp-container lp-reviews" aria-labelledby="lp-reviews-title" aria-roledescription={t("輪播", "carousel")}>
            <h2 id="lp-reviews-title" className="sr-only">{t("使用者評價", "Reviews")}</h2>
            <div className="lp-stars" aria-label={t(`${r.rating} 顆星`, `${r.rating} stars`)}>
              {Array.from({ length: r.rating }, (_, i) => <Star key={i} aria-hidden="true" />)}
            </div>
            <div className="lp-reviews__row">
              <Button variant="outline" iconOnly aria-label={t("上一則評價", "Previous review")} className="lp-round" disabled={reviews.length < 2} onClick={() => setReview((review + reviews.length - 1) % reviews.length)}><ChevronLeft /></Button>
              <figure className="lp-quote" aria-live="polite">
                <blockquote>{loc(r, "comment")}</blockquote>
                <figcaption>
                  <strong>{loc(r, "reviewer_label")}</strong>
                  <span>{[loc(vendors.find((v) => v.id === r.vendor_id), "name"), loc(r, "item_name")].filter(Boolean).join("・")}</span>
                </figcaption>
              </figure>
              <Button variant="outline" iconOnly aria-label={t("下一則評價", "Next review")} className="lp-round" disabled={reviews.length < 2} onClick={() => setReview((review + 1) % reviews.length)}><ChevronRight /></Button>
            </div>
          </section>
        )}

        {/* ── 合作店家 ── */}
        <section className="lp-section lp-container" aria-labelledby="lp-stores-title">
          <h2 id="lp-stores-title" className="lp-h2 lp-center">{t("找到你附近的合作店家", "Find partner vendors near you")}</h2>
          <div className="lp-stores">
            {vendorsLoading && Array.from({ length: 3 }, (_, i) => <div key={i} className="lp-store lp-store--skeleton" />)}
            {!vendorsLoading && vendors.slice(0, 3).map((v) => (
              <article key={v.id} className="lp-store">
                <div className="lp-store__visual" aria-hidden="true"><Store /></div>
                <h3 className="lp-h3">{loc(v, "name")}</h3>
                {v.address && <p className="lp-muted lp-store__addr"><MapPin aria-hidden="true" />{v.address}</p>}
                <div className="lp-store__foot">
                  {v.verified ? <Badge tone="success" size="sm">{t("認證商家", "Verified")}</Badge> : <span />}
                  <LinkButton href={`/vendor/${v.id}`} variant="secondary" size="sm" rightIcon={<ArrowRight />}>{t("查看店家", "View vendor")}</LinkButton>
                </div>
              </article>
            ))}
          </div>
          {!vendorsLoading && vendors.length === 0 && (
            <p className="lp-muted lp-center">{t("合作店家陸續上線中，", "More partner vendors are joining soon — ")}<Link href="/vendors" className="lp-link">{t("查看店家列表", "see the vendor list")}</Link>{t("。", ".")}</p>
          )}
        </section>

        <Newsletter />
      </main>

      {/* ── Footer ── */}
      <footer className="lp-container lp-footer">
        <div className="lp-footer__info">
          <Link href="/landing" className="lp-logo" aria-label={t("BunnBaa 飯飽 首頁", "BunnBaa home")}>
            <img src="/飯飽R.png" alt="" width={44} height={39} />
            <span className="lp-logo__word"><span className="lp-logo__bunn">Bunn</span><span className="lp-logo__baa">Baa</span></span>
          </Link>
          <div>
            <h2 className="lp-h4"><Clock aria-hidden="true" className="lp-inline-icon" /> {t("取餐時段", "Pickup times")}</h2>
            <ul className="lp-muted lp-footer__hours">
              {pickupWindows.map((t) => <li key={t}>{slotLabel(t)}</li>)}
              <li>{t("實際時段與公休日依各店家設定。", "Actual times and closing days are set by each vendor.")}</li>
            </ul>
          </div>
          <p className="lp-caption">© {new Date().getFullYear()} {t("BunnBaa 飯飽・越早訂，越開心。", "BunnBaa · Book early, eat happy.")}</p>
        </div>
        <nav className="lp-footer__links" aria-label={t("頁尾連結", "Footer links")}>
          <h2 className="lp-h4">{t("頁面連結", "Pages")}</h2>
          <ul>
            {[
              ...NAV,
              { href: "/cart", label: { zh: "購物車", en: "Cart" } },
              { href: "/profile", label: { zh: "會員資料", en: "My account" } },
              { href: "/login", label: { zh: "登入／註冊", en: "Sign in / Sign up" } },
              { href: "/vendor-portal/dashboard", label: { zh: "商家後台", en: "Vendor portal" } },
            ].map((n) => (
              <li key={n.href}><Link href={n.href} className={n.href === "/landing" ? "is-active" : undefined}>{pick(n.label, lang)}</Link></li>
            ))}
          </ul>
        </nav>
      </footer>
    </div>
  );
}

export default function LandingPage() {
  return (
    <ToastProvider>
      <LandingContent />
    </ToastProvider>
  );
}
