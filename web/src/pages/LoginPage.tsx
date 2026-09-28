import { useState } from "react";
import { tr } from "@/lib/i18n";
import { MemberNotice, VendorNotice } from "@/components/TermsNotices";
import { useLocation } from "wouter";
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
import type { ConfirmationResult } from "firebase/auth";
import TAIWAN_UNIV_DEPTS from "@/constants/taiwanUnivDepts.json";
import { Checkbox } from "@/components/ui/checkbox";
import { ShoppingBag, Clock, Tag, Store, Eye, EyeOff, Smartphone, Mail } from "lucide-react";

// Ported from BunnBaa Parse_Ref's client/src/pages/landing.tsx.
// 登入／註冊／忘記密碼接真正的 Firebase Auth（@/lib/auth），登入用 Email。
// 「帳號」欄位只當作沒填顯示名稱時的備用名稱。
export default function LoginPage() {
  // 共用登入欄位
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // 密碼顯示切換
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirm, setShowRegConfirm] = useState(false);
  const [showVendorPassword, setShowVendorPassword] = useState(false);
  const [showVendorConfirm, setShowVendorConfirm] = useState(false);

  // 會員註冊欄位
  const [regUsername, setRegUsername] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [school, setSchool] = useState("國立嘉義大學");
  const [department, setDepartment] = useState("");

  // 會員註冊流程
  const [memberAgreed, setMemberAgreed] = useState(false);
  const [memberStep, setMemberStep] = useState<"notice" | "form">("notice");

  // 廠商申請流程
  const [vendorAgreed, setVendorAgreed] = useState(false);
  const [vendorStep, setVendorStep] = useState<"notice" | "form">("notice");

  // 密碼重設
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  // 手機門號 OTP 登入（草圖兩段式流程：輸入號碼送驗證碼 -> 輸入驗證碼登入）
  const [loginMode, setLoginMode] = useState<"password" | "phone">("password");
  const [otpStage, setOtpStage] = useState<"phone" | "code">("phone");
  const [otpPhone, setOtpPhone] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpConfirmation, setOtpConfirmation] = useState<ConfirmationResult | null>(null);

  // 廠商申請欄位
  const [vendorEmail, setVendorEmail] = useState("");
  const [vendorPassword, setVendorPassword] = useState("");
  const [vendorConfirmPassword, setVendorConfirmPassword] = useState("");
  const [storeName, setStoreName] = useState("");
  const [vendorPhone, setVendorPhone] = useState("");

  const { toast } = useToast();
  const [, navigate] = useLocation();

  const loginMutation = useMutation({
    mutationFn: () => login(username, password),
    onSuccess: () => navigate("/"),
    onError: (err: Error) => toast({ variant: "destructive", title: tr("登入失敗", "Sign-in failed"), description: err.message }),
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
    onSuccess: () => navigate("/"),
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
      navigate("/");
    },
    onError: (err: Error) => toast({ variant: "destructive", title: tr("註冊失敗", "Sign-up failed"), description: err.message }),
  });

  const vendorRegisterMutation = useMutation({
    mutationFn: async () => {
      if (vendorPassword !== vendorConfirmPassword) throw new Error(tr("兩次輸入的密碼不一致", "Passwords don't match"));
      if (!storeName.trim()) throw new Error(tr("請填寫店家名稱", "Please enter a store name"));
      // 帳號先以 customer 角色建立並送出 vendor_applications/{uid}，管理員在
      // /admin/vendors 核准時把 vendors/{id}.owner_uid 綁到這個帳號後才會變成 vendor。
      return applyAsVendor({ email: vendorEmail, password: vendorPassword, storeName, phone: vendorPhone });
    },
    onSuccess: () => {
      toast({ title: tr("廠商申請已送出", "Application submitted"), description: tr("管理員審核通過後即可使用廠商後台。", "You can use the vendor portal once an admin approves it.") });
      navigate("/");
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
    <div className="min-h-screen bg-gradient-to-br from-orange-50 to-amber-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 items-start">

        {/* 左欄：品牌介紹 */}
        <div className="flex flex-col gap-6">
          {/* Logo */}
          <div>
            <img src="/飯飽R.png" alt="飯飽BunnBaa" className="h-56 md:h-96 mx-auto" />
          </div>

          {/* Feature list */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { icon: ShoppingBag, title: tr("線上預訂", "Order online"), desc: tr("輕鬆挑選、輕鬆下單", "Easy to browse and order") },
              { icon: Clock, title: tr("提前預訂", "Book ahead"), desc: tr("提前安排、省時省力", "Plan ahead, save time") },
              { icon: Tag, title: tr("早鳥優惠", "Early-bird deals"), desc: tr("越早訂購越划算", "The earlier, the cheaper") },
              { icon: Store, title: tr("多家廠商", "Many vendors"), desc: tr("周邊精選店家", "Hand-picked local spots") },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-3 bg-white rounded-xl p-3 shadow-sm">
                <div className="p-2 bg-orange-100 rounded-lg">
                  <Icon className="w-5 h-5 text-orange-500" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-gray-800">{title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{desc}</div>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">
            © 2026 {tr("赫滋與羊國際藝術有限公司", "Herz & Baa International Arts Co., Ltd.")}
          </p>
        </div>

        {/* 右欄：登入/註冊 */}
        <div>
          <Card className="shadow-xl border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-center text-xl">{tr("歡迎使用", "Welcome")}</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="login" className="flex-1">{tr("登入", "Sign in")}</TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">{tr("會員註冊", "Sign up")}</TabsTrigger>
                  <TabsTrigger value="vendor" className="flex-1">{tr("廠商申請", "Vendors")}</TabsTrigger>
                </TabsList>

                {/* Login */}
                <TabsContent value="login">
                  {loginMode === "password" ? (
                    <form onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(); }} className="space-y-3 max-w-xs mx-auto">
                      <div>
                        <Label>Email</Label>
                        <Input autoComplete="username" type="email" placeholder={tr("請輸入 Email", "Your email")} value={username} onChange={e => setUsername(e.target.value)} required />
                      </div>
                      <div>
                        <Label>{tr("密碼", "Password")}</Label>
                        <div className="relative mt-1">
                          <Input autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder={tr("請輸入密碼", "Your password")} value={password} onChange={e => setPassword(e.target.value)} required className="pr-11" />
                          <button type="button" aria-label={showPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowPassword(v => !v)}>
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
                        {isPendingLogin ? tr("登入中...", "Signing in...") : tr("登入", "Sign in")}
                      </Button>
                      {import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true" && (
                        <p className="text-center text-caption text-muted-foreground">
                          本機 emulator：測試帳號見 TODO.md「測試帳號」
                        </p>
                      )}
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
                            {isPendingSendOtp ? tr("傳送中...", "Sending...") : tr("取得驗證碼", "Get code")}
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
                            {isPendingConfirmOtp ? tr("驗證中...", "Verifying...") : tr("驗證並登入", "Verify & sign in")}
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
                  {/* invisible reCAPTCHA，手機 OTP 送驗證碼要用；一直掛著不影響畫面 */}
                  <div id="recaptcha-container" />
                </TabsContent>

                {/* 會員註冊 */}
                <TabsContent value="register">
                  {memberStep === "notice" ? (
                    <div className="space-y-4">
                      {/* 會員須知內容 */}
                      <div className="border rounded-lg p-4 bg-orange-50/50 space-y-3 max-h-80 overflow-y-auto text-sm text-gray-700 leading-relaxed">
                        <MemberNotice />
                      </div>

                      {/* 同意勾選 */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="member-agree"
                          checked={memberAgreed}
                          onCheckedChange={(v) => setMemberAgreed(v === true)}
                          className="mt-0.5"
                        />
                        <label htmlFor="member-agree" className="text-sm text-gray-700 cursor-pointer leading-snug">
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
                          <Input autoComplete="name" placeholder={tr("顯示給廠商的名字", "Name shown to vendors")} value={displayName} onChange={e => setDisplayName(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Email *</Label>
                        <Input autoComplete="email" type="email" placeholder={tr("電子信箱", "Email address")} value={regEmail} onChange={e => setRegEmail(e.target.value)} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{tr("密碼 *", "Password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegPassword ? "text" : "password"} placeholder={tr("至少 6 位", "At least 6 characters")} value={regPassword} onChange={e => setRegPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showRegPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showRegPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegPassword(v => !v)}>
                              {showRegPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>{tr("確認密碼 *", "Confirm password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegConfirm ? "text" : "password"} placeholder={tr("再輸入一次", "Enter it again")} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showRegConfirm ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showRegConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegConfirm(v => !v)}>
                              {showRegConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label>{tr("手機號碼", "Phone number")}</Label>
                        <Input autoComplete="tel" placeholder="09xx-xxx-xxx" value={phone} onChange={e => setPhone(e.target.value)} />
                      </div>

                      {/* 學籍資料群組 */}
                      <div className="border rounded-lg p-3 space-y-3 bg-orange-50/50">
                        <p className="text-xs font-semibold text-orange-700">{tr("我是學生（選填）", "I'm a student (optional)")}</p>
                        <div>
                          <Label>{tr("學校", "School")}</Label>
                          <Select value={school} onValueChange={v => { setSchool(v); setDepartment(""); }}>
                            <SelectTrigger>
                              <SelectValue placeholder={tr("選擇學校", "Choose a school")} />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.keys(TAIWAN_UNIV_DEPTS).map(u => (
                                <SelectItem key={u} value={u}>{u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>{tr("科系", "Department")}</Label>
                          {(TAIWAN_UNIV_DEPTS as Record<string, string[]>)[school]?.length > 0 ? (
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
                        {isPendingReg ? tr("註冊中...", "Signing up...") : tr("立即註冊", "Sign up")}
                      </Button>
                    </form>
                  )}
                </TabsContent>

                {/* 廠商申請 */}
                <TabsContent value="vendor">
                  {vendorStep === "notice" ? (
                    <div className="space-y-4">
                      {/* 須知內容 */}
                      <div className="border rounded-lg p-4 bg-amber-50/50 space-y-3 max-h-80 overflow-y-auto text-sm text-gray-700 leading-relaxed">
                        <VendorNotice />
                      </div>

                      {/* 同意勾選 */}
                      <div className="flex items-start gap-2">
                        <Checkbox
                          id="vendor-agree"
                          checked={vendorAgreed}
                          onCheckedChange={(v) => setVendorAgreed(v === true)}
                          className="mt-0.5"
                        />
                        <label htmlFor="vendor-agree" className="text-sm text-gray-700 cursor-pointer leading-snug">
                          {tr("我已詳細閱讀並同意上述廠商申請須知及相關服務條款", "I have read and agree to the vendor terms above")}
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
                      <div className="border rounded-lg p-3 space-y-3 bg-amber-50/50">
                        <p className="text-xs font-semibold text-amber-700">{tr("店家資訊", "Store details")}</p>
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
                        <Input autoComplete="username" type="email" placeholder={tr("電子信箱", "Email address")} value={vendorEmail} onChange={e => setVendorEmail(e.target.value)} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>{tr("密碼 *", "Password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorPassword ? "text" : "password"} placeholder={tr("至少 6 位", "At least 6 characters")} value={vendorPassword} onChange={e => setVendorPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showVendorPassword ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showVendorPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorPassword(v => !v)}>
                              {showVendorPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>{tr("確認密碼 *", "Confirm password *")}</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorConfirm ? "text" : "password"} placeholder={tr("再輸入一次", "Enter it again")} value={vendorConfirmPassword} onChange={e => setVendorConfirmPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showVendorConfirm ? tr("隱藏密碼", "Hide password") : tr("顯示密碼", "Show password")} aria-pressed={showVendorConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorConfirm(v => !v)}>
                              {showVendorConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingVendor}>
                        {isPendingVendor ? tr("申請中...", "Submitting...") : tr("申請成為廠商", "Apply as a vendor")}
                      </Button>
                    </form>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

      </div>

      {/* 密碼重設 Dialog */}
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
                onChange={e => setResetEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>{tr("取消", "Cancel")}</Button>
            <Button
              
              disabled={!resetEmail.trim() || resetPasswordMutation.isPending}
              onClick={() => resetPasswordMutation.mutate(resetEmail.trim())}
            >
              {resetPasswordMutation.isPending ? tr("寄送中...", "Sending...") : tr("寄送重設信", "Send reset email")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
