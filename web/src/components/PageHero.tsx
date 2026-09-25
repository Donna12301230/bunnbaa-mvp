import { ReactNode } from "react";
import { Search } from "lucide-react";

// 抽自 TransferMarketPage 的頁首橫幅——轉讓市集／我的餐點／商家三個分頁共用，
// 底色是 logo「飯」字色（--brand-rice）。右側 children 通常放 HeroSearch。
export default function PageHero({
  title,
  description,
  children,
}: {
  title: string;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="bg-rice px-4 md:px-6 py-10">
      <div className="max-w-[1400px] mx-auto flex items-center justify-between gap-6 flex-wrap">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-rice-foreground mb-1.5">{title}</h1>
          {description && <p className="text-sm text-rice-foreground">{description}</p>}
        </div>
        {children}
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
    <div className="flex items-center gap-2 bg-white rounded-xl p-1.5 pl-4 min-w-[300px]">
      <Search className="w-4 h-4 text-gray-400 shrink-0" />
      <label htmlFor={id} className="sr-only">{label}</label>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 border-none outline-none bg-transparent text-sm py-2"
      />
    </div>
  );
}
