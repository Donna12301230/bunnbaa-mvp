/**
 * Consumer-side discount explanation agent.
 * Spec ref: tech doc v6, section 4.2 / 6.2
 *
 * Explains, in one or two plain sentences, why a given discount is what it
 * is and what locking in means (resale rules, pickup window). Never
 * recommends buying — purely explanatory, generate-once-and-cache.
 */
const { generateJSON } = require("./gemini");

const SYSTEM_INSTRUCTION = `你是一個食物預購平台的說明助手，服務對象是正在考慮鎖定訂單的消費者。
你的任務只有：用一到兩句白話文，說明眼前這筆折扣為什麼是這個折數、鎖定之後代表什麼（例如是否可轉賣、取餐時間限制）。
你不負責建議消費者要不要下單，不使用任何催促或行銷式語氣。

輸出必須是嚴格的 JSON，符合呼叫端指定的 schema，不要加任何 markdown 或說明文字。`;

/**
 * @param {object} params
 * @param {number} params.discountPercent   e.g. 20 for "8折"
 * @param {boolean} params.resellable
 * @param {string} params.pickupWindow      e.g. "12:00-13:00"
 * @param {"stable"|"variable"|"new"} params.vendorReliabilityTone
 *        Qualitative only — never pass the raw accuracy number to this agent,
 *        per spec 6.2 ("僅作為語氣參考，不呈現具體數字給消費者").
 * @returns {Promise<{ explanation_text: string, disclaimer: string }>}
 */
async function generateDiscountExplanation({
  discountPercent,
  resellable,
  pickupWindow,
  vendorReliabilityTone,
}) {
  const userPrompt = JSON.stringify({
    task: "consumer_discount_explanation",
    discount_percent: discountPercent,
    resellable,
    pickup_window: pickupWindow,
    vendor_reliability_tone: vendorReliabilityTone,
    output_schema: {
      explanation_text: "string, 1-2 plain sentences, no urgency/marketing language",
      disclaimer: "此為鎖定規則說明，非購買建議",
    },
  });

  return generateJSON({ systemInstruction: SYSTEM_INSTRUCTION, userPrompt, temperature: 0.5 });
}

module.exports = { generateDiscountExplanation };
