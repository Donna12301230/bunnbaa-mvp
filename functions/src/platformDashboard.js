// Admin console "Platform dashboard" (doc/AI與GoogleCloud設計.md): reads the dash_* views from bigquery/sql/02_dashboard.sql
// and returns them as JSON so the site draws the charts itself (the same views also back the Looker Studio report).
// Queried live on each call: the views are tiny (one row per day / segment), so there's no snapshot to keep in sync.
const { BigQuery } = require("@google-cloud/bigquery");
const { onCall, assertAdminViewerOrEmulator } = require("./common");

const DATASET = "bunnbaa_analytics";
const BQ_LOCATION = "asia-east1";
const DAILY_DAYS = 90;
const BACKTEST_DAYS = 30;

const QUERIES = {
  daily: `SELECT CAST(day AS STRING) AS day, locks, fulfilled, rescued_by_resale, charity_meals, no_show, meals_saved, CAST(revenue AS FLOAT64) AS revenue
          FROM ${DATASET}.dash_daily_ops
          WHERE day >= DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL ${DAILY_DAYS} DAY) AND day <= CURRENT_DATE('Asia/Taipei')
          ORDER BY day`,
  backtest: `SELECT CAST(day AS STRING) AS day, forecast, lower_bound, upper_bound, actual, wape
             FROM ${DATASET}.dash_forecast_vs_actual
             WHERE day >= DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL ${BACKTEST_DAYS} DAY)
             ORDER BY day`,
  next: `SELECT CAST(day AS STRING) AS day, forecast, lower_bound, upper_bound
         FROM ${DATASET}.dash_forecast_next
         ORDER BY day`,
  segments: `SELECT segment_id, label, label_en, description, description_en, members, frequency, CAST(avg_price AS FLOAT64) AS avg_price, CAST(avg_discount AS FLOAT64) AS avg_discount, resale_rate, no_show_rate
             FROM ${DATASET}.dash_segments
             ORDER BY members DESC`,
};

let bigquery;
const bq = () => (bigquery ??= new BigQuery());

async function loadPlatformDashboard() {
  const entries = await Promise.all(
    Object.entries(QUERIES).map(async ([key, query]) => [key, (await bq().query({ query, location: BQ_LOCATION }))[0]])
  );
  return { ...Object.fromEntries(entries), generated_at: new Date().toISOString() };
}

/** Admin console platform dashboard data (admins, plus the read-only demo admin) */
exports.getPlatformDashboard = onCall({ timeoutSeconds: 60 }, async (request) => {
  assertAdminViewerOrEmulator(request);
  return loadPlatformDashboard();
});

exports.helpers = { QUERIES };
