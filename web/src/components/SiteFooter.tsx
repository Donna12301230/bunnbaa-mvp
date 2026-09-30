import { Link } from "wouter";
import { useI18n, type Lang } from "@/lib/i18n";
import { PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";
import "./SiteFooter.css";

type Bi = { zh: string; en: string };
const pick = (text: Bi, lang: Lang) => text[lang];

const FOOTER_COLUMNS: { title: Bi; links: { href: string; label: Bi }[] }[] = [
  {
    title: { zh: "關於", en: "About" },
    links: [
      { href: "/about", label: { zh: "關於我們", en: "About us" } },
      { href: "/join", label: { zh: "加入我們", en: "Join us" } },
    ],
  },
  {
    title: { zh: "支援", en: "Support" },
    links: [
      { href: "/faq", label: { zh: "常見問題", en: "FAQ" } },
      { href: "/contact", label: { zh: "聯絡客服", en: "Contact support" } },
    ],
  },
];

// 全站共用頁尾（原本只有品牌形象頁 LandingPage.tsx 有，2026-09-30 抽成共用元件，
// 讓其他頁面也能直接掛用；樣式跟 tokens.css 走全域變數，不依賴 LandingPage.css）。
export default function SiteFooter() {
  const { t, lang } = useI18n();
  return (
    <footer className="site-footer">
      <div className="site-footer__grid">
        <div className="site-footer__brand">
          <span className="site-footer__logo">
            <span className="site-footer__logo-bunn">Bunn</span><span className="site-footer__logo-baa">Baa</span>
          </span>
          <p className="site-footer__muted">{t("赫滋與羊國際藝術有限公司", "Herz & Baa International Arts Co., Ltd.")}</p>
          <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="site-footer__muted site-footer__email">{PLATFORM_CONTACT_EMAIL}</a>
        </div>
        {FOOTER_COLUMNS.map((col) => (
          <nav key={pick(col.title, "en")} className="site-footer__col" aria-label={pick(col.title, lang)}>
            <h2 className="site-footer__col-title">{pick(col.title, lang)}</h2>
            <ul>
              {col.links.map((n) => (
                <li key={n.href}><Link href={n.href}>{pick(n.label, lang)}</Link></li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="site-footer__bottom">
        <p className="site-footer__caption">© {new Date().getFullYear()} {t("BunnBaa 飯飽・越早訂，越開心。", "BunnBaa · Book early, eat happy.")}</p>
      </div>
    </footer>
  );
}
