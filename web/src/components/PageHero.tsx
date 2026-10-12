import { ReactNode } from "react";
import { Search } from "lucide-react";
import "./PageHero.css";

// Page header shared by tabs (Resale market / My meals / Vendors / Growth rewards / About us / FAQ / Contact / Join us).
// 2026-10-01 site redesign: same editorial vocabulary as the brand page — small eyebrow, large serif title,
// cream background with a slowly morphing butter-yellow blob; children on the right is usually HeroSearch.
export default function PageHero({
  title,
  description,
  eyebrow,
  children,
}: {
  title: string;
  description?: ReactNode;
  /** Small label above the title (e.g. "Transfers"); hidden if not given */
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
