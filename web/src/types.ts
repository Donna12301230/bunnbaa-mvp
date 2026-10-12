export interface Vendor {
  id: string;
  name: string;
  // *_en: English versions auto-translated by Functions with Gemini (functions/src/translate.js); the English UI reads them via loc()
  name_en?: string;
  description_en?: string;
  item_focus: string;
  reliability_tone: "new" | "variable" | "stable";
  status?: "active" | "disabled"; // missing = active, for backward compat with seeded data
  verified?: boolean; // Manually certified after platform review; separate from reliability_tone (computed automatically). Admin-only write
  // Display fields for browsing, optional — not every vendor (e.g. old test vendors) has them
  description?: string;
  address?: string;
  phone?: string;
  cover_image?: string; // Vendor cover image (Firebase Storage download URL), uploaded by the vendor owner on the vendor settings page
  owner_uid?: string | null; // Real Firebase Auth uid bound after platform review; admin-only write
  menu_catalogs?: string[]; // Names and order of menu catalogs (two levels: catalog > category), maintained by the vendor owner on the menu page
  // Pickup schedule (vendor settings page, editable by the vendor owner); unset = default slots, open every day; see lib/pickupSlots.ts
  pickup_windows?: string[]; // "11:30-12:00"
  business_hours?: BusinessHour[];
  holidays?: string[]; // YYYY-MM-DD
  slot_capacity?: number; // Cap on all meals combined per pickup slot; 0 / unset = no limit; booked counts live in slot_counters
  // Phase 1 spec §2 vendor-adjustable settings (unset = platform default)
  cutoff_time?: string; // Cut-off time on the previous day; can only be earlier than the platform's (20:00)
  safety_stock_rate?: number;
  candidate_min_qty?: number;
  lat?: number; // Pickup point coordinates: nearby charity meals, area insights
  lng?: number;
  forecast_daily?: Record<string, number>; // Self-entered estimates for a new vendor's first 4 weeks: menu_item_id → daily portions
  anomaly_weeks?: string[]; // Weeks flagged as anomalous by the vendor (Monday dates), excluded from forecasts
  disaster_dates?: string[]; // Work/school suspension days (written by Functions)
  typhoon_notice?: { dates: string[]; event_id: string } | null;
  menu_locked_week?: string;
  rewards_paused_from?: string;
  // Earnings dashboard cost settings (§9.3), written by updateVendorCosts; wages may not be below minimum wage
  hourly_wage?: number;
  staff_salaries?: number[];
  fixed_costs?: number;
  owner_hours_per_day?: number;
  linepay_fee_rate?: number;
}

export type MealPeriod = "breakfast" | "lunch" | "dinner";

export interface MenuItem {
  id: string;
  vendor_id: string;
  name: string;
  name_en?: string;
  description_en?: string;
  category_en?: string;
  // Catalog (level above category, optional): the name is stored here, the order in vendors.menu_catalogs; see lib/menuCatalog.ts
  catalog?: string | null;
  catalog_en?: string;
  // Same-vendor item ids frequently bought together (BigQuery basket analysis, written by the backend; the item page shows the top 3)
  often_with?: string[];
  description: string;
  price: number;
  category: string;
  is_available: boolean;
  image: string | null;
  allergens: string[];
  dietary_tags: string[];
  created_at: unknown; // Firestore Timestamp
  // Bento (Phase 1 spec §3): items without slots are single items, with no adding/removing rice or sides
  item_type?: "bento" | "single"; // Single items are ordered directly, no assembly
  meal_periods?: MealPeriod[]; // Meal periods served (unset = all of the vendor's slots)
  template?: string | null;
  // Selectable mains, each with its own price (bento price follows the chosen main); without mains, main + price are used
  mains?: BentoMain[];
  main?: { name: string; component_id?: string | null; portion_text?: string | null } | null;
  rice_component_id?: string | null;
  // Prep composition: semi-finished components in every portion that can't be swapped or removed (a bento's fixed side like a braised egg; all of a single item's parts like crepe skin + egg). portions unset = 1
  fixed?: { name: string; component_id?: string | null; portion_text?: string | null; portions?: number }[];
  slots?: BentoSlot[];
  custom_fields?: BentoCustomField[]; // Vendor-defined dropdowns below the side dishes (e.g. soup, drink, spice level)
  weekdays?: number[]; // Weekly menu rotation: only served on these days (unset = every day)
  component_id?: string | null; // Semi-finished component for a single item (for prep)
}

export interface BentoMain {
  name: string;
  component_id?: string | null;
  price: number;
  image_url?: string | null;
  portion_text?: string | null; // Display of total ingredients, e.g. "1 chicken leg" (filled from the recipe when the vendor edits the menu)
}

export interface BentoCandidate {
  name: string;
  component_id?: string | null;
  image_url?: string | null; // Diners pick dishes by tapping the image (§4.2)
  portion_text?: string | null; // Display of total ingredients, e.g. "60 g bitter melon"
  portion_level: number; // 1 full portion, 0.5 half portion (Phase 1 has only two levels; derived from cost, the vendor can fine-tune)
  weekly_cap?: number | null; // Supply cap for this week
  min_qty?: number | null; // Minimum quantity to go ahead (unset = vendor setting / platform default)
  disabled?: boolean; // Cost ratio < 0.5; can't be listed as a candidate
}

export interface BentoSlot {
  category: string; // Greens, meat sides, eggs & tofu… candidates must be in the same category
  default: { name: string; component_id?: string | null; image_url?: string | null; portion_text?: string | null };
  candidates: BentoCandidate[];
}

/** Vendor-defined field (dropdown below a bento's side dishes): the diner picks one option, the first is the default; options can add or subtract from the price */
export interface BentoCustomOption {
  name: string;
  price: number; // Price adjustment (0 = no extra charge)
}
export interface BentoCustomField {
  label: string;
  options: BentoCustomOption[];
}
/** Custom field choices recorded on the order */
export interface LockCustomOption {
  label: string;
  index: number;
  choice: string;
  price: number;
}

/** Fourth side dish: backup (no extra charge, fills in when one of the first three doesn't go ahead) or add-on (+10) */
export type ExtraSideMode = "backup" | "addon";
export interface ExtraSideChoice {
  slot: number;
  candidate: number | null; // null = that cell's default dish
  mode: ExtraSideMode;
}
export interface LockExtraSide {
  slot: number;
  candidate_index: number | null;
  dish: string;
  component_id?: string | null;
  portion_level?: number;
  mode: ExtraSideMode;
  wished?: boolean;
  resolved?: string | null;
  used_for_slot?: number | null;
}

export type RiceOption = "add" | "normal" | "less";
/** Per-cell choice at order time: default dish, candidate dish index, or none */
export type SlotChoice = "default" | "none" | number;

export interface LockSlot {
  category: string;
  default_dish: string;
  default_component_id?: string | null;
  removed: boolean;
  wished: string | null;
  wished_component_id?: string | null;
  candidate_index?: number;
  resolved: string | null; // Actual side dish decided at cut-off
  portion_level: number | null;
  substituted_from?: string;
  backup_used?: boolean; // Wish didn't go ahead; filled with the fourth backup dish
}

export interface MealPlan {
  id: string;
  vendor_id: string;
  label: string; // e.g. "Plan A" / "Plan B"
  label_en?: string;
  name_en?: string;
  description_en?: string;
  fastest_booking_en?: string;
  name: string;
  description: string;
  price_per_meal: number;
  fastest_booking: string;
  days: number; // Number of meal days; joining the meal plan creates this many locks
  menu_item_id?: string | null; // Item the meal plan serves (determines meal period and available slots)
  created_at: unknown; // Firestore Timestamp
}

export type LockStatus =
  | "locked"
  | "for_resale"
  | "for_gift"
  | "resold_and_fulfilled"
  | "fulfilled"
  | "no_show" // Legacy (no-show led to suspension); now converted to a charity meal
  | "charity" // Charity meal, from a no-show or donated by the diner
  | "cancelling"
  | "cancelled"; // Cancelled by the diner (48+ hours before pickup, in exchange for a coupon), or auto-refunded on a work-suspension day

export interface Lock {
  id: string;
  vendor_id: string;
  item_name: string;
  item_name_en?: string | null; // Copied from menu_items.name_en at order time
  pickup_window: string;
  pickup_date: string; // YYYY-MM-DD
  discount_percent: number;
  resellable: boolean;
  locked_price: number;
  status: LockStatus;
  // Set alongside status "for_resale"; a lock past this deadline can be
  // claimed for free (firestore.rules), no scheduled function needed.
  resale_deadline?: unknown; // Firestore Timestamp
  phone_last3?: string | null; // Last three digits of the phone number at order time, for vendor checks (used with the 4-digit pickup number as the redemption code)
  resale_price?: number; // Resale price set by the seller (0 to original price); defaults to the early-bird price; see lib/transfers.ts
  no_show_note?: string | null;
  note?: string; // Diner's note at order time (e.g. "no cilantro"); only set for cart checkout
  consumer_feedback?: string | null;
  buyer_uid: string;
  // uids that once held this lock and were later taken over by someone else (resale / free claim / gift); appended on takeover.
  // "My transfers" uses this to find items already taken over, and it also keeps read access for the original holder.
  transferred_from_uids?: string[];
  created_at: unknown; // Firestore Timestamp
  reminder_sent?: boolean; // device token lives in the private lock_tokens/{lockId} doc
  // Meal plan (multi-day subscription): one successful payment creates N locks at once, linked by the same plan_id;
  // there's no separate plan/subscription collection (see
  // createPlanLinePayReservation in functions). Since 2026-09-28 plan_id = the order id of that payment;
  // older data written directly by the frontend uses "vendor_id-<meal_plans id>".
  plan_id?: string;
  plan_label?: string;
  meal_plan_id?: string; // meal_plans id; only on meal plans joined after 2026-09-28
  // Phase 1 spec: bento contents, amount breakdown, pickup credentials
  menu_item_id?: string | null;
  meal_period?: MealPeriod;
  main_dish?: string | null;
  main_index?: number | null;
  slots?: LockSlot[];
  extra_side?: LockExtraSide | null;
  custom_options?: LockCustomOption[];
  plan_day?: number;
  rice?: RiceOption;
  list_price?: number;
  early_bird_amount?: number;
  adjust_amount?: number;
  coupon_id?: string | null;
  coupon_discount?: number;
  payer_uid?: string;
  paid_amount?: number; // Amount the payer actually paid in transaction_id (basis for refunds)
  resale_hold?: { uid: string; intent_id: string; expires_at: unknown } | null; // Someone is paying to take this over
  transfer_refund?: { uid: string; amount: number; status: "done" | "failed" | "none"; as?: "points" } | null;
  pickup_code?: string; // 4-digit pickup number
  share_token?: string; // Proxy pickup link
  cutoff_at?: unknown; // Firestore Timestamp
  cutoff_done?: boolean;
  charity_source?: "noshow" | "donated";
  cancel_reason?: "customer" | "disaster";
  refunded_amount?: number;
  // Diner cancellations aren't refunded in cash but get a coupon (30% of original price): coupon value and id; kept_amount is what stays with the vendor
  refund_coupon_amount?: number;
  /** Since 2026-10-09 refunds go to platform points (functions/src/wallet.js); missing on old data = refunded to LINE Pay */
  refunded_as?: "points";
  points_used?: number;
  refund_coupon_id?: string | null;
  kept_amount?: number;
  tickets_issued?: number;
  tags?: string[];
}

export interface Payout {
  id: string;
  vendor_id: string;
  amount: number; // Amount paid out to the vendor (after platform commission)
  gross_amount?: number; // Total paid by diners
  commission_amount?: number; // Platform commission; missing on records before 2026-10-05 (paid out in full then)
  commission_rate?: number;
  lock_count: number;
  status: "pending_manual_export";
  created_at: unknown; // Firestore Timestamp
}

export interface AccuracyReport {
  id: string;
  vendor_id: string;
  horizon: string;
  accuracy_rate: number;
  error_range: string; // Computed by code (vendorCalibration.calibrationStats), not the LLM
  error_range_en?: string;
  explanation: string;
  pattern_note: string;
  explanation_en?: string;
  pattern_note_en?: string;
  scenario_answer?: string;
  disclaimer: string;
  generated_at: unknown; // Firestore Timestamp
}

// ── Marketplace UI types (ported from BunnBaa Parse_Ref, back4app/Parse plain
//    object representations — kept distinct from the Lock-feature types above) ──

export interface BusinessHour {
  weekday: number;   // 0=Sun,1=Mon,...,6=Sat
  open: boolean;
  openTime: string;  // "HH:MM"
  closeTime: string; // "HH:MM"
}

export const ALLERGEN_LIST = [
  "蛋", "奶", "花生", "堅果", "小麥/麩質", "大豆", "海鮮", "芝麻",
] as const;

export const DIETARY_TAGS = ["葷食", "素食", "全素", "辣"] as const;

// Allergen / dietary tags are fixed options; the English UI translates them with this table (the database stores Chinese)
const TAG_EN: Record<string, string> = {
  蛋: "Egg", 奶: "Dairy", 花生: "Peanut", 堅果: "Tree nuts", "小麥/麩質": "Wheat / gluten", 大豆: "Soy", 海鮮: "Seafood", 芝麻: "Sesame",
  葷食: "Meat", 素食: "Vegetarian", 全素: "Vegan", 辣: "Spicy",
};
export const tagEn = (tag: string): string => TAG_EN[tag] ?? tag;

export interface CartItem {
  menuItem: MenuItem;
  quantity: number;
  note: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  displayName?: string;
  phone?: string;
  studentId?: string;
  department?: string;
  role: "customer" | "vendor" | "admin";
  vendorId?: string; // When role is vendor, the vendors/{id} whose owner_uid is bound to this account
  orderBanned?: boolean;
  noPickupCount?: number;
  lang?: "zh" | "en"; // users/{uid}.lang: language for pickup reminder push notifications
  homeGeo?: string; // Usual location (coarse 7-char geohash)
  donatedCount?: number; // Charity meals donated by the user (personal charity record)
  mutedKinds?: string[]; // Notification kinds turned off, e.g. "charity"
  charityNearbyPush?: boolean; // "Charity meals nearby" push notification, off by default
}

// reviews/{lockId}: a diner's rating of a picked-up lock, publicly readable; see firestore.rules
export interface Review {
  id: string; // = lock id
  vendor_id: string;
  meal_plan_id: string | null;
  item_name: string;
  rating: number; // 1–5
  comment: string; // Empty string = review text not public
  reviewer_label: string;
  // English auto-translated by Functions (translateReview)
  comment_en?: string;
  item_name_en?: string;
  reviewer_label_en?: string;
  created_at: unknown; // Firestore Timestamp
}

// ── Phase 1 spec: recipes, purchasing, rewards, charity meals, insights ──────────────────────────

export interface Ingredient {
  id: string;
  name: string;
  category: string;
  unit: string; // g / piece
  purchase_unit_label: string; // e.g. box, kg, bag
  purchase_unit_size: number; // How many units make one purchase unit
  yield_rate: number; // Cooked yield (cooked weight / raw weight)
  loss_rate: number;
  shelf_days: number;
  frequency: "monthly" | "weekly" | "daily";
  supplier_id?: string | null;
  unit_price: number; // Per purchase unit
}

export interface Component {
  id: string;
  name: string;
  portion_grams: number;
  ingredients: { ingredient_id: string; grams: number }[];
  prep_minutes: number;
  equipment: string;
  batch_capacity: number;
  advance_hours: number;
  method?: string;
  flavors?: string[];
  /** Recipe draft generated by AI that the vendor hasn't confirmed yet (marked "AI draft" on the menu) */
  ai_draft?: boolean;
}

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  line_id?: string;
  note?: string;
}

export interface Coupon {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  tier: string;
  label: string;
  discount: number;
  status: "issued" | "owned" | "redeemed" | "expired" | "unclaimed";
  pool_period: string;
  user_id?: string;
  expires_at?: unknown;
  lock_id?: string;
}

export interface RewardTicket {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  user_id: string;
  period_id: string;
  status: "pending" | "drawable" | "drawn" | "forfeited" | "revoked";
  pool_period?: string;
  draw_deadline?: unknown;
  coupon_id?: string;
}

export interface RewardStatus {
  id: string;
  vendor_name: string;
  tickets_so_far: number;
  // Pool-opening threshold changed to cumulative net revenue (2026-10-05); old data only has min_tickets, the frontend derives amount_to_open from it
  revenue_so_far?: number;
  min_revenue?: number;
  min_tickets?: number;
  amount_to_open: number;
  pool_open: boolean;
  pool_period: string | null;
  draw_deadline: unknown;
  remaining_total: number;
  paused?: boolean;
}

export interface CharityMeal {
  id: string;
  vendor_id: string;
  vendor_name: string;
  vendor_address?: string;
  lat: number | null;
  lng: number | null;
  date: string;
  source: "noshow" | "donated";
  status: "available" | "reserved" | "claimed" | "given" | "wasted";
  pickup_code?: string | null;
  item_name: string;
  sides: string[];
  deadline: unknown;
}

export interface CharityReservation {
  id: string;
  user_id: string;
  meal_id: string;
  vendor_id: string;
  vendor_name: string;
  date: string;
  item_name: string;
  status: "reserved" | "claimed" | "expired";
  expires_at: unknown;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string;
  link: string | null;
  kind: string;
  read: boolean;
  created_at: unknown;
}
