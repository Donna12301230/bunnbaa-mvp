// 台北時間的日期工具。日期一律存成 YYYY-MM-DD（台北當地），時間點用 +08:00 組成 Date。
// 規格 §13：時間以 Asia/Taipei 計。

function taipeiToday(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
}

/** 台北時間的 HH:MM */
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

/** 0=日 … 6=六 */
function weekdayOf(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/** 那一週的週一（結算期、週菜單都以週一日期當 id） */
function mondayOf(dateStr) {
  const wd = weekdayOf(dateStr);
  return addDays(dateStr, wd === 0 ? -6 : 1 - wd);
}

/** 預訂開放到「下週五」（規格 §2） */
function lastBookableDate(today = taipeiToday()) {
  return addDays(mondayOf(today), 11);
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

/** "11:00-13:00" → { start, end }（HH:MM） */
function splitWindow(window) {
  const [start, end] = String(window || "").split("-").map((s) => s.trim());
  return { start, end };
}

module.exports = {
  taipeiToday, taipeiTime, addDays, daysBetween, weekdayOf, mondayOf, lastBookableDate,
  at, toMinutes, fromMinutes, splitWindow,
};
