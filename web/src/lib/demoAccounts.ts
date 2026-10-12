import { tr } from "@/lib/i18n";

// 登入頁「體驗帳號」快速登入用的示範帳號。
// 顧客、店家這兩組就是 README 公開寫的測試帳號（scripts/seed.js 會建立），所以放在前端沒有多洩漏什麼；
// 但它們是「大家都能登入」的共用帳號，不要在上面放任何真實資料。
// 管理員不提供正式站的快速登入：管理員可以退款、停權、改平台參數，只在本機 emulator 顯示
// （emulator 的管理員密碼是種子資料設的，跟正式站的密碼無關）。
export interface DemoAccount {
  key: "customer" | "vendor" | "admin";
  email: string;
  password: string;
  label: string;
  hint: string;
  emulatorOnly?: boolean;
}

/** 用函式包起來，每次 render 依目前語言組標籤 */
export function demoAccounts(): DemoAccount[] {
  const shared: DemoAccount[] = [
    { key: "customer", email: "customer@bunnbaa.test", password: "demo1234", label: tr("顧客", "Diner"), hint: tr("訂餐、轉讓、成長獎勵", "Order, transfer, rewards") },
    { key: "vendor", email: "vendor@bunnbaa.test", password: "demo1234", label: tr("店家", "Vendor"), hint: tr("店家後台：訂單、備料、報表", "Vendor portal: orders, prep, reports") },
  ];
  // 直接用 import.meta.env.DEV 判斷：正式建置時這整段會被打包工具移除，管理員那組不會出現在正式站的檔案裡
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
    shared.push({ key: "admin", email: "suw192336@gmail.com", password: "demo1234", label: tr("管理員", "Admin"), hint: tr("只在本機 emulator", "Local emulator only"), emulatorOnly: true });
  }
  return shared;
}
