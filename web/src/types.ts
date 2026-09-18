export interface Vendor {
  id: string;
  name: string;
  item_focus: string;
  reliability_tone: "new" | "variable" | "stable";
}

export type LockStatus =
  | "locked"
  | "for_resale"
  | "resold_and_fulfilled"
  | "fulfilled"
  | "no_show";

export interface Lock {
  id: string;
  vendor_id: string;
  item_name: string;
  pickup_window: string;
  pickup_date: string; // YYYY-MM-DD
  discount_percent: number;
  resellable: boolean;
  locked_price: number;
  status: LockStatus;
  no_show_note?: string | null;
  consumer_feedback?: string | null;
  discount_explanation?: string | null; // filled in by onLockCreated
  buyer_uid: string;
  created_at: unknown; // Firestore Timestamp
}

export interface Payout {
  id: string;
  vendor_id: string;
  amount: number;
  lock_count: number;
  status: "pending_manual_export";
  created_at: unknown; // Firestore Timestamp
}

export interface AccuracyReport {
  id: string;
  vendor_id: string;
  horizon: string;
  accuracy_rate: number;
  error_range: string;
  explanation: string;
  pattern_note: string;
  scenario_answer?: string;
  disclaimer: string;
  generated_at: unknown; // Firestore Timestamp
}
