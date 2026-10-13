/**
 * Consumer-side discount explanation agent.
 *
 * Explains, in one or two plain sentences, why a given discount is what it
 * is and what locking in means. Never recommends buying — purely explanatory,
 * generate-once-and-cache.
 *
 * Revised 2026-10-09: this used to run after each order was created (onLockCreated) and was written onto locks, but no screen showed it,
 * and it was generated *after* payment, the opposite of the intent (shown to diners who are still deciding). It is now called as
 * getDiscountExplanation when the price breakdown is opened on the item page; the cache key is just "discount tier × vendor reliability × cancellation rules", so there are few combinations and it costs almost nothing.
 * Rule numbers (cut-off, cancellation coupon rate) are passed in by the caller from platform settings; the model only puts them in plain words and never invents rules.
 */
const { db, onCall, HttpsError, logger, FieldValue } = require("./common");
const { generateJSON } = require("./gemini");
const { loadPlatformConfig } = require("./config");
const { EARLY_BIRD_TIERS } = require("./pricing");

const SYSTEM_INSTRUCTION = `你是一個食物預購平台的說明助手，服務對象是正在考慮預購的消費者。
你的任務只有：用一到兩句白話文，說明眼前這個早鳥折扣為什麼是這個折數（提早預訂讓店家能照份數備料、減少浪費），以及預購之後有哪些彈性。
只能使用呼叫端給的規則與數字，不要自己補充規則或編造數字。你不負責建議消費者要不要下單，不使用任何催促或行銷式語氣。
同時給繁體中文與英文兩個版本，意思一致。

輸出必須是嚴格的 JSON，符合呼叫端指定的 schema，不要加任何 markdown 或說明文字。`;

const DISCLAIMER = "此為預購規則說明，非購買建議";

/**
 * @param {object} params
 * @param {number} params.discountPercent   e.g. 20 for 20% off
 * @param {"stable"|"variable"|"new"} params.vendorReliabilityTone
 *        Qualitative only — never pass the raw accuracy number to this agent,
 *        (tone reference only; never show specific numbers to diners).
 * @param {object} params.rules  platform settings: tiers, cancelHoursBefore, cancelCouponRate
 * @returns {Promise<{ explanation_text: string, explanation_text_en: string, disclaimer: string }>}
 */
async function generateDiscountExplanation({ discountPercent, vendorReliabilityTone, rules }) {
  const userPrompt = JSON.stringify({
    task: "consumer_discount_explanation",
    discount_percent: discountPercent,
    vendor_reliability_tone: vendorReliabilityTone,
    rules: {
      early_bird_tiers: rules.tiers,
      cutoff: "取餐前一天晚上截單，截單前可免費修改內容與時段",
      cancel: `取餐 ${rules.cancelHoursBefore} 小時前可取消，不退現金，改發原價 ${Math.round(rules.cancelCouponRate * 100)}% 的折價券`,
      transfer: "不能取餐時可以轉讓（自訂 0 元到原價）、贈送朋友、請朋友代領，或在取餐日捐為愛心餐",
      no_show: "沒有取餐的便當會轉為愛心餐，不退款",
    },
    output_schema: {
      explanation_text: "string, 繁體中文 1-2 句，平實、不催促",
      explanation_text_en: "string, the same in English, 1-2 sentences",
    },
  });
  const out = await generateJSON({ systemInstruction: SYSTEM_INSTRUCTION, userPrompt, temperature: 0.4 });
  const zh = typeof out?.explanation_text === "string" ? out.explanation_text.trim().slice(0, 300) : "";
  if (!zh) throw new Error("empty explanation");
  return {
    explanation_text: zh,
    explanation_text_en: typeof out?.explanation_text_en === "string" ? out.explanation_text_en.trim().slice(0, 400) : "",
    disclaimer: DISCLAIMER,
  };
}

const TONES = ["stable", "variable", "new"];

/**
 * Discount explanation in the "price breakdown" on the item page. data: { vendor_id, discount_percent }. No login needed (visible while browsing);
 * the discount must be one of the platform's early-bird tiers, so the cache key space is small and Gemini is called only a few times.
 */
exports.getDiscountExplanation = onCall({}, async (request) => {
  const pct = Number(request.data?.discount_percent);
  const tiers = EARLY_BIRD_TIERS.map((x) => ({ min_days: x.minDays, max_days: x.maxDays, discount_percent: x.discountPercent }));
  if (!tiers.some((x) => x.discount_percent === pct)) throw new HttpsError("invalid-argument", "discount_percent must be an early-bird tier");
  const vendorId = String(request.data?.vendor_id || "");
  const vendorSnap = vendorId ? await db().collection("vendors").doc(vendorId).get() : null;
  const tone = TONES.includes(vendorSnap?.data()?.reliability_tone) ? vendorSnap.data().reliability_tone : "new";
  const config = await loadPlatformConfig(db());
  const rules = { tiers, cancelHoursBefore: config.cancelHoursBefore, cancelCouponRate: config.cancelCouponRate };

  const key = ["v2", pct, tone, rules.cancelHoursBefore, Math.round(rules.cancelCouponRate * 100), tiers.map((x) => `${x.min_days}-${x.max_days}-${x.discount_percent}`).join("_")].join("|");
  const cacheRef = db().collection("discount_explanations").doc(key.replace(/[^a-zA-Z0-9|_.-]/g, "_"));
  const cached = await cacheRef.get();
  let explanation = cached.exists && cached.data().explanation_text ? cached.data() : null;
  if (!explanation) {
    try {
      explanation = await generateDiscountExplanation({ discountPercent: pct, vendorReliabilityTone: tone, rules });
    } catch (err) {
      // Just explanatory text: if it fails we show nothing; ordering is unaffected
      logger.warn("getDiscountExplanation failed", err);
      return { explanation: null };
    }
    await cacheRef.set({ ...explanation, generated_at: FieldValue.serverTimestamp() }).catch(() => undefined);
  }
  const en = request.data?.lang === "en";
  return {
    explanation: en && explanation.explanation_text_en ? explanation.explanation_text_en : explanation.explanation_text,
    disclaimer: en ? "An explanation of the pre-order rules, not a recommendation to buy" : explanation.disclaimer || DISCLAIMER,
  };
});

module.exports.helpers = { generateDiscountExplanation };
