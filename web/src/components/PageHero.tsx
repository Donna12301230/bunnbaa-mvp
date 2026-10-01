import { ReactNode } from "react";
import { Search } from "lucide-react";
import "./PageHero.css";

// 各分頁共用的頁首（轉讓市集／我的餐點／商家／成長獎勵／關於我們／常見問題／聯絡／加入我們）。
// 2026-10-01 全站改版：跟品牌形象頁同一套編輯式語彙——小標 eyebrow、大字襯線標題、
// 奶油底加一顆緩慢變形的奶油黃色塊；右側 children 通常放 HeroSearch。
export default function PageHero({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** 標題上方的小標（例：「Transfers · 轉讓」），沒給就不顯示 */
  eyebrow?: string;
  children?: ReactNode;
}) {
  return (
    <section className="bb-pagehero">
      <div className="bb-pagehero__blob" aria-hidden="true" />
      <div className="bb-pagehero__inner">
        <div className="bb-pagehero__copy">
          {eyebrow && (
            <p className="bb-pagehero__eyebrow">
              <span className="bb-pagehero__rule" aria-hidden="true" />
              {eyebrow}
            </p>
          )}
          <h1 className="bb-pagehero__title">{title}</h1>
          {description && <p className="bb-pagehero__desc">{description}</p>}
        </div>
        {children && <div className="bb-pagehero__aside">{children}</div>}
      </div>
    </section>
  );
}

export function HeroSearch({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="bb-herosearch">
      <Search className="bb-herosearch__icon" aria-hidden="true" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        type="search"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="bb-herosearch__input"
      />
    </div>
  );
}
