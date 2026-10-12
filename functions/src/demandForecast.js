// Demand forecast (doc/GoogleCloud改動建議.md P1): BigQuery AI.FORECAST (TimesFM, no training) predicts each vendor's portions for the next 7 days.
// Data: bunnbaa_analytics.daily_demand (locks synced by the Firestore → BigQuery extension, plus simulated background demand for demos);
// table and view setup is in bigquery/sql/01_demand_forecast.sql.
// Results go into BigQuery demand_forecast (history kept so Looker can compare forecast vs actual), then are written back to Firestore
// vendors/{vendorId}/forecast/{YYYY-MM-DD}, where the vendor portal's report page shows "N expected tomorrow".
// Same principle as vendorCalibration: reference only, no prep instructions (under prepayment every portion has to be made).
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { BigQuery } = require("@google-cloud/bigquery");
const { REGION, db, onCall, logger, FieldValue, assertAdminOrEmulator, BatchWriter } = require("./common");
const { taipeiToday } = require("./calendar");

const DATASET = "bunnbaa_analytics";
const BQ_LOCATION = "asia-east1";
const HORIZON = 7;
const LOOKBACK_DAYS = 90;
const MODEL = "TimesFM 2.5"; // AI.FORECAST's default model; written to Firestore so the frontend can show the source

// Same query as section 5 (backtest) of bigquery/sql/01_demand_forecast.sql
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

/** Run one forecast and write it back to Firestore; returns how many vendors and rows were written */
async function runDemandForecast(runDate = taipeiToday()) {
  const [rows] = await bq().query({
    query: FORECAST_SQL,
    location: BQ_LOCATION,
    // Must use BigQuery.date(): a plain string with types DATE is sent as null, and the INSERT ends up with 0 rows
    params: { run_date: BigQuery.date(runDate) },
  });
  const writer = new BatchWriter();
  const vendors = new Set();
  let written = 0;
  for (const r of rows) {
    // ai_forecast_status empty string = success; on errors such as too little data, forecast is null
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

/** For demos/testing: re-run today's forecast now without waiting for the schedule (admins only) */
exports.triggerDemandForecastNow = onCall({ timeoutSeconds: 300 }, async (request) => {
  assertAdminOrEmulator(request);
  return runDemandForecast();
});

exports.helpers = { runDemandForecast, FORECAST_SQL };
