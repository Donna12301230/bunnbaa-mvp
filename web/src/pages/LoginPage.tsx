import { useState } from "react";
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
    onError: (err: Error) => toast({ variant: "destructive", title: "登入失敗", description: err.message }),
  });

  const sendOtpMutation = useMutation({
    mutationFn: () => sendOtp(otpPhone, "recaptcha-container"),
    onSuccess: (confirmation) => {
      setOtpConfirmation(confirmation);
      setOtpStage("code");
      setOtpCode("");
      toast({ title: "驗證碼已送出", description: "請查看簡訊訊息" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "傳送失敗", description: err.message }),
  });

  const confirmOtpMutation = useMutation({
    mutationFn: () => {
      if (!otpConfirmation) throw new Error("請先取得驗證碼");
      return confirmOtp(otpConfirmation, otpCode);
    },
    onSuccess: () => navigate("/"),
    onError: (err: Error) => toast({ variant: "destructive", title: "驗證失敗", description: err.message }),
  });

  const registerMutation = useMutation({
    mutationFn: async () => {
      if (regPassword !== confirmPassword) throw new Error("兩次輸入的密碼不一致");
      return register({
        email: regEmail,
        password: regPassword,
        displayName: displayName || regUsername,
        phone,
        school,
        department,
      });
    },
    onSuccess: () => {
      toast({ title: "註冊成功", description: "歡迎加入 飯飽BunnBaa！" });
      navigate("/");
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "註冊失敗", description: err.message }),
  });

  const vendorRegisterMutation = useMutation({
    mutationFn: async () => {
      if (vendorPassword !== vendorConfirmPassword) throw new Error("兩次輸入的密碼不一致");
      if (!storeName.trim()) throw new Error("請填寫店家名稱");
      // 帳號先以 customer 角色建立並送出 vendor_applications/{uid}，管理員在
      // /admin/vendors 核准時把 vendors/{id}.owner_uid 綁到這個帳號後才會變成 vendor。
      return applyAsVendor({ email: vendorEmail, password: vendorPassword, storeName, phone: vendorPhone });
    },
    onSuccess: () => {
      toast({ title: "廠商申請已送出", description: "管理員審核通過後即可使用廠商後台。" });
      navigate("/");
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "申請失敗", description: err.message }),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (email: string) => requestPasswordReset(email),
    onSuccess: () => {
      setResetDialogOpen(false);
      setResetEmail("");
      toast({ title: "重設信已寄出", description: "請至您的信箱收取密碼重設連結（若未收到，請確認 Email 是否正確）。" });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "寄送失敗", description: err.message }),
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
              { icon: ShoppingBag, title: "線上預訂", desc: "輕鬆挑選、輕鬆下單" },
              { icon: Clock, title: "提前預訂", desc: "提前安排、省時省力" },
              { icon: Tag, title: "早鳥優惠", desc: "越早訂購越划算" },
              { icon: Store, title: "多家廠商", desc: "周邊精選店家" },
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
            © 2026 赫滋與羊國際藝術有限公司
          </p>
        </div>

        {/* 右欄：登入/註冊 */}
        <div>
          <Card className="shadow-xl border-0">
            <CardHeader className="pb-2">
              <CardTitle className="text-center text-xl">歡迎使用</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="login">
                <TabsList className="w-full mb-4">
                  <TabsTrigger value="login" className="flex-1">登入</TabsTrigger>
                  <TabsTrigger value="register" className="flex-1">會員註冊</TabsTrigger>
                  <TabsTrigger value="vendor" className="flex-1">廠商申請</TabsTrigger>
                </TabsList>

                {/* Login */}
                <TabsContent value="login">
                  {loginMode === "password" ? (
                    <form onSubmit={(e) => { e.preventDefault(); loginMutation.mutate(); }} className="space-y-3 max-w-xs mx-auto">
                      <div>
                        <Label>Email</Label>
                        <Input autoComplete="username" type="email" placeholder="請輸入 Email" value={username} onChange={e => setUsername(e.target.value)} required />
                      </div>
                      <div>
                        <Label>密碼</Label>
                        <div className="relative mt-1">
                          <Input autoComplete="current-password" type={showPassword ? "text" : "password"} placeholder="請輸入密碼" value={password} onChange={e => setPassword(e.target.value)} required className="pr-11" />
                          <button type="button" aria-label={showPassword ? "隱藏密碼" : "顯示密碼"} aria-pressed={showPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowPassword(v => !v)}>
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
                          忘記密碼？
                        </Button>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingLogin}>
                        {isPendingLogin ? "登入中..." : "登入"}
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
                        <Smartphone className="w-3.5 h-3.5 mr-1" /> 改用手機門號登入
                      </Button>
                    </form>
                  ) : (
                    <div className="space-y-3 max-w-xs mx-auto">
                      {otpStage === "phone" ? (
                        <form onSubmit={(e) => { e.preventDefault(); sendOtpMutation.mutate(); }} className="space-y-3">
                          <div>
                            <Label>手機號碼</Label>
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
                            {isPendingSendOtp ? "傳送中..." : "取得驗證碼"}
                          </Button>
                        </form>
                      ) : (
                        <form onSubmit={(e) => { e.preventDefault(); confirmOtpMutation.mutate(); }} className="space-y-3">
                          <div>
                            <Label>驗證碼</Label>
                            <Input
                              autoComplete="one-time-code"
                              inputMode="numeric"
                              placeholder="請輸入簡訊收到的 6 碼"
                              value={otpCode}
                              onChange={e => setOtpCode(e.target.value)}
                              required
                            />
                            <p className="text-caption text-muted-foreground mt-1">已發送到 {otpPhone}</p>
                          </div>
                          <Button type="submit" className="w-full" disabled={isPendingConfirmOtp}>
                            {isPendingConfirmOtp ? "驗證中..." : "驗證並登入"}
                          </Button>
                          <Button
                            type="button"
                            variant="link"
                            className="w-full h-auto text-caption"
                            onClick={() => { setOtpStage("phone"); setOtpConfirmation(null); }}
                          >
                            重新輸入手機號碼
                          </Button>
                        </form>
                      )}
                      <Button
                        type="button"
                        variant="link"
                        className="w-full h-auto text-caption"
                        onClick={() => setLoginMode("password")}
                      >
                        <Mail className="w-3.5 h-3.5 mr-1" /> 改用 Email 登入
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
                        <p className="font-bold text-orange-800 text-base">會員服務須知</p>
                        <p className="font-semibold">一、會員資格</p>
                        <p>凡完成會員註冊程序並同意本須知者，即取得飯飽 BunnBaa 會員資格，享有線上瀏覽菜單、下單訂餐等服務。</p>
                        <p className="font-semibold">二、帳號安全</p>
                        <ul className="list-disc list-inside space-y-1 pl-1">
                          <li>會員帳號及密碼請妥善保管，不得轉讓他人使用。</li>
                          <li>如發現帳號遭盜用或異常，請立即聯繫平台客服。</li>
                          <li>因會員自身疏失導致帳號外洩所造成之損失，平台不負相關責任。</li>
                        </ul>
                        <p className="font-semibold">三、訂餐規範</p>
                        <ul className="list-disc list-inside space-y-1 pl-1">
                          <li>下單後請準時於指定時間取餐，逾時未取視情況由廠商自行處理。</li>
                          <li>如對餐點有過敏或特殊飲食需求，請於備註欄位說明，並直接與廠商確認。</li>
                          <li><span className="font-semibold text-red-700">未取貨且未付款累計超過一次，將喪失訂餐資格。</span>如認為封禁有誤，可至會員中心提交申訴。</li>
                          <li>單筆訂單金額超過 <span className="font-semibold">NT$1,000</span> 者，須於下單後繳付訂金，方可成立訂單。</li>
                        </ul>
                        <p className="font-semibold">四、取消與退款政策</p>
                        <ul className="list-disc list-inside space-y-1 pl-1">
                          <li>訂單<span className="font-semibold">確認前</span>（廠商尚未確認）：可聯繫廠商取消，無違約責任。</li>
                          <li>訂單<span className="font-semibold">確認後</span>：請於取餐日<span className="font-semibold"> 24 小時前</span>聯繫廠商申請取消。</li>
                          <li>取消訂單後，已繳付之訂金由廠商以現金退還；退還時程由廠商與顧客協議。</li>
                          <li>廠商因故取消已確認之訂單，顧客可要求全額退還訂金。</li>
                          <li>客服聯絡方式：herzbaa@gmail.com</li>
                        </ul>
                        <p className="font-semibold">五、個人資料保護</p>
                        <p>會員所提供之個人資料（姓名、電話、學校科系等）僅用於訂餐服務及聯絡使用，不會對外揭露或販售給第三方。</p>
                        <p className="font-semibold">六、服務變更</p>
                        <p>平台保留隨時修改服務內容或本須知之權利，修改後將公告於平台。繼續使用服務即視為同意修訂後之條款。</p>
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
                          我已詳細閱讀並同意上述會員服務須知及相關條款
                        </label>
                      </div>

                      <Button
                        className="w-full"
                        disabled={!memberAgreed}
                        onClick={() => setMemberStep("form")}
                      >
                        同意並繼續填寫註冊資料
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
                        ← 返回會員須知
                      </Button>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>帳號 *</Label>
                          <Input autoComplete="username" placeholder="登入用帳號" value={regUsername} onChange={e => setRegUsername(e.target.value)} required />
                        </div>
                        <div>
                          <Label>顯示名稱</Label>
                          <Input autoComplete="name" placeholder="顯示給廠商的名字" value={displayName} onChange={e => setDisplayName(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Email *</Label>
                        <Input autoComplete="email" type="email" placeholder="電子信箱" value={regEmail} onChange={e => setRegEmail(e.target.value)} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>密碼 *</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegPassword ? "text" : "password"} placeholder="至少 6 位" value={regPassword} onChange={e => setRegPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showRegPassword ? "隱藏密碼" : "顯示密碼"} aria-pressed={showRegPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegPassword(v => !v)}>
                              {showRegPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>確認密碼 *</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showRegConfirm ? "text" : "password"} placeholder="再輸入一次" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showRegConfirm ? "隱藏密碼" : "顯示密碼"} aria-pressed={showRegConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowRegConfirm(v => !v)}>
                              {showRegConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <div>
                        <Label>手機號碼</Label>
                        <Input autoComplete="tel" placeholder="09xx-xxx-xxx" value={phone} onChange={e => setPhone(e.target.value)} />
                      </div>

                      {/* 學籍資料群組 */}
                      <div className="border rounded-lg p-3 space-y-3 bg-orange-50/50">
                        <p className="text-xs font-semibold text-orange-700">我是學生（選填）</p>
                        <div>
                          <Label>學校</Label>
                          <Select value={school} onValueChange={v => { setSchool(v); setDepartment(""); }}>
                            <SelectTrigger>
                              <SelectValue placeholder="選擇學校" />
                            </SelectTrigger>
                            <SelectContent>
                              {Object.keys(TAIWAN_UNIV_DEPTS).map(u => (
                                <SelectItem key={u} value={u}>{u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>科系</Label>
                          {(TAIWAN_UNIV_DEPTS as Record<string, string[]>)[school]?.length > 0 ? (
                            <Select value={department} onValueChange={setDepartment}>
                              <SelectTrigger>
                                <SelectValue placeholder="選擇科系" />
                              </SelectTrigger>
                              <SelectContent>
                                {((TAIWAN_UNIV_DEPTS as Record<string, string[]>)[school] ?? []).map(dept => (
                                  <SelectItem key={dept} value={dept}>{dept}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          ) : (
                            <Input placeholder="科系名稱（選填）" value={department} onChange={e => setDepartment(e.target.value)} />
                          )}
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingReg}>
                        {isPendingReg ? "註冊中..." : "立即註冊"}
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
                        <p className="font-bold text-amber-800 text-base">廠商申請須知</p>
                        <p className="font-semibold">一、申請資格</p>
                        <p>凡具有合法食品販售資格之業者，均可申請成為飯飽 BunnBaa 平台廠商。申請時須提供有效之聯絡方式及店家資訊，以供平台審核。</p>
                        <p className="font-semibold">二、訂閱方案與收費</p>
                        <div className="bg-amber-100 rounded-lg p-3 space-y-1">
                          <p className="font-semibold text-amber-900">首月免費試用</p>
                          <p>通過審核後第一個月免費使用全部功能，無需信用卡。</p>
                          <p className="font-semibold text-amber-900 mt-1">第二個月起：每月 NT$1,999</p>
                          <p>每月自動續約，費用於每月起算日扣款。</p>
                        </div>
                        <p className="font-semibold">三、取消訂閱與帳號處理</p>
                        <ul className="list-disc list-inside space-y-1 pl-1">
                          <li>廠商可於當期到期日的前一個月內提出取消申請。</li>
                          <li>取消後帳號將進入<span className="font-semibold">暫停狀態</span>，無法登入及使用平台功能。</li>
                          <li>帳號暫停期間，所有店家資料、菜單、訂單紀錄<span className="font-semibold">均予保留，不會刪除</span>，保留期限為 2 年。</li>
                          <li>如日後希望恢復使用，重新訂閱即可啟用帳號，原有資料完整延續。</li>
                          <li>如廠商未確認已取消訂閱，訂閱費用於到期後不再自動扣款；本平台目前採人工對帳方式，如有帳款疑義請聯繫 herzbaa@gmail.com。</li>
                        </ul>
                        <p className="font-semibold">四、服務規範</p>
                        <ul className="list-disc list-inside space-y-1 pl-1">
                          <li>廠商應確保所販售之商品符合食品安全衛生相關法規。</li>
                          <li>廠商應如實填寫菜單品項、價格及供應時間，不得有虛偽不實之情形。</li>
                          <li>廠商應依據訂單於指定時間完成出餐，如遇特殊狀況應提前通知平台及消費者。</li>
                          <li>廠商不得無故取消已確認之訂單，如有違反將影響合作資格。</li>
                        </ul>
                        <p className="font-semibold">五、帳號管理</p>
                        <p>廠商帳號限本人使用，不得轉讓或共用。帳號密碼請妥善保管，如發現帳號遭盜用請立即通知平台。</p>
                        <p className="font-semibold">六、資料使用</p>
                        <p>廠商所提供之店家資訊（店名、聯絡方式）將公開顯示於平台，供消費者查閱。</p>
                        <p className="font-semibold">七、其他</p>
                        <p>本須知如有修訂，平台將提前公告。繼續使用平台服務即視為同意修訂後之條款。</p>
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
                          我已詳細閱讀並同意上述廠商申請須知及相關服務條款
                        </label>
                      </div>

                      <Button
                        className="w-full"
                        disabled={!vendorAgreed}
                        onClick={() => setVendorStep("form")}
                      >
                        同意並繼續填寫申請資料
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
                        ← 返回申請須知
                      </Button>
                      <div className="border rounded-lg p-3 space-y-3 bg-amber-50/50">
                        <p className="text-xs font-semibold text-amber-700">店家資訊</p>
                        <div>
                          <Label>店家名稱 *</Label>
                          <Input placeholder="例：王媽媽便當" value={storeName} onChange={e => setStoreName(e.target.value)} required />
                        </div>
                        <div>
                          <Label>聯絡電話</Label>
                          <Input autoComplete="tel" placeholder="05x-xxx-xxxx" value={vendorPhone} onChange={e => setVendorPhone(e.target.value)} />
                        </div>
                      </div>
                      <div>
                        <Label>Email *（登入用）</Label>
                        <Input autoComplete="username" type="email" placeholder="電子信箱" value={vendorEmail} onChange={e => setVendorEmail(e.target.value)} required />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label>密碼 *</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorPassword ? "text" : "password"} placeholder="至少 6 位" value={vendorPassword} onChange={e => setVendorPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showVendorPassword ? "隱藏密碼" : "顯示密碼"} aria-pressed={showVendorPassword} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorPassword(v => !v)}>
                              {showVendorPassword ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                        <div>
                          <Label>確認密碼 *</Label>
                          <div className="relative mt-1">
                            <Input autoComplete="new-password" type={showVendorConfirm ? "text" : "password"} placeholder="再輸入一次" value={vendorConfirmPassword} onChange={e => setVendorConfirmPassword(e.target.value)} required className="pr-11" />
                            <button type="button" aria-label={showVendorConfirm ? "隱藏密碼" : "顯示密碼"} aria-pressed={showVendorConfirm} className="absolute right-0 top-1/2 -translate-y-1/2 flex h-11 w-11 items-center justify-center rounded-r-md text-muted-foreground transition-colors hover:text-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setShowVendorConfirm(v => !v)}>
                              {showVendorConfirm ? <EyeOff className="w-4 h-4" aria-hidden="true" /> : <Eye className="w-4 h-4" aria-hidden="true" />}
                            </button>
                          </div>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={isPendingVendor}>
                        {isPendingVendor ? "申請中..." : "申請成為廠商"}
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
            <DialogTitle>重設密碼</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-muted-foreground">
              請輸入您註冊時使用的 Email，我們將寄送密碼重設連結。
            </p>
            <div>
              <Label>電子信箱</Label>
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
            <Button variant="outline" onClick={() => setResetDialogOpen(false)}>取消</Button>
            <Button
              
              disabled={!resetEmail.trim() || resetPasswordMutation.isPending}
              onClick={() => resetPasswordMutation.mutate(resetEmail.trim())}
            >
              {resetPasswordMutation.isPending ? "寄送中..." : "寄送重設信"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
