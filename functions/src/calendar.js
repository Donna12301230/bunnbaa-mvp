// Date helpers in Taipei time. Dates are always stored as YYYY-MM-DD (Taipei local); instants are built as Dates with +08:00.
// Spec §13: times are in Asia/Taipei.

function taipeiToday(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** HH:MM in Taipei time */
function taipeiTime(now = new Date()) {
  return now.toLocaleTimeString("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false });
}

function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function daysBetween(fromDate, toDate) {
  return Math.round((Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`)) / 86400000);
}

/** 0 = Sunday … 6 = Saturday */
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** Monday of that week (settlement periods and weekly menus use the Monday date as id) */
function mondayOf(dateStr) {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** Booking window: at most 30 days ahead (spec §2 "booking window") */
const BOOKING_RANGE_DAYS = 30;
function lastBookableDate(today = taipeiToday(), rangeDays = BOOKING_RANGE_DAYS) {
  return addDays(today, rangeDays);
}

function at(dateStr, hhmm) {
  return new Date(`${dateStr}T${hhmm}:00+08:00`);
}

function toMinutes(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + m;
}

function fromMinutes(total) {
  const m = ((total % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** "11:00-13:00" → { start, end } (HH:MM) */
function splitWindow(window) {
  const [start, end] = String(window || "").split("-").map((s) => s.trim());
  return { start, end };
}

module.exports = {
  taipeiToday, taipeiTime, addDays, daysBetween, weekdayOf, mondayOf, lastBookableDate, BOOKING_RANGE_DAYS,
  at, toMinutes, fromMinutes, splitWindow,
};
