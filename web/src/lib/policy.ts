import { tr } from "@/lib/i18n";
import { liveConfig } from "@/lib/platformConfig";
import { EARLY_BIRD_TIERS } from "@/lib/pricing";
import { businessDaysText, vendorCutoffTime, type MaybeSchedule } from "@/lib/pickupSlots";

// 全站規則說明的唯一來源（2026-10-09 一致性整理）：FAQ、服務須知、關於、Landing、購物車與首頁聲明、
// 品項頁、我的餐點都從這裡取，數字一律讀平台參數（liveConfig），管理員改了參數文案就跟著變。
// 規則本身在伺服器（functions/src）；這裡只負責把它說清楚。

const pct = (rate: number) => Math.round(rate * 100);
const discountZh = (p: number) => `${(100 - p) % 10 === 0 ? (100 - p) / 10 : 100 - p} 折`;

export const policy = {
  /** 取餐前一天 20:00 截單 */
  cutoff: (vendor?: MaybeSchedule) =>
    tr(`取餐前一天 ${vendorCutoffTime(vendor)} 截單`, `orders close at ${vendorCutoffTime(vendor)} the day before pickup`),

  /** 最遠可訂 30 天後 */
  bookingRange: () => tr(`最遠可預訂 ${liveConfig().bookingRangeDays} 天後`, `book up to ${liveConfig().bookingRangeDays} days ahead`),

  /** 週一至週五早、中、晚餐 */
  serviceDays: () => tr(`${businessDaysText()}早、中、晚餐自取`, `${businessDaysText()} breakfast, lunch and dinner pickup`),

  /** 明天 95 折、提前 2 天以上 8 折 */
  earlyBird: () => {
    const [near, far] = EARLY_BIRD_TIERS;
    return tr(
      `明天取餐 ${discountZh(near.discountPercent)}、提前 ${far.minDays} 天以上 ${discountZh(far.discountPercent)}`,
      `${near.discountPercent}% off for tomorrow, ${far.discountPercent}% off ${far.minDays}+ days ahead`
    );
  },

  /** 取餐 48 小時前可取消，不退現金，改發原價 30% 折價券（30 天內有效） */
  cancel: () => {
    const c = liveConfig();
    return tr(
      `取餐 ${c.cancelHoursBefore} 小時前可以取消，不退現金，改發一張同店家、原價 ${pct(c.cancelCouponRate)}% 的折價券（${c.couponValidDays} 天內有效）`,
      `up to ${c.cancelHoursBefore} hours before pickup you can cancel — not for cash, but for a coupon from the same vendor worth ${pct(c.cancelCouponRate)}% of the list price (valid ${c.couponValidDays} days)`
    );
  },
  cancelShort: () => {
    const c = liveConfig();
    return tr(`取餐 ${c.cancelHoursBefore} 小時前可取消換原價 ${pct(c.cancelCouponRate)}% 折價券`, `cancel up to ${c.cancelHoursBefore}h before pickup for a ${pct(c.cancelCouponRate)}% coupon`);
  },

  /** 截單前可修改；變便宜的差額退成點數；變貴目前不能補差額 */
  changeBeforeCutoff: () =>
    tr("截單前可以免費修改取餐時段、主菜、配菜、飯量；改得比較便宜，差額會退成平台點數；改得比較貴目前還不能線上補差額",
      "before cutoff you can change the pickup time, main, sides or rice for free; if it gets cheaper the difference comes back as points (topping up isn't supported yet)"),

  /** 截單後不能取消，可以轉讓、贈送、請朋友代領或捐為愛心餐 */
  afterCutoff: () =>
    tr("截單後店家已依訂單備料，不能取消或修改；可以轉讓、贈送、請朋友代領，或在取餐當天捐為愛心餐",
      "after cutoff the vendor has already prepared, so you can't cancel or change it — but you can transfer, gift, ask a friend to pick up, or donate it on the pickup day"),

  /** 時段結束 30 分鐘未取餐轉愛心餐、不退款、照常發抽獎券 */
  noShow: () => {
    const m = liveConfig().charityConvertAfterMinutes;
    return tr(`取餐時段結束 ${m} 分鐘仍未取餐，便當會轉為愛心餐、不退款（照常發抽獎券）`,
      `meals not picked up ${m} min after the pickup window become charity meals — no refund, but draw tickets are still issued`);
  },

  /** 退款一律先成為平台點數 */
  refunds: () =>
    tr("所有退款都會先存成平台點數（1 點＝NT$1），結帳時可以折抵，也可以到會員中心「平台點數」退回原本的 LINE Pay",
      "all refunds are stored as BunnBaa points first (1 point = NT$1): use them at checkout, or send them back to your original LINE Pay payment from My account → Points"),

  /** 停班停課自動取消，全額退成點數 */
  disaster: () =>
    tr("取餐地點所在縣市宣布停班停課時，當天的訂單會自動取消、全額退成平台點數；天災期間店家可等值替換配菜",
      "if a work suspension is announced for the pickup area, that day's orders are cancelled automatically and fully refunded as points; during disasters vendors may swap in an equivalent side"),

  /** 店家未出餐 */
  vendorFailed: () =>
    tr("店家未如期出餐，請聯絡客服，平台確認後全額退成平台點數",
      "if the vendor fails to serve, contact support — once we confirm, you'll get a full refund as points"),

  /** 平台抽成 5%，定價建議加上去 */
  commission: () => {
    const rate = liveConfig().commissionRate;
    const p = Math.round(rate * 1000) / 10;
    return { pct: p, example: Math.round(100 / (1 - rate)) };
  },

  /** 愛心餐預約到場時限 */
  charityReserve: () => {
    const m = liveConfig().charityReserveMinutes;
    return tr(`每人每天限預約 1 份，預約後 ${m} 分鐘內到店出示 QR Code；逾時這份會釋出給下一位，不會停權`,
      `one per person per day; arrive within ${m} min and show the QR code. If you're late it's released to the next person — no penalty`);
  },
};
