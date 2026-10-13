-- Demand forecast (doc/AI與GoogleCloud設計.md). Run once in the BigQuery console or with bq query --use_legacy_sql=false; safe to re-run.
-- Prerequisites: the extension, backfill and schema views from bigquery/README.md are done (locks_schema_locks_latest and vendors_schema_vendors_latest must exist).
-- The daily forecast is produced by the Cloud Function demandForecast (functions/src/demandForecast.js), which runs AI.FORECAST, writes demand_forecast and writes back to Firestore.

-- 1. Simulated background demand: seed data has only 0-3 portions per vendor per day, so the forecast would be flat. This generates 90 days of simulated portions per vendor,
--    with a weekday effect (campus is quieter on weekends), rain (same day citywide, -15%), slow growth and ±10% noise. FARM_FINGERPRINT is the random source, so re-runs give the same result.
--    Once in production with enough real history, run DROP TABLE bunnbaa_analytics.demand_history_sim and daily_demand will contain only real data.
CREATE OR REPLACE TABLE bunnbaa_analytics.demand_history_sim AS
WITH days AS (
  SELECT day, DATE_DIFF(CURRENT_DATE('Asia/Taipei'), day, DAY) AS days_ago
  FROM UNNEST(GENERATE_DATE_ARRAY(DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL 90 DAY),
                                  DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL 1 DAY))) AS day
),
vendors AS (
  SELECT document_id AS vendor_id
  FROM bunnbaa_analytics.vendors_schema_vendors_latest
  WHERE IFNULL(status, 'active') = 'active'
),
grid AS (
  SELECT
    v.vendor_id, d.day, d.days_ago,
    15 + MOD(ABS(FARM_FINGERPRINT(v.vendor_id)), 25) AS base,
    CASE EXTRACT(DAYOFWEEK FROM d.day) WHEN 1 THEN 0.4 WHEN 7 THEN 0.6 WHEN 6 THEN 1.1 ELSE 1.0 END AS weekday_factor,
    MOD(ABS(FARM_FINGERPRINT(CONCAT('rain-', CAST(d.day AS STRING)))), 100) < 25 AS rainy,
    (MOD(ABS(FARM_FINGERPRINT(CONCAT(v.vendor_id, '-', CAST(d.day AS STRING)))), 21) - 10) / 100 AS noise
  FROM vendors v CROSS JOIN days d
)
SELECT
  vendor_id, day, rainy,
  GREATEST(0, CAST(ROUND(base * weekday_factor * IF(rainy, 0.85, 1.0) * (1 + 0.002 * (90 - days_ago)) * (1 + noise)) AS INT64)) AS locks
FROM grid;

-- 2. Daily demand per vendor: every lock is one portion of demand (resale, charity meals and no-shows count too, they all need prep); cancelled ones are not made and don't count.
--    Only up to yesterday, since locks from today on are still accumulating. Simulated portions are added on top of real ones; source marks whether simulated data was used.
CREATE OR REPLACE VIEW bunnbaa_analytics.daily_demand AS
WITH real AS (
  SELECT vendor_id, SAFE.PARSE_DATE('%F', pickup_date) AS day, COUNT(*) AS locks
  FROM bunnbaa_analytics.locks_schema_locks_latest
  WHERE IFNULL(status, '') != 'cancelled'
  GROUP BY vendor_id, day
)
SELECT
  vendor_id, day,
  IFNULL(r.locks, 0) + IFNULL(s.locks, 0) AS locks,
  IFNULL(r.locks, 0) AS real_locks,
  IF(s.vendor_id IS NULL, 'real', 'real+simulated') AS source
FROM real r
FULL OUTER JOIN bunnbaa_analytics.demand_history_sim s USING (vendor_id, day)
WHERE day IS NOT NULL AND day < CURRENT_DATE('Asia/Taipei');

-- 3. Daily forecast results (written by demandForecast, one partition per day); history is kept so we can compare forecast vs actual
CREATE TABLE IF NOT EXISTS bunnbaa_analytics.demand_forecast (
  generated_date DATE,
  vendor_id STRING,
  day DATE,
  forecast FLOAT64,
  lower_bound FLOAT64,
  upper_bound FLOAT64,
  status STRING
)
PARTITION BY generated_date;

-- 4. Forecast vs actual (for Looker Studio): for each day, take the forecast generated the day before and compare it with that day's actual portions
CREATE OR REPLACE VIEW bunnbaa_analytics.forecast_vs_actual AS
SELECT
  f.vendor_id, f.day, f.forecast, f.lower_bound, f.upper_bound,
  a.locks AS actual,
  SAFE_DIVIDE(ABS(a.locks - f.forecast), a.locks) AS abs_pct_error
FROM bunnbaa_analytics.demand_forecast f
JOIN bunnbaa_analytics.daily_demand a USING (vendor_id, day)
WHERE f.generated_date = DATE_SUB(f.day, INTERVAL 1 DAY);

-- 5. Backtest (optional, for demos): demand_forecast needs a few days of history before forecast vs actual means anything. This pretends a forecast ran every day for the past 14 days,
--    each using only data before that day, matching what the daily schedule produces. The query is the same as FORECAST_SQL in functions/src/demandForecast.js.
FOR r IN (
  SELECT d FROM UNNEST(GENERATE_DATE_ARRAY(DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL 14 DAY),
                                           DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL 1 DAY))) AS d
) DO
  DELETE FROM bunnbaa_analytics.demand_forecast WHERE generated_date = r.d;
  INSERT INTO bunnbaa_analytics.demand_forecast
  SELECT r.d, vendor_id, DATE(forecast_timestamp), forecast_value,
         prediction_interval_lower_bound, prediction_interval_upper_bound, ai_forecast_status
  FROM AI.FORECAST(
    (SELECT vendor_id, day, locks FROM bunnbaa_analytics.daily_demand
     WHERE day < r.d AND day >= DATE_SUB(r.d, INTERVAL 90 DAY)),
    data_col => 'locks', timestamp_col => 'day', id_cols => ['vendor_id'], horizon => 7);
END FOR;
