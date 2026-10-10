-- Looker Studio 平台儀表板用的 view（doc/GoogleCloud改動建議.md P1）。執行一次即可，可重跑。
-- 前提：01_demand_forecast.sql 與 functions/src/customerInsights.sql 都跑過。

-- 1. 每日營運（只算真實鎖定，不含模擬背景需求）：份數、取餐、轉讓救回、愛心餐、未取餐、營收
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_daily_ops AS
SELECT
  SAFE.PARSE_DATE('%F', pickup_date) AS day,
  COUNT(*) AS locks,
  COUNTIF(status = 'fulfilled') AS fulfilled,
  COUNTIF(status = 'resold_and_fulfilled') AS rescued_by_resale,
  COUNTIF(status = 'charity') AS charity_meals,
  COUNTIF(status = 'no_show') AS no_show,
  -- 救回＝原本可能浪費、最後有人吃到的份數（轉讓給別人取餐＋轉成愛心餐）
  COUNTIF(status IN ('resold_and_fulfilled', 'charity')) AS meals_saved,
  SUM(IFNULL(locked_price, 0)) AS revenue
FROM bunnbaa_analytics.locks_schema_locks_latest
WHERE IFNULL(status, '') != 'cancelled' AND SAFE.PARSE_DATE('%F', pickup_date) IS NOT NULL
GROUP BY day;

-- 2. 全平台預測 vs 實際（每天前一天產生的預測加總；實際含模擬背景需求，跟預測的輸入同一個口徑）
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_forecast_vs_actual AS
SELECT
  day,
  ROUND(SUM(forecast)) AS forecast,
  ROUND(SUM(lower_bound)) AS lower_bound,
  ROUND(SUM(upper_bound)) AS upper_bound,
  SUM(actual) AS actual,
  ROUND(SAFE_DIVIDE(SUM(ABS(actual - forecast)), SUM(actual)), 3) AS wape
FROM bunnbaa_analytics.forecast_vs_actual
GROUP BY day;

-- 3. 未來 7 天全平台預估（最新一次預測）
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_forecast_next AS
SELECT day, ROUND(SUM(forecast)) AS forecast, ROUND(SUM(lower_bound)) AS lower_bound, ROUND(SUM(upper_bound)) AS upper_bound
FROM bunnbaa_analytics.demand_forecast
WHERE generated_date = (SELECT MAX(generated_date) FROM bunnbaa_analytics.demand_forecast)
GROUP BY day;

-- 4. 客群分布（Gemini 寫的群名）
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_segments AS
SELECT segment_id, ai.label AS label, ai.description AS description, members, frequency, avg_price, avg_discount, resale_rate, no_show_rate
FROM bunnbaa_analytics.segment_profiles;
