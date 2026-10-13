-- Views for the Looker Studio platform dashboard (doc/AI與GoogleCloud設計.md). Run once; safe to re-run.
-- Prerequisites: 01_demand_forecast.sql and functions/src/customerInsights.sql have both been run.

-- 1. Daily operations (real locks only, no simulated background demand): portions, pickups, rescued via resale, charity meals, no-shows, revenue
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_daily_ops AS
SELECT
  SAFE.PARSE_DATE('%F', pickup_date) AS day,
  COUNT(*) AS locks,
  COUNTIF(status = 'fulfilled') AS fulfilled,
  COUNTIF(status = 'resold_and_fulfilled') AS rescued_by_resale,
  COUNTIF(status = 'charity') AS charity_meals,
  COUNTIF(status = 'no_show') AS no_show,
  -- Rescued = portions that might have been wasted but were eaten in the end (picked up by a resale buyer + converted to charity meals)
  COUNTIF(status IN ('resold_and_fulfilled', 'charity')) AS meals_saved,
  SUM(IFNULL(locked_price, 0)) AS revenue
FROM bunnbaa_analytics.locks_schema_locks_latest
WHERE IFNULL(status, '') != 'cancelled' AND SAFE.PARSE_DATE('%F', pickup_date) IS NOT NULL
GROUP BY day;

-- 2. Platform-wide forecast vs actual (sum of forecasts generated the day before; actual includes simulated background demand, same basis as the forecast input)
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

-- 3. Platform-wide forecast for the next 7 days (latest forecast run)
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_forecast_next AS
SELECT day, ROUND(SUM(forecast)) AS forecast, ROUND(SUM(lower_bound)) AS lower_bound, ROUND(SUM(upper_bound)) AS upper_bound
FROM bunnbaa_analytics.demand_forecast
WHERE generated_date = (SELECT MAX(generated_date) FROM bunnbaa_analytics.demand_forecast)
GROUP BY day;

-- 4. Customer segment distribution (segment names written by Gemini)
CREATE OR REPLACE VIEW bunnbaa_analytics.dash_segments AS
SELECT segment_id, ai.label AS label, ai.description AS description, members, frequency, avg_price, avg_discount, resale_rate, no_show_rate
FROM bunnbaa_analytics.segment_profiles;
