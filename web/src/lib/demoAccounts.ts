import { tr } from "@/lib/i18n";
import { DEMO_ADMIN_EMAIL } from "@/lib/adminAuth";

// Demo accounts for the login page's "Demo accounts" one-click sign-in.
// These are public shared accounts anyone can use (the passwords are right here), so never put real data on them.
// Local emulator accounts are created by scripts/seed.js and use different passwords from production:
//   - diner: one password on the emulator, another on production
//   - vendor: demo1234 on both; on production it owns cafe-renheya-demo (仁和雅咖啡), so anyone can open that store's portal
//   - admin: on the emulator, a real admin (full access). On production, the read-only demo admin admin@bunnbaa.test
//     (password demo1234, lib/adminAuth.ts DEMO_ADMIN_EMAIL): it can browse the admin backend, but firestore.rules
//     (isAdminViewer) and Functions refuse every write, since anyone can sign in with it
export interface DemoAccount {
  key: "customer" | "vendor" | "admin";
  email: string;
  password: string;
  label: string;
  hint: string;
}

/** A function, so labels are built in the current language on every render */
/** English UI only: the demo accounts' stored display names are Chinese, so show the role label instead */
export function demoDisplayName(email: string | undefined): string {
  const account = email ? demoAccounts().find((a) => a.email === email) : undefined;
  return account ? tr("", account.label) : "";
}

export function demoAccounts(): DemoAccount[] {
  const customer = { key: "customer" as const, email: "customer@bunnbaa.test", label: tr("顧客", "Diner"), hint: tr("訂餐、轉讓、成長獎勵", "Order, transfer, rewards") };
  const vendor = { key: "vendor" as const, email: "vendor@bunnbaa.test", password: "demo1234", label: tr("店家", "Vendor"), hint: tr("店家後台：訂單、備料、報表", "Vendor portal: orders, prep, reports") };
  // Checked with import.meta.env.DEV directly: the bundler drops this emulator branch from production builds,
  // so the admin account and emulator passwords never appear in the production files
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
    return [
      { ...customer, password: "demo1234" },
      vendor,
      { key: "admin", email: "suw192336@gmail.com", password: "demo1234", label: tr("管理員", "Admin"), hint: tr("只在本機 emulator", "Local emulator only") },
    ];
  }
  return [
    { ...customer, password: "demo123" },
    vendor,
    { key: "admin", email: DEMO_ADMIN_EMAIL, password: "demo1234", label: tr("管理員", "Admin"), hint: tr("唯讀：瀏覽管理後台，不能修改資料", "Read-only: browse the admin backend") },
  ];
}
