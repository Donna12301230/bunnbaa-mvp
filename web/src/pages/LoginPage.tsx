import { useEffect, useState } from "react";
import { getLang, tr } from "@/lib/i18n";
import { MemberNotice, VendorNotice } from "@/components/TermsNotices";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { login, register, applyAsVendor, requestPasswordReset, sendOtp, confirmOtp } from "@/lib/auth";
import { useAuth } from "@/hooks/useAuth";
import { takeReturnPath } from "@/lib/returnPath";
import { demoAccounts, type DemoAccount } from "@/lib/demoAccounts";
import type { ConfirmationResult } from "firebase/auth";
import TAIWAN_UNIV_DEPTS from "@/constants/taiwanUnivDepts.json";
import { UNIV_EN } from "@/constants/taiwanUnivEn";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingBag, Clock, Tag, Store, Eye, EyeOff, Smartphone, Mail, ShieldCheck, UserRound, Zap } from "lucide-react";

// Ported from BunnBaa Parse_Ref's client/src/pages/landing.tsx.
// Sign-in / sign-up / forgot password use real Firebase Auth (@/lib/auth); sign-in is by email.
// The "Account" field is only a fallback name when no display name is given.
/** Emails never contain whitespace: drop it as typed or pasted, so a stray space can't break sign-in */
const noSpaces = (value: string) => value.replace(/\s+/g, "");

export default function LoginPage() {
  // Shared sign-in fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // Password visibility toggle
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [showVendorPassword, setShowVendorPassword] = useState(false);
  const [showVendorConfirm, setShowVendorConfirm] = useState(false);

  // Member sign-up fields
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [school, setSchool] = useState("國立嘉義大學");
  const [department, setDepartment] = useState("");

  // Member sign-up flow
  const [memberAgreed, setMemberAgreed] = useState(false);
  const [memberStep, setMemberStep] = useState<"notice" | "form">("notice");

  // Vendor application flow
  const [vendorAgreed, setVendorAgreed] = useState(false);
  const [vendorStep, setVendorStep] = useState<"notice" | "form">("notice");

  // Password reset
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  // Phone OTP sign-in (two-step flow from the mockup: enter number to send code -> enter code to sign in)
  const [loginMode, setLoginMode] = useState<"password" | "phone">("password");
  const [otpStage, setOtpStage] = useState<"phone" | "code">("phone");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpConfirmation, setOtpConfirmation] = useState<ConfirmationResult | null>(null);

  // Vendor application fields
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorPassword, setVendorPassword] = useState("");
  const [vendorConfirmPassword, setVendorConfirmPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");

  const { toast } = useToast();
  const [, navigate] = useLocation();
  // After sign-in, wait for the profile (role) to load before redirecting: go back to the page before sign-in (lib/returnPath); otherwise
  // vendor accounts go to the vendor portal and everyone else to today's menu
  const { user, isLoading: authLoading } = useAuth();
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    if (!signedIn || authLoading || !user) return;
    const back = takeReturnPath();
    if (user.role === "vendor") navigate(back?.startsWith("/vendor-portal") || back?.startsWith("/lock/vendor") ? back : "/vendor-portal/dashboard");
    // The read-only demo admin is only here to look around the admin backend, so take it straight there
    else if (user.readOnlyAdmin) navigate(back ?? "/admin/vendors");
    else navigate(back ?? "/home");
  }, [signedIn, authLoading, user?.id, user?.role, user?.readOnlyAdmin]);

  const loginMutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: () => setSignedIn(true),
    onError: (err: Error) => toast({ variant: "destructive", title: tr("登入失敗", "Sign-in failed"), description: err.message }),
  });

  // Demo-account one-click sign-in (lib/demoAccounts.ts): same path as a normal sign-in, then redirects by role
  const demoLoginMutation = useMutation({
    mutationFn: (account: DemoAccount) => login(account.email, account.password),
    onSuccess: () => setSignedIn(true),
    onError: (err: Error) => toast({ variant: "destructive", title: tr("體驗帳號登入失敗", "Demo sign-in failed"), description: err.message }),
  });

  const sendOtpMutation = useMutation({
    mutationFn: () => sendOtp(otpPhone, "recaptcha-container"),
    onSuccess: (confirmation) => {
      setOtpConfirmation(confirmation);
      setOtpStage("code");
      setOtpCode("");
      toast({ title: tr("驗證碼已送出", "Code sent"), description: tr("請查看簡訊訊息", "Check your text messages") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("傳送失敗", "Couldn't send the code"), description: err.message }),
  });

  const confirmOtpMutation = useMutation({
    mutationFn: () => {
      if (!otpConfirmation) throw new Error(tr("請先取得驗證碼", "Request a verification code first"));
      return confirmOtp(otpConfirmation, otpCode);
    },
    onSuccess: () => setSignedIn(true),
    onError: (err: Error) => toast({ variant: "destructive", title: tr("驗證失敗", "Verification failed"), description: err.message }),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (regPassword !== confirmPassword) throw new Error(tr("兩次輸入的密碼不一致", "Passwords don't match"));
      return register({
        email: regEmail,
        password: regPassword,
        displayName: displayName.trim() || regUsername.trim(),
        phone,
        school,
        department,
      });
    },
    onSuccess: () => {
      toast({ title: tr("註冊成功", "You're signed up"), description: tr("歡迎加入 飯飽BunnBaa！", "Welcome to BunnBaa!") });
      setSignedIn(true);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("註冊失敗", "Sign-up failed"), description: err.message }),
  });

  const vendorRegisterMutation = useMutation({
    mutationFn: async () => {
      if (vendorPassword !== vendorConfirmPassword) throw new Error(tr("兩次輸入的密碼不一致", "Passwords don't match"));
      if (!storeName.trim()) throw new Error(tr("請填寫店家名稱", "Please enter a store name"));
      // The account is first created with the customer role and vendor_applications/{uid} is submitted; it only becomes
      // a vendor once an admin approves it at /admin/vendors and binds vendors/{id}.owner_uid to this account.
      return applyAsVendor({ email: vendorEmail, password: vendorPassword, storeName, phone: vendorPhone });
    },
    onSuccess: () => {
      toast({ title: tr("店家申請已送出", "Application submitted"), description: tr("管理員審核通過後即可使用店家後台。", "You can use the vendor portal once an admin approves it.") });
      navigate("/home");
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("申請失敗", "Application failed"), description: err.message }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
    onSuccess: () => {
      setResetDialogOpen(false);
      setResetEmail("");
      toast({ title: tr("重設信已寄出", "Reset email sent"), description: tr("請至您的信箱收取密碼重設連結（若未收到，請確認 Email 是否正確）。", "Check your inbox for the reset link (if it doesn't arrive, make sure the email is correct).") });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("寄送失敗", "Couldn't send"), description: err.message }),
  });

  const isPendingLogin = loginMutation.isPending;
  const isPendingSendOtp = sendOtpMutation.isPending;
  const isPendingConfirmOtp = confirmOtpMutation.isPending;
  const isPendingReg = registerMutation.isPending;
  const isPendingVendor = vendorRegisterMutation.isPending;

  return (
    <div className="min-h-screen bg-background px-3 py-3 md:px-6 md:py-6">
      <div className="mx-auto max-w-[1200px] grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-16 items-center lg:min-h-[calc(100vh-3rem)]">

        {/* Left column: brand intro, keeping the original big-logo style (cream background + centered logo + four feature cards) */}
        <div className="flex flex-col gap-8 py-4 md:py-8">
          <Link href="/" className="inline-flex items-center gap-1.5 w-fit text-sm font-semibold text-muted-foreground hover:text-foreground rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            ← {tr("回首頁", "Back home")}
          </Link>

          <img
            src="/飯飽R.png"
            alt={tr("飯飽 BunnBaa：越早訂，越開心。", "BunnBaa: Book early, eat happy.")}
            className="w-full max-w-[220px] md:max-w-[380px] h-auto mx-auto animate-[bb-page-in_900ms_cubic-bezier(0.16,1,0.3,1)_both] motion-reduce:animate-none"
          />

          {/* Feature list */}
          <ul className="grid grid-cols-2 gap-3 md:gap-4 max-w-[560px] w-full mx-auto">
            {[
              { icon: ShoppingBag, title: tr("線上預訂", "Order online"), desc: tr("輕鬆挑選、輕鬆下單", "Easy to browse and order") },
              { icon: Clock, title: tr("提前預訂", "Book ahead"), desc: tr("提前安排、省時省力", "Plan ahead, save time") },
              { icon: Tag, title: tr("早鳥優惠", "Early-bird deals"), desc: tr("越早訂購越划算", "The earlier, the cheaper") },
              { icon: Store, title: tr("多家合作店家", "Many vendors"), desc: tr("周邊精選店家", "Hand-picked local spots") },
            ].map(({ icon: Icon, title, desc }) => (
              <li key={title} className="flex items-start gap-3 bg-card rounded-2xl border border-ink p-3 md:p-4">
                <span className="hidden sm:flex w-10 h-10 shrink-0 rounded-full bg-secondary border border-ink items-center justify-center">
                  <Icon className="w-5 h-5" aria-hidden="true" />
                </span>
                <div>
                  <div className="font-semibold text-sm">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </li>
            ))}
          </ul>

          <p className="text-xs text-muted-foreground max-w-[560px] w-full mx-auto">
            © 2026 {tr("赫滋與羊國際藝術有限公司", "Herz & Baa International Arts Co., Ltd.")}
          </p>
        </div>

        {/* Right column: sign-in / sign-up */}
        <div className="flex items-center">
          <Card className="w-full rounded-card border border-ink shadow-none bg-card md:p-4">
            <CardHeader className="pb-2">
              <CardTitle className="text-center font-heading text-[clamp(32px,4vw,48px)] font-semibold">{tr("歡迎使用", "Welcome")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="login" className="flex-1">{tr("登入", "Sign in")}</TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">{tr("會員註冊", "Sign up")}</TabsTrigger>
                  <TabsTrigger value="vendor" className="flex-1">{tr("店家申請", "Vendor application")}</TabsTrigger>
                </TabsList>

                {/* Login */}
                <TabsContent value="login">
                  {loginMode === "password" ? (
                    <form onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(); }} className="space-y-3 max-w-xs mx-auto">
                      <div>
                        <Label>Email</Label>
                        <Input autoComplete="username" type="email" placeholder={tr("請輸入 Email", "Your email")} value={username} onChange={e => setUsername(noSpaces(e.target.value))} required />
                      </div>
                      <div>
                        <Label>{tr("密碼", "Password")}</Label>
                        <div className="relative mt-1">
                          <Input autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder={tr("請輸入密碼", "Your password")} value={password} onChange={e => setPassword(e.target.value.trimStart())} onBlur={e => setPassword(e.target.value.trim())} required className="pr-11" />
                          <button type="button" aria-label={showPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowPassword(v => !v)}>
                            {showPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                          </button>
                        </div>
                      </div>
                      <div className="text-right -mt-1">
                        <Button
                          type="button"
                          variant="link"
                          className="h-auto px-0 text-caption"
                          onClick={() => { setResetEmail(""); setResetDialogOpen(true); }}
                        >
                          {tr("忘記密碼？", "Forgot password?")}
                        </Button>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingLogin}>
                        {isPendingLogin ? tr("登入中…", "Signing in…") : tr("登入", "Sign in")}
                      </Button>
                      <Button
                        type="button"
                        variant="link"
                        className="w-full h-auto text-caption"
                        onClick={() => { setLoginMode("phone"); setOtpStage("phone"); setOtpConfirmation(null); }}
                      >
                        <Smartphone className="w-3.5 h-3.5 mr-1" /> {tr("改用手機門號登入", "Sign in with phone number")}
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-3 max-w-xs mx-auto">
                      {otpStage === "phone" ? (
                        <form onSubmit={(e) => { e.preventDefault(); sendOtpMutation.mutate(); }} className="space-y-3">
                          <div>
                            <Label>{tr("手機號碼", "Phone number")}</Label>
                            <Input
                              autoComplete="tel"
                              type="tel"
                              placeholder="0912345678"
                              value={otpPhone}
                              onChange={e => setOtpPhone(e.target.value)}
                              required
                            />
                          </div>
                          <Button type="submit" className="w-full" disabled={isPendingSendOtp}>
                            {isPendingSendOtp ? tr("傳送中…", "Sending…") : tr("取得驗證碼", "Get code")}
                          </Button>
                        </form>
                      ) : (
                        <form onSubmit={(e) => { e.preventDefault(); confirmOtpMutation.mutate(); }} className="space-y-3">
                          <div>
                            <Label>{tr("驗證碼", "Verification code")}</Label>
                            <Input
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              placeholder={tr("請輸入簡訊收到的 6 碼", "Enter the 6-digit code")}
                              value={otpCode}
                              onChange={e => setOtpCode(e.target.value)}
                              required
                            />
                            <p className="text-caption text-muted-foreground mt-1">{tr("已發送到", "Sent to")} {otpPhone}</p>
                          </div>
                          <Button type="submit" className="w-full" disabled={isPendingConfirmOtp}>
                            {isPendingConfirmOtp ? tr("驗證中…", "Verifying…") : tr("驗證並登入", "Verify & sign in")}
                          </Button>
                          <Button
                            type="button"
                            variant="link"
                            className="w-full h-auto text-caption"
                            onClick={() => { setOtpStage("phone"); setOtpConfirmation(null); }}
                          >
                            {tr("重新輸入手機號碼", "Use a different number")}
                          </Button>
                        </form>
                      )}
                      <Button
                        type="button"
                        variant="link"
                        className="w-full h-auto text-caption"
                        onClick={() => setLoginMode("password")}
                      >
                        <Mail className="w-3.5 h-3.5 mr-1" /> {tr("改用 Email 登入", "Sign in with email")}
                      </Button>
                    </div>
                  )}
                  {/* Invisible reCAPTCHA, needed to send the phone OTP code; always mounted, it doesn't affect the layout */}
                  <div id="recaptcha-container" />
                  {/* Demo accounts: one click signs in, no registration needed (the accounts are shared; see lib/demoAccounts.ts) */}
                  <div className="mt-5 max-w-xs mx-auto border-t border-border pt-4">
                    <p className="flex items-center justify-center gap-1.5 text-sm font-semibold">
                      <Zap className="w-4 h-4 text-brand" aria-hidden="true" /> {tr("體驗帳號，點一下直接登入", "Demo accounts — one tap to sign in")}
                    </p>
                    <div className="mt-2 grid gap-2">
                      {demoAccounts().map((account) => {
                        const Icon = account.key === "vendor" ? Store : account.key === "admin" ? ShieldCheck : UserRound;
                        const busy = demoLoginMutation.isPending && demoLoginMutation.variables?.key === account.key;
                        return (
                          <Button key={account.key} type="button" variant="outline" className="h-auto w-full justify-start gap-3 px-3 py-2 text-left"
                            disabled={demoLoginMutation.isPending || isPendingLogin} onClick={() => demoLoginMutation.mutate(account)}>
                            <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block text-sm font-semibold">{busy ? tr("登入中…", "Signing in…") : tr(`以${account.label}身分體驗`, `Try it as ${/^[aeiou]/i.test(account.label) ? "an" : "a"} ${account.label.toLowerCase()}`)}</span>
                              <span className="block truncate text-caption font-normal text-muted-foreground">{account.hint}</span>
                            </span>
                          </Button>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-center text-caption text-muted-foreground">{tr("體驗帳號是公開共用的，請不要填寫真實個人資料。", "Demo accounts are shared and public — please don't enter real personal details.")}</p>
                  </div>
                </TabsContent>

                {/* Member sign-up */}
                <TabsContent value="register">
                  {memberStep === "notice" ? (
                    <div className="space-y-4">
                      {/* Member terms */}
                      <div className="border rounded-lg p-4 bg-accent/50 space-y-3 max-h-80 overflow-y-auto text-sm text-foreground leading-relaxed">
                        <MemberNotice />
                      </div>

                      {/* Consent checkbox */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="member-agree"
                          checked={memberAgreed}
                          onCheckedChange={(v) => setMemberAgreed(v === true)}
                          className="mt-0.5"
                        />
                        <label htmlFor="member-agree" className="text-sm text-foreground cursor-pointer leading-snug">
                          {tr("我已詳細閱讀並同意上述會員服務須知及相關條款", "I have read and agree to the member terms above")}
                        </label>
                      </div>

                      <Button
                        className="w-full"
                        disabled={!memberAgreed}
                        onClick={() => setMemberStep("form")}
                      >
                        {tr("同意並繼續填寫註冊資料", "Agree and continue")}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); registerMutation.mutate(); }} className="space-y-3">
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto px-0 text-caption"
                        onClick={() => setMemberStep("notice")}
                      >
                        {tr("← 返回會員須知", "← Back to terms")}
                      </Button>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{tr("帳號 *", "Username *")}</Label>
                          <Input autoComplete="username" placeholder={tr("登入用帳號", "For signing in")} value={regUsername} onChange={e => setRegUsername(e.target.value)} required />
                        </div>
                        <div>
                          <Label>{tr("顯示名稱", "Display name")}</Label>
                          <Input autoComplete="name" placeholder={tr("顯示給店家的名字", "Name shown to vendors")} value={displayName} onChange={e => setDisplayName(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Email *</Label>
                        <Input autoComplete="email" type="email" placeholder={tr("電子信箱", "Email address")} value={regEmail} onChange={e => setRegEmail(noSpaces(e.target.value))} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{tr("密碼 *", "Password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegPassword ? "text" : "password"} placeholder={tr("至少 6 位", "At least 6 characters")} value={regPassword} onChange={e => setRegPassword(e.target.value.trimStart())} onBlur={e => setRegPassword(e.target.value.trim())} required className="pr-11" />
                            <button type="button" aria-label={showRegPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showRegPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegPassword(v => !v)}>
                              {showRegPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>{tr("確認密碼 *", "Confirm password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegConfirm ? "text" : "password"} placeholder={tr("再輸入一次", "Enter it again")} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value.trimStart())} onBlur={e => setConfirmPassword(e.target.value.trim())} required className="pr-11" />
                            <button type="button" aria-label={showRegConfirm ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showRegConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegConfirm(v => !v)}>
                              {showRegConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label>{tr("手機號碼", "Phone number")}</Label>
                        <Input autoComplete="tel" placeholder="09xx-xxx-xxx" value={phone} onChange={e => setPhone(e.target.value)} />
                      </div>

                      {/* Student info group */}
                      <div className="border rounded-lg p-3 space-y-3 bg-accent/50">
                        <p className="text-xs font-semibold text-accent-foreground">{tr("我是學生（選填）", "I'm a student (optional)")}</p>
                        <div>
                          <Label>{tr("學校", "School")}</Label>
                          <Select value={school} onValueChange={v => { setSchool(v); setDepartment(""); }}>
                            <SelectTrigger>
                              <SelectValue placeholder={tr("選擇學校", "Choose a school")} />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.keys(TAIWAN_UNIV_DEPTS).map(u => (
                                <SelectItem key={u} value={u}>{tr(u, UNIV_EN[u] ?? u)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>{tr("科系", "Department")}</Label>
                          {/* The department list is Chinese only (5,000+ names), so the English UI types the department instead */}
                          {getLang() !== "en" && (TAIWAN_UNIV_DEPTS as Record<string, string[]>)[school]?.length > 0 ? (
                            <Select value={department} onValueChange={setDepartment}>
                              <SelectTrigger>
                                <SelectValue placeholder={tr("選擇科系", "Choose a department")} />
                              </SelectTrigger>
                              <SelectContent>
                                {((TAIWAN_UNIV_DEPTS as Record<string, string[]>)[school] ?? []).map(dept => (
                                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input placeholder={tr("科系名稱（選填）", "Department (optional)")} value={department} onChange={e => setDepartment(e.target.value)} />
                          )}
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingReg}>
                        {isPendingReg ? tr("註冊中…", "Signing up…") : tr("立即註冊", "Sign up")}
                      </Button>
                    </form>
                  )}
                </TabsContent>

                {/* Vendor application */}
                <TabsContent value="vendor">
                  {vendorStep === "notice" ? (
                    <div className="space-y-4">
                      {/* Terms */}
                      <div className="border rounded-lg p-4 bg-warning-soft/50 space-y-3 max-h-80 overflow-y-auto text-sm text-foreground leading-relaxed">
                        <VendorNotice />
                      </div>

                      {/* Consent checkbox */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="vendor-agree"
                          checked={vendorAgreed}
                          onCheckedChange={(v) => setVendorAgreed(v === true)}
                          className="mt-0.5"
                        />
                        <label htmlFor="vendor-agree" className="text-sm text-foreground cursor-pointer leading-snug">
                          {tr("我已詳細閱讀並同意上述店家申請須知及相關服務條款", "I have read and agree to the vendor terms above")}
                        </label>
                      </div>

                      <Button
                        className="w-full"
                        disabled={!vendorAgreed}
                        onClick={() => setVendorStep("form")}
                      >
                        {tr("同意並繼續填寫申請資料", "Agree and continue")}
                      </Button>
                    </div>
                  ) : (
                    <form onSubmit={(e) => { e.preventDefault(); vendorRegisterMutation.mutate(); }} className="space-y-3">
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto px-0 text-caption"
                        onClick={() => setVendorStep("notice")}
                      >
                        {tr("← 返回申請須知", "← Back to terms")}
                      </Button>
                      <div className="border rounded-lg p-3 space-y-3 bg-warning-soft/50">
                        <p className="text-xs font-semibold text-warning-text">{tr("店家資訊", "Store details")}</p>
                        <div>
                          <Label>{tr("店家名稱 *", "Store name *")}</Label>
                          <Input placeholder={tr("例：王媽媽便當", "e.g. Mama Wang's Bento")} value={storeName} onChange={e => setStoreName(e.target.value)} required />
                        </div>
                        <div>
                          <Label>{tr("聯絡電話", "Phone")}</Label>
                          <Input autoComplete="tel" placeholder="05x-xxx-xxxx" value={vendorPhone} onChange={e => setVendorPhone(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>{tr("Email *（登入用）", "Email * (for signing in)")}</Label>
                        <Input autoComplete="username" type="email" placeholder={tr("電子信箱", "Email address")} value={vendorEmail} onChange={e => setVendorEmail(noSpaces(e.target.value))} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{tr("密碼 *", "Password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorPassword ? "text" : "password"} placeholder={tr("至少 6 位", "At least 6 characters")} value={vendorPassword} onChange={e => setVendorPassword(e.target.value.trimStart())} onBlur={e => setVendorPassword(e.target.value.trim())} required className="pr-11" />
                            <button type="button" aria-label={showVendorPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showVendorPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorPassword(v => !v)}>
                              {showVendorPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>{tr("確認密碼 *", "Confirm password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorConfirm ? "text" : "password"} placeholder={tr("再輸入一次", "Enter it again")} value={vendorConfirmPassword} onChange={e => setVendorConfirmPassword(e.target.value.trimStart())} onBlur={e => setVendorConfirmPassword(e.target.value.trim())} required className="pr-11" />
                            <button type="button" aria-label={showVendorConfirm ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showVendorConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorConfirm(v => !v)}>
                              {showVendorConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingVendor}>
                        {isPendingVendor ? tr("申請中…", "Submitting…") : tr("申請成為店家", "Apply as a vendor")}
                      </Button>
                    </form>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

      </div>

      {/* Password reset dialog */}
      <Dialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{tr("重設密碼", "Reset password")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              {tr("請輸入您註冊時使用的 Email，我們將寄送密碼重設連結。", "Enter the email you signed up with and we'll send you a reset link.")}
            </p>
            <div>
              <Label>{tr("電子信箱", "Email address")}</Label>
              <Input
                className="mt-1"
                type="email"
                placeholder="example@mail.com"
                value={resetEmail}
                onChange={e => setResetEmail(noSpaces(e.target.value))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button
              
              disabled={!resetEmail.trim() || resetPasswordMutation.isPending}
              onClick={() => resetPasswordMutation.mutate(resetEmail.trim())}
            >
              {resetPasswordMutation.isPending ? tr("寄送中…", "Sending…") : tr("寄送重設信", "Send reset email")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
