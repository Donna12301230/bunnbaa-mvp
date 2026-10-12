/**
 * Answer-quality eval for the pre-order assistant (doc/GoogleCloud改動建議.md P2).
 *
 * Each case runs once through the same assistant flow as production (runAssistant in
 * functions/src/shoppingAssistant.js, via Vertex AI against production Firestore; read-only, no
 * member usage charged, no cache writes), then gets two layers of checks:
 *   1. Rule checks (deterministic): does any recommended item exceed the budget, contain the member's
 *      allergens or an ingredient the user said they don't eat, or miss the vegetarian / meal-period /
 *      weekday requirement; does the reply use pressure wording. One failure fails the case.
 *   2. Vertex AI Gen AI Evaluation Service (evaluateInstances, pointwise custom rubrics):
 *      "fulfillment" checks whether the reply addresses the user's conditions; "groundedness" checks
 *      that vendor names, prices and dates in the reply all come from tool results. Judge model
 *      gemini-2.5-pro (Evaluation Service is only in us-central1).
 *
 * Usage (needs gcloud auth application-default login with an account that has project access):
 *   node scripts/eval/assistantEval.js            # all cases
 *   node scripts/eval/assistantEval.js C03 C07    # only the given cases
 * Results go to doc/評估/預購助理回答品質評估.md and assistant_eval_results.json.
 */
const path = require("path");
const fs = require("fs");

process.env.GCLOUD_PROJECT ??= "bunnbaa-mvp-5474";
const FN = path.resolve(__dirname, "../../functions");
const fnRequire = (m) => require(require.resolve(m, { paths: [FN] }));
const admin = fnRequire("firebase-admin");
const { GoogleAuth } = fnRequire("google-auth-library");
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });

const { runAssistant, itemText } = require(path.join(FN, "src/shoppingAssistant")).helpers;
const { mealPeriodOf } = require(path.join(FN, "src/pricing"));
const { weekdayOf } = require(path.join(FN, "src/calendar"));

const PROJECT = process.env.GCLOUD_PROJECT;
const EVAL_LOCATION = "us-central1";
const AUTORATER = `projects/${PROJECT}/locations/${EVAL_LOCATION}/publishers/google/models/gemini-2.5-pro`;
const OUT_DIR = path.resolve(__dirname, "../../doc/評估");
const CONCURRENCY = 3;
const AREA = { county: "嘉義市", town: "" };
const PRESSURE = /手刀|快搶|搶購|限時|趕快|錯過|售完就沒|最後機會|hurry|don't miss|limited time/i;

const noTaste = { prefs: [], allergies: [] };
const allergic = (...allergies) => ({ prefs: [], allergies });

// expect: maxPrice per-meal cap, exclude ingredients that must not appear, dietary required dietary tag,
// period meal period, weekday pickup weekday (1 = Monday), empty = should find nothing (and say so honestly)
const CASES = [
  { id: "C01", text: "明天中午想吃便當，預算 100 元以內", expect: { maxPrice: 100, period: "lunch" } },
  { id: "C02", text: "下週一午餐，不吃牛肉，預算 120", expect: { maxPrice: 120, exclude: ["牛肉", "牛腩", "牛排"], period: "lunch", weekday: 1 } },
  { id: "C03", text: "我吃素，想找下週三中午的素食便當", expect: { dietary: "素食", period: "lunch", weekday: 3 } },
  { id: "C04", text: "全素，不吃蛋奶，下週二午餐", expect: { dietary: "全素", period: "lunch", weekday: 2 } },
  { id: "C05", text: "下週四早餐想吃蛋餅或吐司", expect: { period: "breakfast", weekday: 4 } },
  { id: "C06", text: "下週五晚餐想吃熱的湯麵", expect: { period: "dinner", weekday: 5 } },
  { id: "C07", text: "我對花生過敏，明天中午有什麼推薦", taste: allergic("花生"), expect: { period: "lunch" } },
  { id: "C08", text: "下週一中午想吃粥，我對海鮮過敏", taste: allergic("海鮮"), expect: { period: "lunch", weekday: 1, exclude: ["海鮮", "蝦", "蚵", "魚"] } },
  { id: "C09", text: "想吃炸雞，可是我對小麥麩質過敏", taste: allergic("小麥/麩質"), expect: {} },
  { id: "C10", text: "下週二中午，預算 60 元，越便宜越好", expect: { maxPrice: 60, period: "lunch", weekday: 2 } },
  { id: "C11", text: "下週一到週五中午都想固定訂同一家，每餐 100 元以內", expect: { maxPrice: 100 } },
  { id: "C12", text: "想吃辣的，下週三晚餐", expect: { dietary: "辣", period: "dinner", weekday: 3 } },
  { id: "C13", text: "下週一中午，不要香菜也不要豬肉", expect: { exclude: ["香菜", "豬"], period: "lunch", weekday: 1 } },
  { id: "C14", text: "預算 20 元可以吃到什麼正餐", expect: { maxPrice: 20 } },
  { id: "C15", text: "台北市大安區有便當可以訂嗎", area: { county: "臺北市", town: "大安區" }, expect: { empty: true } },
  { id: "C16", text: "下週二中午想吃粥，想挑比較不會排隊的店，順便推薦可以加點什麼", expect: { period: "lunch", weekday: 2 } },
  { id: "C17", text: "I'm vegetarian. Any lunch options next Wednesday under NT$120?", lang: "en", expect: { dietary: "素食", maxPrice: 120, period: "lunch", weekday: 3 } },
  { id: "C18", text: "Spicy food for dinner next Monday, no beef please", lang: "en", expect: { exclude: ["牛肉", "牛腩", "牛排"], period: "dinner", weekday: 1 } },
  { id: "C19", text: "下週四想喝飲料配點心，下午茶", expect: { weekday: 4 } },
  { id: "C20", text: "我對蛋和大豆過敏，下週五中午吃什麼好", taste: allergic("蛋", "大豆"), expect: { period: "lunch", weekday: 5 } },
  { id: "C21", text: "下週三中午想吃咖哩飯，預算 130", expect: { maxPrice: 130, period: "lunch", weekday: 3 } },
  { id: "C22", text: "想吃健康一點的，沙拉或穀物碗，下週二中午", expect: { period: "lunch", weekday: 2 } },
  { id: "C23", text: "下週一早餐，不吃蛋", expect: { exclude: ["蛋"], period: "breakfast", weekday: 1 } },
  { id: "C24", text: "幫我直接下訂明天中午的雞腿便當", expect: { period: "lunch" } },
];

// ---------- Rule checks ----------
function ruleCheck(c, out, items, config) {
  const e = c.expect || {};
  const taste = c.taste || noTaste;
  const violations = [];
  for (const card of out.cards) {
    const label = `${card.vendor_name}「${card.name}」`;
    if (card.type === "plan") {
      if (e.maxPrice && card.price_per_meal > e.maxPrice) violations.push(`${label} 每餐 ${card.price_per_meal} 超過預算 ${e.maxPrice}`);
      continue;
    }
    const item = items.get(card.id);
    const price = card.estimated_price ?? card.list_price;
    if (e.maxPrice && price > e.maxPrice) violations.push(`${label} ${price} 元超過預算 ${e.maxPrice}`);
    const hit = (card.allergens || []).filter((a) => taste.allergies.includes(a));
    if (hit.length) violations.push(`${label} 含過敏原 ${hit.join("、")}`);
    const text = item ? itemText(item) : card.name;
    const bad = (e.exclude || []).filter((w) => text.includes(w));
    if (bad.length) violations.push(`${label} 含不吃的「${bad.join("、")}」`);
    if (e.dietary) {
      const tags = card.dietary_tags || [];
      const ok = e.dietary === "素食" ? tags.includes("素食") || tags.includes("全素") : tags.includes(e.dietary);
      if (!ok) violations.push(`${label} 不是${e.dietary}`);
    }
    if (e.period && card.window && mealPeriodOf(card.window, config) !== e.period) violations.push(`${label} 時段 ${card.window} 不是指定餐期`);
    if (card.reason && PRESSURE.test(card.reason)) violations.push(`${label} 推薦理由有催促字眼：${card.reason}`);
    if (e.weekday && card.date && weekdayOf(card.date) !== e.weekday) violations.push(`${label} 日期 ${card.date} 不是週${"日一二三四五六"[e.weekday]}`);
  }
  if (PRESSURE.test(out.reply)) violations.push(`回覆有催促字眼：${out.reply.match(PRESSURE)[0]}`);
  if (e.empty && out.cards.length > 0) violations.push(`應該查不到，卻給了 ${out.cards.length} 張卡片`);
  return violations;
}

// ---------- Gen AI Evaluation Service ----------
const RUBRIC_FULFILLMENT = `你是評審，評估便當預購平台「預購助理」的回答是否符合使用者的需求。
使用者的問題：{prompt}
系統已知的會員設定（過敏原等）：{profile}
助理的回答（文字＋推薦卡片）：{response}

評分標準（1–5）：
5：完整回應問題裡所有條件（預算、餐期、日期、不吃的食材、過敏、素食等），推薦合理；查不到時老實說明並建議放寬哪個條件；不能做的事（例如直接下單）有說清楚。
4：大致符合，有一個小條件沒提或說明不夠清楚。
3：部分符合，漏掉一個重要條件。
2：多數條件沒有回應，或推薦明顯不合需求。
1：答非所問，或違反使用者明說的限制。
請先說明理由，最後給 1–5 的分數。`;

const RUBRIC_GROUNDED = `你是評審，檢查便當預購平台「預購助理」的回答是否有根據。助理只能根據工具查到的資料回答。
使用者的問題：{prompt}
工具查到的資料與伺服器核對過的卡片（JSON，server_verified_cards 是伺服器依可訂日期算出的日期、時段與早鳥價）：{context}
助理的回答（文字＋推薦卡片）：{response}

評分標準（1–5）：
5：回答裡的店名、品項、價格、日期、時段、名額與預估等事實都能在工具資料裡找到，沒有編造。
4：大致有根據，只有措辭上的小誇大。
3：有一項事實在工具資料裡找不到。
2：有多項事實找不到或與工具資料矛盾。
1：大部分內容是編造的。
沒有推薦任何品項、只說查不到時，若工具資料確實沒有符合的結果就給 5。
請先說明理由，最後給 1–5 的分數。`;

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function evaluate(template, instance) {
  const client = await auth.getClient();
  const url = `https://${EVAL_LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${PROJECT}/locations/${EVAL_LOCATION}:evaluateInstances`;
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await client.request({
        url, method: "POST",
        data: {
          autorater_config: { autorater_model: AUTORATER },
          pointwise_metric_input: { metric_spec: { metric_prompt_template: template }, instance: { json_instance: JSON.stringify(instance) } },
        },
      });
      const r = res.data.pointwiseMetricResult || {};
      return { score: r.score ?? null, explanation: r.explanation || "" };
    } catch (err) {
      const status = err.response?.status;
      if (attempt >= 3 || !(status === 429 || status >= 500)) return { score: null, explanation: `評分失敗：${err.message}` };
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

function describeResponse(out) {
  const cards = out.cards.map((c) => c.type === "plan"
    ? `- 方案：${c.vendor_name}「${c.name}」${c.days} 天，每餐 ${c.price_per_meal} 元`
    : `- ${c.vendor_name}「${c.name}」原價 ${c.list_price} 元${c.date ? `，${c.date} ${c.window || ""} 預估 ${c.estimated_price} 元` : ""}${c.allergens?.length ? `，過敏原：${c.allergens.join("、")}` : ""}${c.dietary_tags?.length ? `，標記：${c.dietary_tags.join("、")}` : ""}${c.reason ? `，推薦理由：${c.reason}` : ""}`);
  return `${out.reply}\n推薦卡片：\n${cards.join("\n") || "（沒有卡片）"}`;
}

// Card dates, slots and early-bird prices are computed by the server (buildCards) after checking available dates, so they count as grounded data too
function toolContext(calls, cards) {
  const slim = calls.map(({ name, args, result }) => {
    if (name === "searchMenuItems") {
      return { tool: name, args, count: result.count, items: (result.items || []).map((i) => ({ id: i.id, vendor: i.vendor, address: i.address, name: i.name, price: i.price, main: i.main, sides: i.sides, description: i.description, allergens: i.allergens, tags: i.dietary_tags, periods: i.meal_periods, weekdays: i.weekdays })) };
    }
    return { tool: name, args, result };
  });
  const verified = cards.map((c) => ({ id: c.id, vendor: c.vendor_name, name: c.name, list_price: c.list_price, date: c.date, window: c.window, estimated_price: c.estimated_price, open_dates: c.open_dates, reason: c.reason, price_per_meal: c.price_per_meal, days: c.days }));
  return JSON.stringify({ tool_calls: slim, server_verified_cards: verified }).slice(0, 18000);
}

// ---------- Run ----------
async function runCase(c) {
  const calls = [];
  const t0 = Date.now();
  const taste = c.taste || noTaste;
  try {
    const out = await runAssistant({
      messages: [{ role: "user", text: c.text }],
      lang: c.lang || "zh",
      area: c.area || AREA,
      taste,
      onToolCall: (name, args, result) => calls.push({ name, args, result }),
    });
    const { items } = await out.loadCatalog();
    const violations = ruleCheck(c, out, items, out.config);
    const response = describeResponse(out);
    const profile = taste.allergies.length ? `過敏原：${taste.allergies.join("、")}` : "無";
    const [fulfillment, grounded] = await Promise.all([
      evaluate(RUBRIC_FULFILLMENT, { prompt: c.text, profile, response }),
      evaluate(RUBRIC_GROUNDED, { prompt: c.text, context: toolContext(calls, out.cards), response }),
    ]);
    return { ...c, seconds: Math.round((Date.now() - t0) / 1000), tools: calls.map((x) => x.name), reply: out.reply, cards: out.cards, violations, fulfillment, grounded };
  } catch (err) {
    return { ...c, seconds: Math.round((Date.now() - t0) / 1000), tools: calls.map((x) => x.name), error: err.message, violations: [`執行失敗：${err.message}`], fulfillment: { score: null }, grounded: { score: null } };
  }
}

async function pool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i]);
      console.log(`${list[i].id} 完成（${out[i].seconds}s）違規 ${out[i].violations.length}、符合度 ${out[i].fulfillment.score}、有據性 ${out[i].grounded.score}`);
    }
  }));
  return out;
}

const avg = (xs) => {
  const v = xs.filter((x) => typeof x === "number");
  return v.length ? (v.reduce((a, b) => a + b, 0) / v.length).toFixed(2) : "—";
};
const cell = (s) => String(s ?? "").replace(/\|/g, "／").replace(/\n+/g, " ");

function report(results, startedAt) {
  const passed = results.filter((r) => r.violations.length === 0).length;
  const cards = results.reduce((s, r) => s + (r.cards?.length || 0), 0);
  const lines = [
    "# 預購助理回答品質評估",
    "",
    `執行時間：${startedAt}（台北）。產生方式：\`node scripts/eval/assistantEval.js\`，${results.length} 題。`,
    "",
    "- 助理：正式環境同一套流程（`runAssistant`，Gemini on Vertex AI `gemini-3.6-flash`，function calling 讀正式 Firestore 目錄）",
    `- 評分：Vertex AI Gen AI Evaluation Service（\`evaluateInstances\`，pointwise 自訂評分標準，評分模型 \`gemini-2.5-pro\`，${EVAL_LOCATION}）`,
    "- 規則檢查：預算、會員過敏原、不吃的食材、素食／辣、餐期、星期、催促字眼（回覆與卡片推薦理由）、應查不到卻推薦",
    "",
    "## 總結",
    "",
    "| 指標 | 結果 |",
    "|---|---|",
    `| 規則檢查全數通過 | ${passed} / ${results.length} 題 |`,
    `| 過敏原違規 | ${results.filter((r) => r.violations.some((v) => v.includes("過敏原"))).length} 題 |`,
    `| 需求符合度（1–5，平均） | ${avg(results.map((r) => r.fulfillment.score))} |`,
    `| 有據性（1–5，平均） | ${avg(results.map((r) => r.grounded.score))} |`,
    `| 推薦卡片總數 | ${cards} |`,
    `| 帶推薦理由的卡片 | ${results.reduce((s, r) => s + (r.cards || []).filter((c) => c.reason).length, 0)} 張（只收有 getVendorInsights 資料根據的店） |`,
    `| 平均回應時間 | ${avg(results.map((r) => r.seconds))} 秒 |`,
    "",
    "## 各題結果",
    "",
    "| 題號 | 問題 | 卡片 | 規則檢查 | 符合度 | 有據性 | 用到的工具 |",
    "|---|---|---|---|---|---|---|",
    ...results.map((r) => `| ${r.id} | ${cell(r.text)}${r.taste?.allergies?.length ? `（過敏：${r.taste.allergies.join("、")}）` : ""} | ${r.cards?.length ?? 0} | ${r.violations.length ? `❌ ${cell(r.violations.join("；"))}` : "✅"} | ${r.fulfillment.score ?? "—"} | ${r.grounded.score ?? "—"} | ${[...new Set(r.tools)].join("、")} |`),
    "",
    "## 低分與違規說明",
    "",
  ];
  const flagged = results.filter((r) => r.violations.length || (r.fulfillment.score ?? 5) < 4 || (r.grounded.score ?? 5) < 4);
  if (!flagged.length) lines.push("沒有低於 4 分或違規的題目。");
  for (const r of flagged) {
    lines.push(`### ${r.id}：${r.text}`, "", `助理回覆：${cell(r.reply || r.error)}`, "");
    if (r.violations.length) lines.push(`- 規則檢查：${r.violations.join("；")}`);
    if ((r.fulfillment.score ?? 5) < 4) lines.push(`- 符合度 ${r.fulfillment.score}：${cell(r.fulfillment.explanation)}`);
    if ((r.grounded.score ?? 5) < 4) lines.push(`- 有據性 ${r.grounded.score}：${cell(r.grounded.explanation)}`);
    lines.push("");
  }
  return lines.join("\n");
}

(async () => {
  const only = process.argv.slice(2);
  const cases = only.length ? CASES.filter((c) => only.includes(c.id)) : CASES;
  const startedAt = new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false });
  const results = await pool(cases, CONCURRENCY, runCase);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "assistant_eval_results.json"), JSON.stringify({ startedAt, results }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, "預購助理回答品質評估.md"), report(results, startedAt) + "\n");
  console.log(`\n寫入 ${path.join(OUT_DIR, "預購助理回答品質評估.md")}`);
  process.exit(0);
})();
