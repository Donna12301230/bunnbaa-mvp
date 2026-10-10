-- 需求預測（doc/GoogleCloud改動建議.md P1）。在 BigQuery 主控台或 bq query --use_legacy_sql=false 執行一次即可，可重跑。
-- 前提：bigquery/README.md 的 extension、回填、schema view 都已完成（要有 locks_schema_locks_latest、vendors_schema_vendors_latest）。
-- 每天的預測由 Cloud Function demandForecast（functions/src/demandForecast.js）跑 AI.FORECAST，寫進 demand_forecast 並回寫 Firestore。

-- 1. 模擬背景需求：種子資料每店每天只有 0～3 份，預測會很平。這裡依每家店產生過去 90 天的模擬份數，
--    含星期效應（校園週末少）、雨天（全市同一天，-15%）、緩慢成長與 ±10% 雜訊。用 FARM_FINGERPRINT 當亂數，重跑結果一樣。
--    正式上線、真實資料夠長後執行 DROP TABLE bunnbaa_analytics.demand_history_sim，daily_demand 就只剩真實資料。
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

-- 2. 每店每日需求：每筆鎖定都是一份需求（轉讓、愛心餐、未取餐也算，都要備料）；取消的不用做，不算。
--    只算到昨天，今天以後的鎖定還在累積。模擬份數疊加在真實份數上，source 標出有沒有用到模擬資料。
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

-- 3. 每天的預測結果（demandForecast 寫入，一天一個分區），保留歷史才能比「預測 vs 實際」
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

-- 4. 預測 vs 實際（Looker Studio 用）：取每一天「前一天產生」的預測，跟當天實際份數比
CREATE OR REPLACE VIEW bunnbaa_analytics.forecast_vs_actual AS
SELECT
  f.vendor_id, f.day, f.forecast, f.lower_bound, f.upper_bound,
  a.locks AS actual,
  SAFE_DIVIDE(ABS(a.locks - f.forecast), a.locks) AS abs_pct_error
FROM bunnbaa_analytics.demand_forecast f
JOIN bunnbaa_analytics.daily_demand a USING (vendor_id, day)
WHERE f.generated_date = DATE_SUB(f.day, INTERVAL 1 DAY);

-- 5. 回測（選做，展示用）：demand_forecast 要累積幾天才有「預測 vs 實際」。這段假裝過去 14 天每天都跑過一次預測，
--    每次只用當天以前的資料，結果跟每天排程跑的一樣。查詢內容與 functions/src/demandForecast.js 的 FORECAST_SQL 相同。
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
