import { tr } from "@/lib/i18n";
import { Clock, HelpCircle, Mail } from "lucide-react";
import { Link } from "wouter";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";

export default function ContactPage() {
  return (
    <CustomerLayout
      active={null}
      hero={<PageHero eyebrow={tr("支援", "Support")} title={tr("聯絡客服", "Contact support")} description={tr("訂單、退款、帳號問題都可以來信，我們會盡快回覆。", "Reach out about orders, refunds, or your account — we'll get back to you as soon as we can.")} />}
    >
      <div className="py-4 md:py-8 space-y-12">
        {/* 大字信箱：本頁唯一重點 */}
        <section className="rounded-[2rem] md:rounded-[3rem] border border-ink bg-card px-6 py-12 md:px-14 md:py-20">
          <p className="flex items-center gap-3 text-xs font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-6">
            <Mail className="w-4 h-4" aria-hidden="true" /> {tr("客服信箱", "Support email")}
          </p>
          <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="font-heading font-semibold text-[clamp(28px,6vw,80px)] leading-none tracking-[-0.03em] break-all underline decoration-1 underline-offset-[0.15em] hover:decoration-2 hover:text-primary transition-colors">
            {PLATFORM_CONTACT_EMAIL}
          </a>
          <p className="mt-6 text-muted-foreground">
            {tr("來信請附上訂單編號或帳號 Email，能加快處理速度。", "Please include your order number or account email to help us respond faster.")}
          </p>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="flex items-start gap-4 rounded-[1.5rem] border border-ink bg-accent p-6">
            <Clock className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
            <span>{tr("目前是人工回覆，一般會在 1～2 個工作天內回信。", "Replies are currently handled manually — you can usually expect a response within 1–2 business days.")}</span>
          </div>
          <div className="flex items-start gap-4 rounded-[1.5rem] border border-ink bg-card p-6">
            <HelpCircle className="w-6 h-6 shrink-0 text-primary" aria-hidden="true" />
            <span className="text-muted-foreground">
              {tr("訂單、取消轉讓、未取餐限制等常見問題，先看看 ", "For common questions about orders, transfers, or pickup restrictions, check the ")}
              <Link href="/faq" className="text-foreground font-semibold underline underline-offset-4">{tr("常見問題", "FAQ")}</Link>
              {tr("，可能已經有答案。", " first — you might find your answer right away.")}
            </span>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
}
