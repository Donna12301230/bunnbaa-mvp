import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs } from "firebase/firestore";
import {
  ArrowRight, BellRing, CakeSlice, CalendarClock, ChevronLeft, ChevronRight, Clock, Coffee,
  CookingPot, Croissant, Info, Mail, MapPin, Repeat, Salad, Sandwich, ShieldCheck, Soup,
  Sparkle, Star, Store, Ticket, Wheat,
} from "lucide-react";
import {
  AnimatedNumber, Badge, Button, IconBox, Input, Tabs, ToastProvider, useToast,
} from "@/components/ds";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { db } from "@/lib/firebase";
import type { Vendor } from "@/types";
import "./LandingPage.css";

/**
 * 品牌形象頁（#/landing）
 * 版面結構參考 cafen-wbs.framer.website，視覺一律使用 BunnBaa 設計系統（tokens + @/components/ds）。
 * 沒有實拍照片，照片位置以品牌色漸層 + 線條 icon 代替；之後有素材可直接換成 <img>。
 */

// 頁尾連結用（頂部導覽列改用全站共用的 MarketplaceHeader）
const NAV = [
  { href: "/landing", label: "首頁" },
  { href: "/home", label: "今日菜單" },
  { href: "/vendors", label: "合作店家" },
  { href: "/marketplace", label: "轉讓市集" },
  { href: "/my-locks", label: "我的餐點" },
] as const;

const TICKER = [
  "提前 14 天預約，最高 7 折",
  "臨時去不了？轉讓給同學，全額入袋",
  "店家未出餐，全額退款再送 20 點",
  "取餐前推播提醒，不怕忘記",
  "合作店家成長獎勵，有機會抽中 0 元",
];

const FEATURES = [
  { icon: <CalendarClock />, title: "越早訂越便宜", body: "今天訂明天 95 折，提前 2–13 天 8 折，提前 14–30 天 7 折。" },
  { icon: <Repeat />, title: "去不了也不浪費", body: "鎖定的餐點可轉讓給同學；逾時沒人接手，自動開放 $0 領取。" },
  { icon: <ShieldCheck />, title: "履約有保障", body: "店家若未如期出餐，全額退款並加贈 20 點回饋金。" },
  { icon: <BellRing />, title: "準時提醒取餐", body: "取餐時段開始前推播通知，排隊時間留給自己。" },
];

// 示意菜單：分類與品項僅供版面呈現，上線前改接 menu_items
const MENU: Record<string, { name: string; desc: string; price: number; icon: ReactNode; popular?: boolean }[]> = {
  rice: [
    { name: "阿嬤滷肉飯套餐", desc: "手切滷肉、半熟蛋、當日時蔬兩樣。", price: 110, icon: <CookingPot />, popular: true },
    { name: "日式照燒雞腿飯", desc: "去骨雞腿煎到微焦，淋上自製照燒醬。", price: 135, icon: <Soup /> },
    { name: "三杯杏鮑菇燴飯", desc: "九層塔香氣十足的蔬食選擇。", price: 105, icon: <Salad /> },
    { name: "咖哩豬排飯", desc: "慢燉 6 小時的日式咖哩配厚切豬排。", price: 145, icon: <CookingPot /> },
  ],
  noodle: [
    { name: "紅燒牛肉麵", desc: "牛腱與牛筋各半，湯頭濃而不膩。", price: 160, icon: <Soup />, popular: true },
    { name: "麻醬涼麵", desc: "芝麻醬加蒜泥，附一碗味噌湯。", price: 80, icon: <Wheat /> },
    { name: "鍋燒意麵", desc: "蝦、蛤蜊、魚板，熱湯現煮。", price: 95, icon: <Soup /> },
    { name: "蔥油拌麵", desc: "手工細麵拌上酥香蔥油。", price: 70, icon: <Wheat /> },
  ],
  light: [
    { name: "烤雞胸凱薩沙拉", desc: "舒肥雞胸、蘿蔓、帕瑪森起司。", price: 150, icon: <Salad />, popular: true },
    { name: "總匯三明治", desc: "火腿、蛋、起司三層，附薯餅。", price: 85, icon: <Sandwich /> },
    { name: "可頌早午餐盤", desc: "奶油可頌、炒蛋、優格水果杯。", price: 120, icon: <Croissant /> },
    { name: "鮪魚蛋捲餅", desc: "全麥餅皮，份量剛好不負擔。", price: 75, icon: <Sandwich /> },
  ],
  drink: [
    { name: "經典拿鐵", desc: "單一產區咖啡豆配鮮乳。", price: 70, icon: <Coffee />, popular: true },
    { name: "焙茶歐蕾", desc: "焙茶香氣溫潤，微甜。", price: 65, icon: <Coffee /> },
    { name: "手沖單品", desc: "每週輪替產區，詢問店員當週豆單。", price: 90, icon: <Coffee /> },
    { name: "巴斯克乳酪蛋糕", desc: "焦香表面、綿密內餡，每日限量。", price: 95, icon: <CakeSlice /> },
  ],
};

const MENU_TABS = [
  { value: "rice", label: "飯類" },
  { value: "noodle", label: "麵食" },
  { value: "light", label: "輕食" },
  { value: "drink", label: "飲品甜點" },
];

// 提前 14–30 天的早鳥價（與 lib/pricing 的 7 折級距一致），僅做展示
const earlyBird = (price: number) => Math.round(price * 0.7);

const EVENTS = [
  { date: "每月 1 日", title: "成長獎勵抽獎", body: "合作店家營收達標就解鎖，最高抽中整份 0 元。", icon: <Sparkle />, href: "/home" },
  { date: "期中考週", title: "考前便當早鳥加碼", body: "考試週提前預約，讀書不用再排隊買午餐。", icon: <CalendarClock />, href: "/home" },
  { date: "隨時進行", title: "同學轉讓市集", body: "臨時有事？把餐點轉給需要的人，不浪費一份。", icon: <Repeat />, href: "/marketplace" },
  { date: "新店家進駐", title: "合作店家招募中", body: "餐廳、咖啡廳都能加入，提前掌握備餐數量。", icon: <Store />, href: "/vendors" },
];

const GALLERY: { shape: "arch" | "circle" | "rounded"; icon: ReactNode }[] = [
  { shape: "rounded", icon: <Soup /> },
  { shape: "circle", icon: <Coffee /> },
  { shape: "arch", icon: <Croissant /> },
  { shape: "rounded", icon: <CakeSlice /> },
  { shape: "circle", icon: <Salad /> },
  { shape: "arch", icon: <Sandwich /> },
];

// 示意評價：上線前請換成真實使用者回饋
const REVIEWS = [
  { quote: "以前午休一半時間都在排隊，現在前一天鎖好，下課直接拿了就走，還比現場買便宜。", name: "林同學", role: "資管系 大三" },
  { quote: "那天臨時要補課，直接轉讓給室友，錢沒浪費、飯也沒浪費，這個設計真的很貼心。", name: "陳同學", role: "外文系 大二" },
  { quote: "取餐前會收到提醒，對我這種很容易忘記的人超有用。", name: "黃同學", role: "電機所 碩一" },
];

const TIME_SLOTS = ["11:30–12:00", "12:00–12:30", "12:30–13:00"];

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
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("請輸入有效的 Email");
      return;
    }
    setError(undefined);
    // 尚未串接電子報後端，先誠實告知
    toast({ tone: "info", title: "電子報即將開放", description: "目前可先登入並開啟推播，第一時間收到優惠通知。" });
    setEmail("");
  }
  return (
    <section className="lp-section lp-newsletter" aria-labelledby="lp-newsletter-title">
      <IconBox size="lg"><Mail /></IconBox>
      <h2 id="lp-newsletter-title" className="lp-h3 lp-center">訂閱新菜單與早鳥優惠<br />好康不漏接</h2>
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
        <Button type="submit" className="lp-pill">立即訂閱</Button>
      </form>
    </section>
  );
}

function LandingContent() {
  const [tab, setTab] = useState("rice");
  const events = useScroller();
  const [review, setReview] = useState(0);

  // 合作店家：真實 vendors（與首頁共用 queryKey），取前 3 間
  const { data: vendors = [], isLoading: vendorsLoading } = useQuery({
    queryKey: ["vendors"],
    queryFn: async () => {
      const snap = await getDocs(collection(db, "vendors"));
      return snap.docs
        .map((d) => ({ id: d.id, ...(d.data() as any) }) as Vendor)
        .filter((v) => v.status !== "disabled");
    },
    staleTime: 15 * 60 * 1000,
  });

  const r = REVIEWS[review];

  return (
    <div className="bb-landing">
      {/* ── Header：沿用全站共用導覽列 ── */}
      <MarketplaceHeader active="landing" />

      <main>
        {/* ── Hero ── */}
        <section className="lp-container lp-hero">
          <h1 className="lp-display">越早訂，越開心。<br />每一口都準時開飯</h1>
          <p className="lp-lead">提前預付鎖定學校附近的好店午餐，享最高 7 折早鳥價；時間到直接取餐，不用排隊。</p>
          <div className="lp-hero__cta">
            <LinkButton href="/home" variant="secondary" size="lg" rightIcon={<ArrowRight />}>探索今日菜單</LinkButton>
          </div>

          <div className="lp-hero__visual" aria-hidden="true">
            <div className="lp-hero__glow" />
            <div className="lp-ticket">
              <div className="lp-ticket__top">
                <span className="lp-ticket__thumb"><CookingPot /></span>
                <div>
                  <p className="lp-ticket__name">阿嬤滷肉飯套餐</p>
                  <p className="lp-ticket__meta">仁和雅咖啡・12:00–12:30</p>
                </div>
                <Badge tone="success" dot>已鎖定</Badge>
              </div>
              <div className="lp-ticket__price">
                <span className="lp-strike">NT$ 110</span>
                <span className="lp-ticket__now">NT$ 77</span>
                <Badge tone="brand" variant="solid" shape="pill">早鳥 7 折</Badge>
              </div>
            </div>
            <div className="lp-float lp-float--a"><Ticket /> 可轉讓給同學</div>
            <div className="lp-float lp-float--b"><BellRing /> 11:50 取餐提醒</div>
            <div className="lp-float lp-float--c"><ShieldCheck /> 未出餐全額退</div>
          </div>
        </section>

        {/* ── 品牌故事 ── */}
        <section className="lp-story" aria-labelledby="lp-story-title">
          <div className="lp-container lp-story__inner">
            <img src="/飯飽R.png" alt="" className="lp-story__mark" width={72} height={64} />
            <p id="lp-story-title" className="lp-story__statement">
              BunnBaa 從一個簡單的念頭開始：讓每個人都能
              <span className="lp-nowrap"><span className="lp-story__pill">準時吃飽</span>，</span>
              也讓店家不再猜今天要備幾份。
            </p>
            <p className="lp-story__body">
              學生提前預約、店家提前備餐，剩下的交給轉讓市集——不排隊、不浪費，把午休還給自己。
            </p>
          </div>
        </section>

        {/* ── 跑馬燈 ── */}
        <div className="lp-ticker" aria-label="最新消息">
          <div className="lp-ticker__track">
            {[...TICKER, ...TICKER].map((t, i) => (
              <span key={i} className="lp-ticker__item" aria-hidden={i >= TICKER.length || undefined}>
                <Sparkle className="lp-ticker__star" aria-hidden="true" /> {t}
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
            <h2 id="lp-features-title" className="lp-h2">BunnBaa 有什麼不一樣</h2>
            <ul className="lp-features__grid">
              {FEATURES.map((f) => (
                <li key={f.title}>
                  <IconBox size="lg">{f.icon}</IconBox>
                  <h3 className="lp-h4">{f.title}</h3>
                  <p className="lp-muted">{f.body}</p>
                </li>
              ))}
            </ul>
            <div className="lp-features__cta">
              <LinkButton href="/home">開始預約</LinkButton>
              <p className="lp-note"><Info aria-hidden="true" /> 全額預付、不可退款，但可轉讓過戶。</p>
            </div>
          </div>
        </section>

        {/* ── 菜單 ── */}
        <section className="lp-section" aria-labelledby="lp-menu-title">
          <div className="lp-menu">
            <IconBox size="lg" className="lp-center-block"><Soup /></IconBox>
            <h2 id="lp-menu-title" className="lp-h2 lp-center">大家最愛的招牌餐點</h2>
            <div className="lp-menu__tabs">
              <Tabs items={MENU_TABS} value={tab} onValueChange={setTab} idPrefix="lp-menu" aria-label="餐點分類" />
            </div>
            <ul
              className="lp-menu__list"
              role="tabpanel"
              id={`lp-menu-panel-${tab}`}
              aria-labelledby={`lp-menu-tab-${tab}`}
            >
              {MENU[tab].map((m) => (
                <li key={m.name} className="lp-dish">
                  <span className="lp-dish__thumb" aria-hidden="true">{m.icon}</span>
                  {m.popular && <Badge tone="brand" variant="solid" size="sm" shape="pill" className="lp-dish__badge">人氣</Badge>}
                  <div className="lp-dish__text">
                    <h3 className="lp-h4">{m.name}</h3>
                    <p className="lp-muted">{m.desc}</p>
                  </div>
                  <div className="lp-dish__price">
                    <span className="lp-strike">${m.price}</span>
                    <strong>${earlyBird(m.price)}</strong>
                  </div>
                </li>
              ))}
            </ul>
            <p className="lp-note lp-center">價格為提前 14–30 天的早鳥 7 折價；實際品項與價格以各店家菜單為準。</p>
          </div>
        </section>

        {/* ── 活動 ── */}
        <section className="lp-section" aria-labelledby="lp-events-title">
          <div className="lp-container lp-row-head">
            <SectionTitle><span id="lp-events-title">BunnBaa 近期活動</span></SectionTitle>
            <div className="lp-arrows">
              <Button variant="outline" iconOnly aria-label="上一個活動" className="lp-round" onClick={() => events.scroll(-1)}><ChevronLeft /></Button>
              <Button variant="outline" iconOnly aria-label="下一個活動" className="lp-round" onClick={() => events.scroll(1)}><ChevronRight /></Button>
            </div>
          </div>
          <div className="lp-scroller" ref={events.ref}>
            {EVENTS.map((e) => (
              <article key={e.title} className="lp-event">
                <div className="lp-event__body">
                  <p className="lp-caption">{e.date}</p>
                  <h3 className="lp-h3">{e.title}</h3>
                  <p className="lp-muted">{e.body}</p>
                  <LinkButton href={e.href} variant="secondary" size="sm" rightIcon={<ArrowRight />}>查看活動</LinkButton>
                </div>
                <div className="lp-event__visual" aria-hidden="true">{e.icon}</div>
              </article>
            ))}
          </div>

          <dl className="lp-container lp-stats">
            <div className="lp-stat"><dt>早鳥折扣最高</dt><dd><StatNumber value={7} suffix=" 折" /></dd></div>
            <div className="lp-stat"><dt>未出餐加贈回饋金</dt><dd><StatNumber value={20} suffix=" 點" /></dd></div>
            <div className="lp-stat"><dt>最早可提前預約</dt><dd><StatNumber value={30} suffix=" 天" /></dd></div>
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

        {/* ── 評價 ── */}
        <section className="lp-section lp-container lp-reviews" aria-labelledby="lp-reviews-title" aria-roledescription="輪播">
          <h2 id="lp-reviews-title" className="sr-only">使用者評價</h2>
          <div className="lp-stars" aria-label="5 顆星">
            {Array.from({ length: 5 }, (_, i) => <Star key={i} aria-hidden="true" />)}
          </div>
          <div className="lp-reviews__row">
            <Button variant="outline" iconOnly aria-label="上一則評價" className="lp-round" onClick={() => setReview((review + REVIEWS.length - 1) % REVIEWS.length)}><ChevronLeft /></Button>
            <figure className="lp-quote" aria-live="polite">
              <blockquote>{r.quote}</blockquote>
              <figcaption><strong>{r.name}</strong><span>{r.role}</span></figcaption>
            </figure>
            <Button variant="outline" iconOnly aria-label="下一則評價" className="lp-round" onClick={() => setReview((review + 1) % REVIEWS.length)}><ChevronRight /></Button>
          </div>
        </section>

        {/* ── 合作店家 ── */}
        <section className="lp-section lp-container" aria-labelledby="lp-stores-title">
          <h2 id="lp-stores-title" className="lp-h2 lp-center">找到你附近的合作店家</h2>
          <div className="lp-stores">
            {vendorsLoading && Array.from({ length: 3 }, (_, i) => <div key={i} className="lp-store lp-store--skeleton" />)}
            {!vendorsLoading && vendors.slice(0, 3).map((v) => (
              <article key={v.id} className="lp-store">
                <div className="lp-store__visual" aria-hidden="true"><Store /></div>
                <h3 className="lp-h3">{v.name}</h3>
                {v.address && <p className="lp-muted lp-store__addr"><MapPin aria-hidden="true" />{v.address}</p>}
                <div className="lp-store__foot">
                  {v.verified ? <Badge tone="success" size="sm">認證商家</Badge> : <span />}
                  <LinkButton href={`/vendor/${v.id}`} variant="secondary" size="sm" rightIcon={<ArrowRight />}>查看店家</LinkButton>
                </div>
              </article>
            ))}
          </div>
          {!vendorsLoading && vendors.length === 0 && (
            <p className="lp-muted lp-center">合作店家陸續上線中，<Link href="/vendors" className="lp-link">查看店家列表</Link>。</p>
          )}
        </section>

        <Newsletter />
      </main>

      {/* ── Footer ── */}
      <footer className="lp-container lp-footer">
        <div className="lp-footer__info">
          <Link href="/landing" className="lp-logo" aria-label="BunnBaa 飯飽 首頁">
            <img src="/飯飽R.png" alt="" width={44} height={39} />
            <span className="lp-logo__word"><span className="lp-logo__bunn">Bunn</span><span className="lp-logo__baa">Baa</span></span>
          </Link>
          <div>
            <h2 className="lp-h4"><Clock aria-hidden="true" className="lp-inline-icon" /> 取餐時段</h2>
            <ul className="lp-muted lp-footer__hours">
              {TIME_SLOTS.map((t) => <li key={t}>週一至週五 {t}</li>)}
              <li>實際時段依各店家公告，國定假日可能調整。</li>
            </ul>
          </div>
          <p className="lp-caption">© {new Date().getFullYear()} BunnBaa 飯飽・越早訂，越開心。</p>
        </div>
        <nav className="lp-footer__links" aria-label="頁尾連結">
          <h2 className="lp-h4">頁面連結</h2>
          <ul>
            {[...NAV, { href: "/cart", label: "購物車" }, { href: "/profile", label: "會員資料" }, { href: "/login", label: "登入／註冊" }, { href: "/vendor-portal/dashboard", label: "商家後台" }].map((n) => (
              <li key={n.href}><Link href={n.href} className={n.href === "/landing" ? "is-active" : undefined}>{n.label}</Link></li>
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
