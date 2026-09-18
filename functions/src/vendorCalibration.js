/**
 * Vendor-side calibration agent.
 * Spec ref: tech doc v6, section 4.1 / 4.1a / 6.1
 *
 * Compares locked quantity vs. actual fulfillment per vendor, reads free-text
 * no-show/resale notes and consumer feedback, and produces a transparency
 * report. Never outputs a restocking instruction — output is explicitly
 * labeled as reference-only.
 */
const { generateJSON } = require("./gemini");

const SYSTEM_INSTRUCTION = `你是一個食物預購平台的校準助手，服務對象是使用預購鎖定機制的商家。
你不負責建議商家該備多少貨，你的任務只有：
1) 根據這個商家過去每一輪「鎖定量」與「實際履約量」的比對紀錄，計算目前的預測準確率與誤差區間
2) 讀取商家為 no-show／轉賣紀錄留下的自由文字備註，歸納出可能的落差模式（例如與星期、天氣、時段的關聯），若資料不足以歸納出模式，明確說明「目前資料量不足以判斷模式」
3) 若商家針對報告追問情境式問題（例如「如果鎖定量調高 10% 會怎樣」），根據歷史落差模式生成情境式參考答案，語氣維持假設性、不下結論
4) 明確標註：這是參考資訊，不是備貨建議，最終決定權在商家

輸出必須是嚴格的 JSON，符合呼叫端指定的 schema，不要加任何 markdown 或說明文字。`;

/**
 * @param {object} params
 * @param {Array<{
 *   period: string,
 *   locked_qty: number,
 *   fulfilled_qty: number,
 *   no_show_notes: string[],
 *   consumer_feedback: string[],
 * }>} params.history  Past rounds for this vendor, oldest first.
 * @param {string} [params.scenarioQuestion]  Optional what-if question from the vendor (4.1a).
 * @returns {Promise<{
 *   accuracy_rate: number,
 *   error_range: string,
 *   explanation: string,
 *   pattern_note: string,
 *   scenario_answer: string,
 *   disclaimer: string,
 * }>}
 */
async function generateVendorCalibrationReport({ history, scenarioQuestion }) {
  if (!history || history.length === 0) {
    throw new Error("generateVendorCalibrationReport: history must be non-empty");
  }

  const userPrompt = JSON.stringify({
    task: "vendor_calibration_report",
    history,
    scenario_question: scenarioQuestion || null,
    output_schema: {
      accuracy_rate: "number (0-1)",
      error_range: "string, e.g. '±3 份'",
      explanation: "string, plain-language summary of current accuracy",
      pattern_note:
        "string, free-text pattern found in no_show_notes/consumer_feedback, or '目前資料量不足以判斷模式'",
      scenario_answer:
        "string, hypothetical answer to scenario_question, empty string if scenario_question is null",
      disclaimer: "此為預測準確率參考資訊，非備貨建議",
    },
  });

  return generateJSON({ systemInstruction: SYSTEM_INSTRUCTION, userPrompt });
}

module.exports = { generateVendorCalibrationReport };
