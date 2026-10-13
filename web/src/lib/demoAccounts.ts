import { tr } from "@/lib/i18n";

// Demo accounts for the login page's "Demo accounts" one-click sign-in.
// These are public shared accounts anyone can use (the passwords are right here), so never put real data on them.
// Local emulator accounts are created by scripts/seed.js and use different passwords from production:
//   - diner: one password on the emulator, another on production
//   - vendor: one password on the emulator, another on production
//   - admin: emulator only. Admins can refund, ban and change platform settings, so production has no one-click admin sign-in
export interface DemoAccount {
  key: "customer" | "vendor" | "admin";
  email: string;
  password: string;
  label: string;
  hint: string;
}

/** A function, so labels are built in the current language on every render */
export function demoAccounts(): DemoAccount[] {
  const vendor = { key: "vendor" as const, email: "vendor@bunnbaa.test", label: tr("店家", "Vendor"), hint: tr("店家後台：訂單、備料、報表", "Vendor portal: orders, prep, reports") };
  const customer = { key: "customer" as const, email: "customer@bunnbaa.test", label: tr("顧客", "Diner"), hint: tr("訂餐、轉讓、成長獎勵", "Order, transfer, rewards") };
  // Checked with import.meta.env.DEV directly: the bundler drops this emulator branch from production builds,
  // so the admin account and emulator passwords never appear in the production files
  if (import.meta.env.DEV && import.meta.env.VITE_USE_EMULATORS === "true") {
    return [
      { ...customer, password: "demo1234" },
      { ...vendor, password: "demo1234" },
      { key: "admin", email: "suw192336@gmail.com", password: "demo1234", label: tr("管理員", "Admin"), hint: tr("只在本機 emulator", "Local emulator only") },
    ];
  }
  return [{ ...customer, password: "demo123" }, { ...vendor, password: "demo123" }];
}
