import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { addDays, format } from "date-fns";
import {
  ArrowDown, ArrowRight, ArrowUpRight, BellRing, CalendarCheck, CalendarClock, ChevronLeft, ChevronRight,
  CookingPot, HeartHandshake, MapPin, QrCode, Repeat, ShieldCheck, Soup, Sparkle, Star, Store, Ticket, Wallet,
} from "lucide-react";
import { AnimatedNumber, Badge, Button, Tabs, ToastProvider } from "@/components/ds";
import MarketplaceHeader from "@/components/MarketplaceHeader";
import { db } from "@/lib/firebase";
import type { MenuItem } from "@/types";
import { EARLY_BIRD_TIERS, discountText } from "@/lib/pricing";
import { useReviews } from "@/hooks/useReviews";
import { slotLabel, vendorWindows } from "@/lib/pickupSlots";
import { liveConfig } from "@/lib/platformConfig";
import "./LandingPage.css";
import { dateLocale, useI18n, type Lang, loc } from "@/lib/i18n";
import { useVendors } from "@/hooks/useVendors";
import SiteFooter from "@/components/SiteFooter";

/**
 * 品牌形象頁（#/、#/landing）
 * 2026-10-01 改版：以 Awwwards／FWA 等級的編輯式版面為目標——
 *   Hero 直接放大標語＋真實餐點照片拼貼，第一眼就看到品牌與產品；
 *   品牌故事改成捲動逐字點亮的深棕色帶；新增「怎麼運作」四步驟、
 *   可拖曳的「早鳥試算」（直接讀 lib/pricing 的級距，跟下單算價同一套規則）、
 *   收尾的大型 CTA。所有動態都尊重 prefers-reduced-motion。
 * 資料全部是真實 Firestore 內容（menu_items／vendors／reviews／landing_events），沒有就優雅地收起該區。
 */

type Bi = { zh: string; en: string };
const pick = (text: Bi, lang: Lang) => text[lang];

// 跑馬燈：規則數字讀平台參數（lib/policy.ts），切換語言時重新產生
const ticker = (): Bi[] => {
  const c = liveConfig();
  const [near, far] = EARLY_BIRD_TIERS;
  return [
    { zh: `訂明天 ${discountText(near.discountPercent)}，提前 ${far.minDays} 天以上 ${discountText(far.discountPercent)}`, en: `${near.discountPercent}% off for tomorrow, ${far.discountPercent}% off ${far.minDays}+ days ahead` },
    { zh: "臨時去不了？轉讓、請朋友代領或捐為愛心餐", en: "Can't make it? Transfer it, send a friend, or donate it as a charity meal" },
    { zh: `取餐 ${c.cancelHoursBefore} 小時前可取消，換成原價 ${Math.round(c.cancelCouponRate * 100)}% 的折價券`, en: `Cancel up to ${c.cancelHoursBefore} hours ahead for a coupon worth ${Math.round(c.cancelCouponRate * 100)}% of the price` },
    { zh: "取餐時段快結束還沒取，推播提醒你", en: "A push reminder if your pickup window is about to end" },
    { zh: `每 ${c.ticketUnit} 元一張抽獎券`, en: `A draw ticket for every NT$${c.ticketUnit}` },
  ];
};

// 早鳥最高折扣（預訂 30 天內的階梯），跟 lib/pricing 同一套級距與四捨五入
const BEST_EARLY_BIRD = Math.max(...EARLY_BIRD_TIERS.map((t) => t.discountPercent));
const earlyBird = (price: number, pct = BEST_EARLY_BIRD) => Math.round(price * (1 - pct / 100));
const discountFor = (days: number) => EARLY_BIRD_TIERS.find((t) => days >= t.minDays && days <= t.maxDays)?.discountPercent ?? 0;
const MENU_TAB_LIMIT = 5;
const MENU_ITEMS_PER_TAB = 4;

// 預訂開放範圍：最遠提前 30 天（規格 §2，跟 lib/pickupSlots 同一個參數）
const maxAdvanceDays = () => liveConfig().bookingRangeDays;

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

const GALLERY_SHAPES = ["rounded", "circle", "arch", "rounded", "circle", "arch"] as const;

// 同學評價：讀 reviews 裡有公開心得、4 星以上的最近幾則
const REVIEW_LIMIT = 5;

// ── 動態工具 ───────────────────────────────────────────────────────────────

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 進場動畫：root 底下所有 [data-reveal] 捲進畫面時加上 .is-in。
 * 用 MutationObserver 接住資料載入後才出現的節點；只在 root 加上 .lp-motion 後才會先藏起來，
 * 所以 JS 沒跑、縮圖擷取、reduced-motion 時內容一律直接可見。
 */
function useRevealAll(rootRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion() || !("IntersectionObserver" in window)) return;
    root.classList.add("lp-motion");
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    const scan = () => root.querySelectorAll("[data-reveal]:not(.is-in)").forEach((el) => io.observe(el));
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => {
      io.disconnect();
      mo.disconnect();
      root.classList.remove("lp-motion");
    };
  }, [rootRef]);
}

/**
 * 捲動進度：把元素從進入視窗底部到離開頂部（或 sticky 期間）的進度 0→1 寫到 CSS 變數 --p，
 * 不經過 React state，不會每一格都 re-render。
 */
function useScrollProgress<T extends HTMLElement>(mode: "through" | "pin" = "through") {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (prefersReducedMotion()) {
      el.style.setProperty("--p", "1");
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const p = mode === "pin"
        ? -r.top / Math.max(1, r.height - vh)
        : (vh * 0.85 - r.top) / (r.height + vh * 0.1);
      el.style.setProperty("--p", Math.min(1, Math.max(0, p)).toFixed(4));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [mode]);
  return ref;
}

/** Hero 的游標視差：只在有滑鼠（fine pointer）時把 -1…1 的座標寫到 --mx／--my。 */
function usePointerParallax<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || prefersReducedMotion() || !window.matchMedia("(pointer: fine)").matches) return;
    let frame = 0;
    let mx = 0;
    let my = 0;
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      mx = ((e.clientX - r.left) / r.width) * 2 - 1;
      my = ((e.clientY - r.top) / r.height) * 2 - 1;
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty("--mx", mx.toFixed(3));
        el.style.setProperty("--my", my.toFixed(3));
      });
    };
    const onLeave = () => { el.style.setProperty("--mx", "0"); el.style.setProperty("--my", "0"); };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
    };
  }, []);
  return ref;
}

/**
 * 頁內跳轉：網站用 hash 路由（#/home），直接寫 href="#lp-how" 會被當成換頁到 /lp-how → 404。
 * 攔下預設行為，改成捲動到目標並把焦點移過去（跳到主要內容時螢幕閱讀器才會跟上）。
 */
function jumpTo(e: React.MouseEvent, id: string) {
  e.preventDefault();
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  el.focus({ preventScroll: true });
}

// ── 小元件 ───────────────────────────────────────────────────────────────

/** 進入視窗才觸發的數字滾動（AnimatedNumber 從 0 滾到目標值）。 */
function StatNumber({ value, suffix }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0));
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
      <AnimatedNumber value={shown} suffix={suffix && <span className="lp-stat__unit">{suffix}</span>} duration={1100} />
    </span>
  );
}

/** 水平捲動列 + 左右按鈕。 */
function useScroller() {
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  };
  return { ref, scroll };
}

function LinkButton({ href, variant = "primary", size = "md", children, rightIcon, className }: {
  href: string; variant?: "primary" | "secondary" | "outline"; size?: "sm" | "md" | "lg"; children: ReactNode; rightIcon?: ReactNode; className?: string;
}) {
  return (
    <Link href={href} className={`bb-btn bb-btn--${variant} bb-btn--${size} lp-pill${className ? ` ${className}` : ""}`}>
      <span className="bb-btn__label">{children}</span>
      {rightIcon && <span className="bb-btn__icon lp-pill__icon" aria-hidden="true">{rightIcon}</span>}
    </Link>
  );
}

/** 章節小標：編號 + 名稱（編輯式版面的 eyebrow）。 */
function Eyebrow({ index, children, invert = false }: { index: string; children: ReactNode; invert?: boolean }) {
  return (
    <p className={`lp-eyebrow${invert ? " lp-eyebrow--invert" : ""}`} data-reveal>
      <span className="lp-eyebrow__index">{index}</span>
      <span className="lp-eyebrow__rule" aria-hidden="true" />
      {children}
    </p>
  );
}

/** 標題逐行由下往上滑入（每行包在 overflow:hidden 的遮罩裡）。 */
function MaskLines({ lines, className, as: Tag = "h2", id }: { lines: ReactNode[]; className: string; as?: "h1" | "h2"; id?: string }) {
  return (
    <Tag className={className} id={id} data-reveal="mask">
      {lines.map((line, i) => (
        <span key={i} className="lp-mask">
          <span className="lp-mask__inner" style={{ "--i": i } as CSSProperties}>{line}</span>
        </span>
      ))}
    </Tag>
  );
}

/** 品牌宣言：捲動時逐字點亮。螢幕閱讀器讀完整句（逐字的 span 都 aria-hidden）。 */
function ScrollLitStatement({ parts, id }: { parts: { text: string; pill?: boolean }[]; id: string }) {
  const ref = useScrollProgress<HTMLParagraphElement>();
  const total = parts.reduce((n, p) => n + [...p.text].length, 0);
  let index = 0;
  const plain = parts.map((p) => p.text).join("");
  return (
    <p ref={ref} id={id} className="lp-statement" style={{ "--n": total } as CSSProperties}>
      <span className="sr-only">{plain}</span>
      <span aria-hidden="true">
        {parts.map((part, pi) => {
          const chars = [...part.text].map((ch) => {
            const i = index++;
            return <span key={i} className="lp-statement__ch" style={{ "--i": i } as CSSProperties}>{ch}</span>;
          });
          return part.pill
            ? <span key={pi} className="lp-statement__pill">{chars}</span>
            : <span key={pi}>{chars}</span>;
        })}
      </span>
    </p>
  );
}

// ── 早鳥試算 ─────────────────────────────────────────────────────────────

function EarlyBirdSimulator({ item, vendorName }: { item: MenuItem | undefined; vendorName: string }) {
  const { t, isEn } = useI18n();
  const sliderId = useId();
  const [days, setDays] = useState(4);
  const price = item?.price ?? 100;
  const pct = discountFor(days);
  const now = earlyBird(price, pct);
  const pickupDate = addDays(new Date(), days);
  const dayLabel = days === 1
    ? t("明天", "Tomorrow")
    : format(pickupDate, isEn ? "EEE, MMM d" : "M/d（EEEEE）", { locale: dateLocale() });
  const fill = ((days - 1) / (maxAdvanceDays() - 1)) * 100;

  return (
    <div className="lp-sim" data-reveal>
      <div className="lp-sim__dish">
        <span className="lp-sim__photo" aria-hidden="true">
          {item?.image ? <img src={item.image} alt="" loading="lazy" decoding="async" /> : <CookingPot />}
        </span>
        <div>
          <p className="lp-sim__name">{item ? loc(item, "name") : t("招牌便當", "Signature bento")}</p>
          {vendorName && <p className="lp-sim__vendor">{vendorName}</p>}
        </div>
      </div>

      <div className="lp-sim__readout" aria-live="polite">
        <span className="lp-sim__was">NT${price}</span>
        <span className="lp-sim__now"><span className="lp-sim__cur">NT$</span><AnimatedNumber value={now} duration={420} /></span>
        <span className={`lp-sim__badge${pct >= BEST_EARLY_BIRD ? " is-best" : ""}`}>{discountText(pct)}</span>
      </div>
      <p className="lp-sim__save">
        {t(`${dayLabel}取餐，省下 NT$${price - now}`, `Pick up ${dayLabel} — save NT$${price - now}`)}
      </p>

      <label htmlFor={sliderId} className="lp-sim__label">
        {t("提前幾天預約？", "How many days ahead?")}
        <strong>{t(`${days} 天`, `${days} day${days > 1 ? "s" : ""}`)}</strong>
      </label>
      <input
        id={sliderId}
        className="lp-sim__range"
        type="range"
        min={1}
        max={maxAdvanceDays()}
        step={1}
        value={days}
        onChange={(e) => setDays(Number(e.target.value))}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        aria-valuetext={t(`提前 ${days} 天，${discountText(pct)}，NT$${now}`, `${days} day${days > 1 ? "s" : ""} ahead, ${discountText(pct)}, NT$${now}`)}
      />
      <ol className="lp-sim__days" aria-hidden="true">
        {Array.from({ length: maxAdvanceDays() }, (_, i) => i + 1).map((d) => (
          <li key={d} className={`${d <= days ? "is-on" : ""}${discountFor(d) >= BEST_EARLY_BIRD ? " is-best" : ""}`}>
            <span>{format(addDays(new Date(), d), "d")}</span>
          </li>
        ))}
      </ol>
      <div className="lp-sim__legend" aria-hidden="true">
        <span><i className="lp-sim__dot" />{t(`明天 ${discountText(EARLY_BIRD_TIERS[0].discountPercent)}`, `Tomorrow −${EARLY_BIRD_TIERS[0].discountPercent}%`)}</span>
        <span><i className="lp-sim__dot is-best" />{t(`提前 ${EARLY_BIRD_TIERS[1].minDays} 天以上 ${discountText(BEST_EARLY_BIRD)}`, `${EARLY_BIRD_TIERS[1].minDays}+ days ahead −${BEST_EARLY_BIRD}%`)}</span>
      </div>
    </div>
  );
}

// ── 頁面 ─────────────────────────────────────────────────────────────────

function LandingContent() {
  const { t, lang, isEn } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = usePointerParallax<HTMLElement>();
  const stepsRef = useScrollProgress<HTMLOListElement>();
  useRevealAll(rootRef);

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
  const tab = menuTabs.some((x) => x.value === tabState) ? tabState : "c0";
  const tabDishes = menuByCategory.get(menuTabs.find((x) => x.value === tab)?.key ?? "")?.slice(0, MENU_ITEMS_PER_TAB) ?? [];
  const events = useScroller();
  const stores = useScroller();
  const [review, setReview] = useState(0);

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

  const { data: allReviews = [] } = useReviews();
  const reviews = allReviews.filter((x) => x.comment.trim() && x.rating >= 4).slice(0, REVIEW_LIMIT);
  const r = reviews.length > 0 ? reviews[review % reviews.length] : null;
  const reviewVendor = r ? vendors.find((v) => v.id === r.vendor_id) : undefined;
  const reviewPhoto = r
    ? menuItems.find((m) => m.vendor_id === r.vendor_id && m.image && r.item_name && m.name === r.item_name)?.image
      ?? reviewVendor?.cover_image
    : undefined;

  // Hero 拼貼與試算優先用有照片的品項
  const withPhoto = menuItems.filter((m) => m.image);
  const heroItem = withPhoto.find((m) => m.price >= 60) ?? withPhoto[0] ?? menuItems[0];
  const heroVendor = heroItem ? vendors.find((v) => v.id === heroItem.vendor_id) : undefined;
  const heroWindow = heroVendor ? vendorWindows(heroVendor)[0] : undefined;
  const collage = withPhoto.filter((m) => m.id !== heroItem?.id).slice(0, 3);

  const finalFan = withPhoto.slice(-3);
  const galleryTiles = withPhoto.slice(0, 8).map((m, i) => ({ item: m, shape: GALLERY_SHAPES[i % GALLERY_SHAPES.length] }));

  const steps = [
    { icon: <CalendarCheck />, title: t("提前預約", "Book ahead"), body: t(`挑好明天起 30 天內的早、中、晚餐，越早訂越便宜，最高 ${discountText(BEST_EARLY_BIRD)}。`, `Pick breakfast, lunch or dinner up to 30 days ahead — the earlier, the cheaper, up to ${BEST_EARLY_BIRD}% off.`) },
    { icon: <Wallet />, title: t("鎖定付款", "Lock it in"), body: t("LINE Pay 預付鎖定，店家照單備餐，不怕賣完。", "Prepay with LINE Pay. The vendor preps to order, so it never sells out on you.") },
    { icon: <QrCode />, title: t("準時取餐", "Grab & go"), body: t("取餐前推播提醒，出示 QR code，免排隊。", "Get a reminder before pickup, show your QR code, skip the queue.") },
    { icon: <HeartHandshake />, title: t("去不了也不浪費", "Never wasted"), body: t("臨時有事就轉讓、送給朋友，或捐成愛心餐。", "Plans changed? Transfer it, gift it, or donate it as a charity meal.") },
  ];

  const statementParts = isEn
    ? [{ text: "BunnBaa started with a simple idea: everyone should get to " }, { text: "eat on time", pill: true }, { text: ", and vendors should never have to guess how much to prep." }]
    : [{ text: "BunnBaa 從一個簡單的念頭開始：讓每個人都能" }, { text: "準時吃飽", pill: true }, { text: "，也讓店家不再猜今天要備幾份。" }];

  // 章節編號：活動、評價是選擇性區塊，編號依實際出現的順序往下排
  let section = 4;
  const nextIndex = () => String(++section).padStart(2, "0");

  return (
    <div className="bb-landing" ref={rootRef}>
      <a href="#lp-main" className="lp-skip" onClick={(e) => jumpTo(e, "lp-main")}>{t("跳到主要內容", "Skip to content")}</a>
      <MarketplaceHeader active="landing" />

      <main id="lp-main" tabIndex={-1} className="outline-none">
        {/* ── Hero：標語 + 真實餐點拼貼 + 已鎖定票券 ── */}
        <section className="lp-hero" ref={heroRef} aria-labelledby="lp-hero-title">
          <div className="lp-container lp-hero__grid">
            <div className="lp-hero__copy">
              <p className="lp-hero__kicker" data-reveal>
                <span className="lp-live" aria-hidden="true" />
                {t("早餐・午餐・晚餐預約平台・嘉義", "Breakfast, lunch & dinner, booked ahead · Chiayi")}
              </p>
              <MaskLines
                as="h1"
                id="lp-hero-title"
                className="lp-display"
                lines={isEn
                  ? ["Book early,", <>eat <em className="lp-accent">happy.</em></>]
                  : ["越早訂，", <>越<em className="lp-accent">開心</em>。</>]}
              />
              <p className="lp-lead" data-reveal style={{ "--d": "240ms" } as CSSProperties}>
                {isEn
                  ? <>You book ahead, vendors prep ahead. Lock in breakfast, lunch or dinner from great spots near school or work for <span className="lp-nowrap">up to {BEST_EARLY_BIRD}% off</span>, then just pick it up — no queues, no waste.</>
                  : <>學生、上班族提前預約，店家提前備餐。鎖定學校、公司附近好店的早餐、午餐、晚餐，<span className="lp-nowrap">最高 {discountText(BEST_EARLY_BIRD)}</span>，時間到直接取餐——不排隊、不浪費。</>}
              </p>
              <div className="lp-hero__cta" data-reveal style={{ "--d": "360ms" } as CSSProperties}>
                <LinkButton href="/home" variant="primary" size="lg" rightIcon={<ArrowRight />} className="lp-magnet">{t("探索今日菜單", "Explore today's menu")}</LinkButton>
                <a href="#lp-how" className="lp-textlink" onClick={(e) => jumpTo(e, "lp-how")}>{t("怎麼運作", "How it works")}<ArrowDown aria-hidden="true" /></a>
              </div>
              <dl className="lp-hero__proof" data-reveal style={{ "--d": "480ms" } as CSSProperties}>
                <div><dt>{t("早鳥最高", "Up to")}</dt><dd>{isEn ? `${BEST_EARLY_BIRD}% off` : discountText(BEST_EARLY_BIRD)}</dd></div>
                <div><dt>{t("最早提前", "Book up to")}</dt><dd>{t(`${maxAdvanceDays()} 天`, `${maxAdvanceDays()} days`)}</dd></div>
                <div><dt>{t("合作店家", "Partner vendors")}</dt><dd>{vendorsLoading ? "—" : vendors.length}</dd></div>
              </dl>
            </div>

            <div className="lp-hero__visual" aria-hidden="true">
              <div className="lp-blob" />
              <div className="lp-hero__frame lp-hero__frame--main" data-reveal>
                {heroItem?.image ? <img src={heroItem.image} alt="" decoding="async" {...{ fetchpriority: "high" }} /> : <CookingPot />}
              </div>
              {collage.map((m, i) => (
                <div key={m.id} className={`lp-hero__frame lp-hero__frame--s${i}`} data-reveal style={{ "--d": `${200 + i * 120}ms` } as CSSProperties}>
                  <img src={m.image ?? ""} alt="" loading="lazy" decoding="async" />
                </div>
              ))}
              <svg className="lp-hero__badge" viewBox="0 0 120 120">
                <defs><path id="lp-circle" d="M60 60 m-44 0 a44 44 0 1 1 88 0 a44 44 0 1 1 -88 0" /></defs>
                <text><textPath href="#lp-circle">BOOK EARLY · EAT HAPPY · 越早訂越開心 · </textPath></text>
                <circle cx="60" cy="60" r="20" />
              </svg>
              {heroItem && (
                <div className="lp-ticket" data-reveal style={{ "--d": "560ms" } as CSSProperties}>
                  <div className="lp-ticket__top">
                    <span className="lp-ticket__thumb">
                      {heroItem.image ? <img src={heroItem.image} alt="" /> : <CookingPot />}
                    </span>
                    <div className="lp-ticket__info">
                      <p className="lp-ticket__name">{loc(heroItem, "name")}</p>
                      <p className="lp-ticket__meta">{[loc(heroVendor, "name"), heroWindow && slotLabel(heroWindow)].filter(Boolean).join("・")}</p>
                    </div>
                  </div>
                  <div className="lp-ticket__price">
                    <span className="lp-strike">NT${heroItem.price}</span>
                    <span className="lp-ticket__now">NT${earlyBird(heroItem.price)}</span>
                    <Badge tone="success" dot>{t("已鎖定", "Locked")}</Badge>
                  </div>
                  <span className="lp-ticket__stamp">{isEn ? `−${BEST_EARLY_BIRD}%` : discountText(BEST_EARLY_BIRD)}</span>
                </div>
              )}
              <div className="lp-float lp-float--a"><Ticket /> {t("可轉讓・贈送", "Transfer or gift")}</div>
              <div className="lp-float lp-float--b"><BellRing /> {t("取餐提醒", "Pickup reminder")}</div>
              <div className="lp-float lp-float--c"><ShieldCheck /> {t(`${liveConfig().cancelHoursBefore} 小時前可取消換券`, `Cancel ${liveConfig().cancelHoursBefore}h ahead for a coupon`)}</div>
            </div>
          </div>
        </section>

        {/* ── 跑馬燈 ── */}
        <div className="lp-ticker" role="region" aria-label={t("最新消息", "Latest news")}>
          <div className="lp-ticker__track">
            {[...ticker(), ...ticker()].map((item, i) => (
              <span key={i} className="lp-ticker__item" aria-hidden={i >= ticker().length || undefined}>
                <Sparkle className="lp-ticker__star" aria-hidden="true" /> {pick(item, lang)}
              </span>
            ))}
          </div>
        </div>

        {/* ── 品牌故事：捲動逐字點亮 ── */}
        <section className="lp-story" aria-labelledby="lp-story-title">
          <div className="lp-container lp-story__inner">
            <Eyebrow index="01" invert>{t("我們的初衷", "Why we exist")}</Eyebrow>
            <h2 className="sr-only" id="lp-story-title">{t("品牌故事", "Our story")}</h2>
            <ScrollLitStatement id="lp-story-statement" parts={statementParts} />
            <div className="lp-story__foot" data-reveal>
              <img src="/飯飽R.png" alt={t("飯飽 BunnBaa 標誌", "BunnBaa logo")} className="lp-story__mark" width={88} height={78} loading="lazy" />
              <p className="lp-story__body">
                {t("剩下的交給轉讓市集：臨時去不了的餐，會找到下一個想吃的人。", "The transfer market handles the rest: a meal you can't make finds the next person who wants it.")}
              </p>
            </div>
          </div>
        </section>

        {/* ── 怎麼運作：四步驟，捲動時連接線跟著畫出來 ── */}
        <section className="lp-section lp-how" id="lp-how" tabIndex={-1} aria-labelledby="lp-how-title" style={{ outline: "none", scrollMarginTop: 72 }}>
          <div className="lp-container">
            <Eyebrow index="02">{t("怎麼運作", "How it works")}</Eyebrow>
            <MaskLines
              id="lp-how-title"
              className="lp-h2"
              lines={isEn ? ["Four steps from", "hungry to happy."] : ["從肚子餓到吃飽，", "只要四步。"]}
            />
            <ol className="lp-steps" ref={stepsRef}>
              <li className="lp-steps__line" aria-hidden="true" />
              {steps.map((s, i) => (
                <li key={i} className="lp-step" data-reveal style={{ "--d": `${i * 110}ms` } as CSSProperties}>
                  <span className="lp-step__icon" aria-hidden="true">{s.icon}</span>
                  <span className="lp-step__num" aria-hidden="true">{String(i + 1).padStart(2, "0")}</span>
                  <h3 className="lp-h3">{s.title}</h3>
                  <p className="lp-muted">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 早鳥試算 ── */}
        <section className="lp-section lp-early" aria-labelledby="lp-early-title">
          <div className="lp-container lp-early__grid">
            <div className="lp-early__copy">
              <Eyebrow index="03">{t("早鳥試算", "Early-bird calculator")}</Eyebrow>
              <MaskLines
                id="lp-early-title"
                className="lp-h2"
                lines={isEn ? ["Slide the days.", "Watch it drop."] : ["往右拉一點，", "午餐就便宜一點。"]}
              />
              <p className="lp-lead lp-lead--left" data-reveal>
                {t(
                  "店家提早知道要備幾份，就能少浪費、多備對的量——省下來的成本，直接回饋到你的餐費。",
                  "When vendors know early how much to prep, they waste less — and the savings come straight back to you.",
                )}
              </p>
              <ul className="lp-tiers" data-reveal>
                {EARLY_BIRD_TIERS.map((tier) => (
                  <li key={tier.minDays}>
                    <span>{tier.minDays <= 1 ? t("訂明天", "Tomorrow") : t(`提前 ${tier.minDays} 天以上`, `${tier.minDays}+ days ahead`)}</span>
                    <strong>{discountText(tier.discountPercent)}</strong>
                  </li>
                ))}
              </ul>
            </div>
            <EarlyBirdSimulator item={heroItem} vendorName={loc(heroVendor, "name")} />
          </div>
        </section>

        {/* ── 菜單 ── */}
        <section className="lp-section" aria-labelledby="lp-menu-title">
          <div className="lp-menu">
            <Eyebrow index="04">{t("招牌餐點", "Signature dishes")}</Eyebrow>
            <MaskLines id="lp-menu-title" className="lp-h2 lp-center" lines={[t("大家最愛的招牌餐點", "Crowd favourites")]} />
            {menuTabs.length > 0 && (
              <div className="lp-menu__tabs" data-reveal>
                <Tabs items={menuTabs} value={tab} onValueChange={setTab} idPrefix="lp-menu" aria-label={t("餐點分類", "Menu categories")} />
              </div>
            )}
            <div role="tabpanel" id={`lp-menu-panel-${tab}`} aria-labelledby={`lp-menu-tab-${tab}`}>
            <ul className="lp-menu__list" key={tab}>
              {tabDishes.map((m, i) => (
                <li key={m.id} className="lp-dish" style={{ "--i": i } as CSSProperties}>
                  <span className="lp-dish__thumb" aria-hidden="true">
                    {m.image ? <img src={m.image} alt="" loading="lazy" decoding="async" /> : <Soup />}
                  </span>
                  <div className="lp-dish__text">
                    <h3 className="lp-h4">{loc(m, "name")}</h3>
                    <p className="lp-muted">{loc(m, "description")}</p>
                  </div>
                  <span className="lp-dish__leader" aria-hidden="true" />
                  <div className="lp-dish__price">
                    <span className="lp-strike"><span className="sr-only">{t("原價", "Was")} </span>NT${m.price}</span>
                    <strong><span className="sr-only">{t("早鳥價", "Early-bird")} </span>NT${earlyBird(m.price)}</strong>
                  </div>
                </li>
              ))}
            </ul>
            </div>
            {menuItems.length === 0 && <p className="lp-muted lp-center">{t("合作店家的餐點即將上架。", "Partner menus are coming soon.")}</p>}
            <p className="lp-note lp-center">{t(`價格為提前 2 天以上的早鳥 ${discountText(BEST_EARLY_BIRD)}價；實際品項與價格以各店家菜單為準。`, `Prices shown are the ${BEST_EARLY_BIRD}% early-bird price for booking 2+ days ahead; see each vendor's menu for actual items and prices.`)}</p>
            <div className="lp-center lp-menu__cta" data-reveal>
              <LinkButton href="/home" variant="outline" rightIcon={<ArrowRight />}>{t("看完整菜單", "See the full menu")}</LinkButton>
            </div>
          </div>
        </section>

        {/* ── 活動（沒有進行中的活動就整段不顯示） ── */}
        {landingEvents.length > 0 && (
          <section className="lp-section" aria-labelledby="lp-events-title">
            <div className="lp-container lp-row-head">
              <div>
                <Eyebrow index={nextIndex()}>{t("近期活動", "What's on")}</Eyebrow>
                <MaskLines id="lp-events-title" className="lp-h2" lines={[t("BunnBaa 近期活動", "What's on at BunnBaa")]} />
              </div>
              {landingEvents.length > 1 && (
                <div className="lp-arrows">
                  <Button variant="outline" iconOnly aria-label={t("上一個活動", "Previous event")} className="lp-round" onClick={() => events.scroll(-1)}><ChevronLeft /></Button>
                  <Button variant="outline" iconOnly aria-label={t("下一個活動", "Next event")} className="lp-round" onClick={() => events.scroll(1)}><ChevronRight /></Button>
                </div>
              )}
            </div>
            <div className="lp-scroller" ref={events.ref}>
              {landingEvents.map((e) => (
                <article key={e.id} className="lp-event" data-reveal>
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
          </section>
        )}

        {/* ── 數字 ── */}
        <section className="lp-container lp-stats-wrap" aria-label={t("BunnBaa 的承諾", "Our promises")}>
          <dl className="lp-stats">
            <div className="lp-stat" data-reveal><dd>{isEn ? <StatNumber value={BEST_EARLY_BIRD} suffix="%" /> : <StatNumber value={(100 - BEST_EARLY_BIRD) / 10} suffix="折" />}</dd><dt>{t("早鳥折扣最高", "Max early-bird discount")}</dt></div>
            <div className="lp-stat" data-reveal style={{ "--d": "120ms" } as CSSProperties}><dd><StatNumber value={maxAdvanceDays()} suffix={t("天", "d")} /></dd><dt>{t("最早可提前預約", "Book up to days ahead")}</dt></div>
            <div className="lp-stat" data-reveal style={{ "--d": "240ms" } as CSSProperties}><dd><StatNumber value={100} suffix={t("元", "NT$")} /></dd><dt>{t("每累計實付，換一張抽獎券", "Paid per draw ticket")}</dt></div>
          </dl>
        </section>

        {/* ── 圖片牆（跑馬燈，真實品項照片） ── */}
        {galleryTiles.length >= 3 && (
          <div className="lp-gallery" aria-hidden="true">
            <div className="lp-gallery__track">
              {[...galleryTiles, ...galleryTiles].map((g, i) => (
                <figure key={i} className={`lp-shape lp-shape--${g.shape} lp-shape--o${i % 3}`}>
                  <img src={g.item.image ?? ""} alt="" loading="lazy" decoding="async" />
                  <figcaption>{loc(g.item, "name")}</figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {/* ── 評價（沒有公開評價時整段不顯示） ── */}
        {r && (
          <section className="lp-section lp-container lp-reviews" aria-labelledby="lp-reviews-title" aria-roledescription={t("輪播", "carousel")}>
            <Eyebrow index={nextIndex()}>{t("吃過的人怎麼說", "What eaters say")}</Eyebrow>
            <h2 id="lp-reviews-title" className="sr-only">{t("使用者評價", "Reviews")}</h2>
            <div className={`lp-reviews__row${reviewPhoto ? " has-photo" : ""}`}>
              {reviewPhoto && (
                <div className="lp-reviews__photo" aria-hidden="true" key={`p${review}`}>
                  <img src={reviewPhoto} alt="" loading="lazy" decoding="async" />
                </div>
              )}
              <figure className="lp-quote" aria-live="polite" key={review}>
                <div className="lp-stars" role="img" aria-label={t(`${r.rating} 顆星`, `${r.rating} stars`)}>
                  {Array.from({ length: 5 }, (_, i) => <Star key={i} aria-hidden="true" className={i < r.rating ? "is-on" : ""} />)}
                </div>
                <blockquote>{loc(r, "comment")}</blockquote>
                <figcaption>
                  <strong>{loc(r, "reviewer_label")}</strong>
                  <span>{[loc(reviewVendor, "name"), loc(r, "item_name")].filter(Boolean).join("・")}</span>
                </figcaption>
              </figure>
              {reviews.length > 1 && (
                <div className="lp-reviews__nav">
                  <Button variant="outline" iconOnly aria-label={t("上一則評價", "Previous review")} className="lp-round" onClick={() => setReview((review + reviews.length - 1) % reviews.length)}><ChevronLeft /></Button>
                  <span className="lp-reviews__count" aria-hidden="true">{String((review % reviews.length) + 1).padStart(2, "0")} / {String(reviews.length).padStart(2, "0")}</span>
                  <Button variant="outline" iconOnly aria-label={t("下一則評價", "Next review")} className="lp-round" onClick={() => setReview((review + 1) % reviews.length)}><ChevronRight /></Button>
                </div>
              )}
            </div>
          </section>
        )}

        {/* ── 合作店家（可左右滑動） ── */}
        <section className="lp-section lp-stores-sec" aria-labelledby="lp-stores-title">
          <div className="lp-container lp-row-head">
            <div>
              <Eyebrow index={nextIndex()}>{t("合作店家", "Partners")}</Eyebrow>
              <MaskLines id="lp-stores-title" className="lp-h2" lines={[t("找到你附近的合作店家", "Find partner vendors near you")]} />
            </div>
            {!vendorsLoading && vendors.length > 1 && (
              <div className="lp-arrows">
                <Button variant="outline" iconOnly aria-label={t("上一間店家", "Previous vendor")} className="lp-round" onClick={() => stores.scroll(-1)}><ChevronLeft /></Button>
                <Button variant="outline" iconOnly aria-label={t("下一間店家", "Next vendor")} className="lp-round" onClick={() => stores.scroll(1)}><ChevronRight /></Button>
              </div>
            )}
          </div>
          <div className="lp-scroller lp-stores" ref={stores.ref}>
            {vendorsLoading && Array.from({ length: 4 }, (_, i) => <div key={i} className="lp-store lp-store--skeleton" />)}
            {!vendorsLoading && vendors.map((v, i) => (
              <Link key={v.id} href={`/vendor/${v.id}`} className="lp-store" data-reveal style={{ "--d": `${Math.min(i, 4) * 90}ms` } as CSSProperties}>
                <div className="lp-store__visual" aria-hidden="true">
                  {v.cover_image ? <img src={v.cover_image} alt="" loading="lazy" decoding="async" /> : <Store />}
                  {v.verified && <Badge tone="success" size="sm" className="lp-store__verified">{t("認證店家", "Verified")}</Badge>}
                </div>
                <div className="lp-store__body">
                  <h3 className="lp-h3">{loc(v, "name")}</h3>
                  {v.address && <p className="lp-muted lp-store__addr"><MapPin aria-hidden="true" />{loc(v, "address")}</p>}
                </div>
                <span className="lp-store__go" aria-hidden="true"><ArrowUpRight /></span>
              </Link>
            ))}
          </div>
          {!vendorsLoading && vendors.length === 0 && (
            <p className="lp-muted lp-center">{t("合作店家陸續上線中，", "More partner vendors are joining soon — ")}<Link href="/vendors" className="lp-link">{t("查看店家列表", "see the vendor list")}</Link>{t("。", ".")}</p>
          )}
          {!vendorsLoading && vendors.length > 0 && (
            <p className="lp-center lp-stores__all"><Link href="/vendors" className="lp-textlink">{t("查看全部店家", "See all vendors")}<ArrowRight aria-hidden="true" /></Link></p>
          )}
        </section>

        {/* ── 收尾 CTA ── */}
        <section className="lp-final" aria-labelledby="lp-final-title">
          <div className="lp-final__marquee" aria-hidden="true">
            <div className="lp-final__track">
              {/* 純裝飾大字：字放在 CSS ::before（data-text），不進可及性樹 */}
              {Array.from({ length: 4 }, (_, i) => (
                <span key={i}>
                  <span className="lp-final__word" data-text="BunnBaa 飯飽" /><Sparkle />
                  <span className="lp-final__word" data-text={t("越早訂越開心", "Book early eat happy")} /><Sparkle />
                </span>
              ))}
            </div>
          </div>
          <div className="lp-container lp-final__inner">
            <MaskLines
              id="lp-final-title"
              className="lp-final__title"
              lines={isEn ? ["Tomorrow's lunch,", "locked in today."] : ["明天的午餐，", "今天就鎖定。"]}
            />
            <div className="lp-final__cta" data-reveal style={{ "--d": "200ms" } as CSSProperties}>
              <LinkButton href="/home" variant="secondary" size="lg" rightIcon={<ArrowRight />} className="lp-magnet">{t("開始預約", "Start booking")}</LinkButton>
              <Link href="/join" className="lp-textlink lp-textlink--invert">{t("我是店家，想加入", "I'm a vendor — join us")}<ArrowRight aria-hidden="true" /></Link>
            </div>
            {finalFan.length === 3 && (
              <div className="lp-final__fan" aria-hidden="true">
                {finalFan.map((m, i) => (
                  <span key={m.id} className={`lp-final__card lp-final__card--${i}`} data-reveal style={{ "--d": `${300 + i * 120}ms` } as CSSProperties}>
                    <img src={m.image ?? ""} alt="" loading="lazy" decoding="async" />
                  </span>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>

      <SiteFooter />
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
