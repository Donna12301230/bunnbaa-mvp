import { tr } from "@/lib/i18n";

// 登入頁「體驗帳號」快速登入用的示範帳號。
// 這些是「大家都能登入」的公開共用帳號（密碼就寫在這裡），不要在上面放任何真實資料。
// 本機 emulator 的帳號由 scripts/seed.js 建立，密碼跟正式站不同：
//   - 顧客：emulator 與正式站各有一組密碼
//   - 店家：兩邊同一組
//   - 管理員：只在 emulator。管理員可以退款、停權、改平台參數，正式站不提供快速登入
export interface DemoAccount {
  key: "customer" | "vendor" | "admin";
  email: string;
  password: string;
  label: string;
  hint: string;
}

/** 用函式包起來，每次 render 依目前語言組標籤 */
export function demoAccounts(): DemoAccount[] {
  const vendor = { key: "vendor" as const, email: "vendor@bunnbaa.test", password: "demo1234", label: tr("店家", "Vendor"), hint: tr("店家後台：訂單、備料、報表", "Vendor portal: orders, prep, reports") };
  const customer = { key: "customer" as const, email: "customer@bunnbaa.test", label: tr("顧客", "Diner"), hint: tr("訂餐、轉讓、成長獎勵", "Order, transfer, rewards") };
  // 直接用 import.meta.env.DEV 判斷：正式建置時 emulator 這一段會被打包工具整個移除，
  // 管理員帳號與 emulator 的密碼都不會出現在正式站的檔案裡
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
    return [
      { ...customer, password: "demo1234" },
      vendor,
      { key: "admin", email: "suw192336@gmail.com", password: "demo1234", label: tr("管理員", "Admin"), hint: tr("只在本機 emulator", "Local emulator only") },
    ];
  }
  return [{ ...customer, password: "demo123" }, vendor];
}
