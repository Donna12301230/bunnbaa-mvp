import { tr } from "@/lib/i18n";
import { Clock, HelpCircle, Mail } from "lucide-react";
import { Link } from "wouter";
import CustomerLayout from "@/components/CustomerLayout";
import PageHero from "@/components/PageHero";
import { PLATFORM_CONTACT_EMAIL } from "@/lib/subscription";

export default function ContactPage() {
  return (
    <CustomerLayout
      active={undefined}
      hero={<PageHero title={tr("聯絡客服", "Contact support")} description={tr("訂單、退款、帳號問題都可以來信，我們會盡快回覆。", "Reach out about orders, refunds, or your account — we'll get back to you as soon as we can.")} />}
    >
      <div className="max-w-xl mx-auto space-y-6">
        <div className="bg-white rounded-xl border border-border p-6 text-center space-y-3">
          <Mail className="w-8 h-8 text-orange-500 mx-auto" />
          <p className="text-sm text-muted-foreground">{tr("客服信箱", "Support email")}</p>
          <a href={`mailto:${PLATFORM_CONTACT_EMAIL}`} className="text-lg font-semibold text-orange-600 hover:underline">
            {PLATFORM_CONTACT_EMAIL}
          </a>
          <p className="text-xs text-muted-foreground">
            {tr("來信請附上訂單編號或帳號 Email，能加快處理速度。", "Please include your order number or account email to help us respond faster.")}
          </p>
        </div>

        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
          <Clock className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{tr("目前是人工回覆，一般會在 1～2 個工作天內回信。", "Replies are currently handled manually — you can usually expect a response within 1–2 business days.")}</span>
        </div>

        <div className="flex items-start gap-3 bg-white rounded-xl border border-border px-4 py-3 text-sm">
          <HelpCircle className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" />
          <span className="text-muted-foreground">
            {tr("訂單、取消轉讓、未取餐限制等常見問題，先看看 ", "For common questions about orders, transfers, or pickup restrictions, check the ")}
            <Link href="/faq" className="text-orange-600 hover:underline">{tr("常見問題", "FAQ")}</Link>
            {tr("，可能已經有答案。", " first — you might find your answer right away.")}
          </span>
        </div>
      </div>
    </CustomerLayout>
  );
}
