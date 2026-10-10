// 需求預測（doc/GoogleCloud改動建議.md P1）：BigQuery AI.FORECAST（TimesFM，免訓練）預測每家店未來 7 天的份數。
// 資料：bunnbaa_analytics.daily_demand（Firestore → BigQuery extension 同步的 locks，加上展示用的模擬背景需求），
// 建表與 view 見 bigquery/sql/01_demand_forecast.sql。
// 結果寫進 BigQuery demand_forecast（保留歷史，給 Looker 比「預測 vs 實際」），再回寫 Firestore
// vendors/{vendorId}/forecast/{YYYY-MM-DD}，商家後台報表頁顯示「預估明天 N 份」。
// 跟 vendorCalibration 同一個原則：只給參考，不下備料指令（預付制下每一份都要做）。
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { BigQuery } = require("@google-cloud/bigquery");
const { REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, BatchWriter } = require("./common");
const { taipeiToday } = require("./calendar");

const DATASET = "bunnbaa_analytics";
const BQ_LOCATION = "asia-east1";
const HORIZON = 7;
const LOOKBACK_DAYS = 90;
const MODEL = "TimesFM 2.5"; // AI.FORECAST 預設模型，寫進 Firestore 讓前端標示來源

// 跟 bigquery/sql/01_demand_forecast.sql 第 5 段（回測）同一個查詢
const FORECAST_SQL = `
DECLARE run_date DATE DEFAULT @run_date;
DELETE FROM ${DATASET}.demand_forecast WHERE generated_date = run_date;
INSERT INTO ${DATASET}.demand_forecast
SELECT run_date, vendor_id, DATE(forecast_timestamp), forecast_value,
       prediction_interval_lower_bound, prediction_interval_upper_bound, ai_forecast_status
FROM AI.FORECAST(
  (SELECT vendor_id, day, locks FROM ${DATASET}.daily_demand
   WHERE day < run_date AND day >= DATE_SUB(run_date, INTERVAL ${LOOKBACK_DAYS} DAY)),
  data_col => 'locks', timestamp_col => 'day', id_cols => ['vendor_id'], horizon => ${HORIZON});
SELECT vendor_id, CAST(day AS STRING) AS day, forecast, lower_bound, upper_bound, status
FROM ${DATASET}.demand_forecast
WHERE generated_date = run_date;
`;

let bigquery;
const bq = () => (bigquery ??= new BigQuery());

/** 跑一次預測並回寫 Firestore，回傳寫了幾家店、幾筆 */
async function runDemandForecast(runDate = taipeiToday()) {
  const [rows] = await bq().query({
    query: FORECAST_SQL,
    location: BQ_LOCATION,
    // 要用 BigQuery.date()：純字串配 types DATE 會被當成 null 送出，INSERT 就變成 0 筆
    params: { run_date: BigQuery.date(runDate) },
  });
  const writer = new BatchWriter();
  const vendors = new Set();
  let written = 0;
  for (const r of rows) {
    // ai_forecast_status 空字串＝成功；資料太短等錯誤時 forecast 是 null
    if (r.status || r.forecast == null) {
      logger.warn(`demandForecast: ${r.vendor_id} ${r.day} skipped: ${r.status}`);
      continue;
    }
    vendors.add(r.vendor_id);
    written++;
    await writer.set(db().doc(`vendors/${r.vendor_id}/forecast/${r.day}`), {
      day: r.day,
      forecast: Math.max(0, Math.round(r.forecast)),
      lower: Math.max(0, Math.floor(r.lower_bound)),
      upper: Math.max(0, Math.ceil(r.upper_bound)),
      generated_date: runDate,
      model: MODEL,
      generated_at: FieldValue.serverTimestamp(),
    });
  }
  await writer.flush();
  return { vendors: vendors.size, days: written };
}

exports.demandForecast = onSchedule(
  { schedule: "every day 05:00", timeZone: "Asia/Taipei", region: REGION, timeoutSeconds: 300 },
  async () => {
    const result = await runDemandForecast();
    logger.info("demandForecast done", result);
  }
);

/** 展示／測試用：不等排程，立刻重跑今天的預測（只限管理員） */
exports.triggerDemandForecastNow = onCall({ timeoutSeconds: 300 }, async (request) => {
  assertAdminOrEmulator(request);
  return runDemandForecast();
});

exports.helpers = { runDemandForecast, FORECAST_SQL };
