-- 購物籃與客戶分群（doc/GoogleCloud改動建議.md P1）。由 functions/src/customerInsights.js 每週執行，也可以直接貼到 BigQuery 主控台跑。
-- 只用到 BigQuery 的 bunnbaa_analytics（Firestore 同步過來的 locks，已去個資）。

-- 1. 常一起買：同一位客人在同一家店都買過的兩個品項，算有幾位客人兩個都買過（不限同一天：
--    一筆訂單通常只有一個品項）。confidence＝買過 A 的客人裡也買過 B 的比例。
CREATE OR REPLACE TABLE bunnbaa_analytics.basket_pairs AS
WITH bought AS (
  SELECT DISTINCT vendor_id, buyer_uid, item_name
  FROM bunnbaa_analytics.locks_schema_locks_latest
  WHERE buyer_uid IS NOT NULL AND item_name IS NOT NULL AND IFNULL(status, '') != 'cancelled'
),
item_buyers AS (
  SELECT vendor_id, item_name, COUNT(*) AS buyers FROM bought GROUP BY vendor_id, item_name
),
pairs AS (
  SELECT a.vendor_id, a.item_name AS item_a, b.item_name AS item_b, COUNT(*) AS buyers
  FROM bought a
  JOIN bought b ON a.vendor_id = b.vendor_id AND a.buyer_uid = b.buyer_uid AND a.item_name < b.item_name
  GROUP BY a.vendor_id, item_a, item_b
)
SELECT
  p.vendor_id, p.item_a, p.item_b, p.buyers,
  ROUND(p.buyers / LEAST(ia.buyers, ib.buyers), 3) AS confidence
FROM pairs p
JOIN item_buyers ia ON ia.vendor_id = p.vendor_id AND ia.item_name = p.item_a
JOIN item_buyers ib ON ib.vendor_id = p.vendor_id AND ib.item_name = p.item_b
WHERE p.buyers >= 2;

-- 2. 每位會員的特徵（過去 90 天、取餐日已過、不含取消）：RFM＋早鳥折扣（價格敏感度）＋轉讓與未取餐比例。
--    只買過 1 份的不分群（多半是展示用的一次性帳號，特徵沒有意義）。
CREATE OR REPLACE TABLE bunnbaa_analytics.buyer_features AS
SELECT
  buyer_uid,
  DATE_DIFF(CURRENT_DATE('Asia/Taipei'), MAX(day), DAY) AS recency_days,
  COUNT(*) AS frequency,
  SUM(IFNULL(locked_price, 0)) AS monetary,
  AVG(IFNULL(locked_price, 0)) AS avg_price,
  AVG(IFNULL(discount_percent, 0)) AS avg_discount,
  COUNTIF(status = 'resold_and_fulfilled') / COUNT(*) AS resale_rate,
  COUNTIF(status = 'no_show' OR charity_source = 'noshow') / COUNT(*) AS no_show_rate,
  COUNT(DISTINCT vendor_id) AS vendors
FROM (
  SELECT *, SAFE.PARSE_DATE('%F', pickup_date) AS day
  FROM bunnbaa_analytics.locks_schema_locks_latest
  WHERE buyer_uid IS NOT NULL AND IFNULL(status, '') != 'cancelled'
)
WHERE day < CURRENT_DATE('Asia/Taipei') AND day >= DATE_SUB(CURRENT_DATE('Asia/Taipei'), INTERVAL 90 DAY)
GROUP BY buyer_uid
HAVING COUNT(*) >= 2;

-- 3. K-means 分 4 群（特徵先標準化）
CREATE OR REPLACE MODEL bunnbaa_analytics.buyer_segments_model
OPTIONS (model_type = 'KMEANS', num_clusters = 4, standardize_features = TRUE, kmeans_init_method = 'KMEANS++') AS
SELECT recency_days, frequency, monetary, avg_price, avg_discount, resale_rate, no_show_rate, vendors
FROM bunnbaa_analytics.buyer_features;

CREATE OR REPLACE TABLE bunnbaa_analytics.buyer_segments AS
SELECT buyer_uid, CENTROID_ID AS segment_id
FROM ML.PREDICT(MODEL bunnbaa_analytics.buyer_segments_model, (SELECT * FROM bunnbaa_analytics.buyer_features));

-- 4. 每一群的平均特徵，交給 Gemini（AI.GENERATE）寫一句商家看得懂的中英文描述。
--    prompt 存成欄位：模型偶爾會重複輸出到被截斷（欄位變 null），最後的 UPDATE 只對這些群重試一次。
CREATE OR REPLACE TABLE bunnbaa_analytics.segment_profiles AS
WITH stats AS (
  SELECT
    s.segment_id, COUNT(*) AS members,
    ROUND(AVG(f.recency_days), 1) AS recency_days, ROUND(AVG(f.frequency), 1) AS frequency,
    ROUND(AVG(f.monetary)) AS monetary, ROUND(AVG(f.avg_price)) AS avg_price,
    ROUND(AVG(f.avg_discount), 1) AS avg_discount, ROUND(AVG(f.resale_rate), 3) AS resale_rate,
    ROUND(AVG(f.no_show_rate), 3) AS no_show_rate, ROUND(AVG(f.vendors), 1) AS vendors
  FROM bunnbaa_analytics.buyer_segments s
  JOIN bunnbaa_analytics.buyer_features f USING (buyer_uid)
  GROUP BY s.segment_id
),
overall AS (
  SELECT ROUND(AVG(frequency), 1) AS frequency, ROUND(AVG(avg_price)) AS avg_price, ROUND(AVG(no_show_rate), 3) AS no_show_rate
  FROM bunnbaa_analytics.buyer_features
)
SELECT p.*, AI.GENERATE(p.prompt, endpoint => 'gemini-3.6-flash', model_params => JSON '{"generationConfig": {"temperature": 0.2, "maxOutputTokens": 512}}', output_schema => 'label STRING, description STRING, label_en STRING, description_en STRING') AS ai
FROM (
  SELECT
    stats.*,
    CONCAT(
      '你是便當預購平台的資料分析師。以下是一群會員過去 90 天的平均行為，請用商家看得懂的話描述這群客人。',
      '平台全體平均：每人 ', CAST(overall.frequency AS STRING), ' 份、每份 ', CAST(overall.avg_price AS STRING), ' 元、未取餐比例 ', CAST(overall.no_show_rate AS STRING), '。',
      '這一群：', CAST(stats.members AS STRING), ' 人；距上次取餐 ', CAST(stats.recency_days AS STRING), ' 天；',
      '每人 ', CAST(stats.frequency AS STRING), ' 份、共 ', CAST(stats.monetary AS STRING), ' 元、每份 ', CAST(stats.avg_price AS STRING), ' 元；',
      '平均早鳥折扣 ', CAST(stats.avg_discount AS STRING), '%；轉讓比例 ', CAST(stats.resale_rate AS STRING), '；',
      '未取餐比例 ', CAST(stats.no_show_rate AS STRING), '；常去 ', CAST(stats.vendors AS STRING), ' 家店。',
      'label 是 4～8 個字的中文群名，description 是一句 30 字以內的中文描述（例如「平日午餐固定客，習慣提早預訂拿早鳥價」），',
      'label_en／description_en 是對應的英文。只根據上面的數字描述行為，不要用資料裡沒有的特徵（例如地點、年齡、職業），不要給行銷建議，不要提到個人。'
    ) AS prompt
  FROM stats CROSS JOIN overall
) AS p;

UPDATE bunnbaa_analytics.segment_profiles
SET ai = AI.GENERATE(prompt, endpoint => 'gemini-3.6-flash', model_params => JSON '{"generationConfig": {"temperature": 0.2, "maxOutputTokens": 512}}', output_schema => 'label STRING, description STRING, label_en STRING, description_en STRING')
WHERE ai.label IS NULL OR ai.description IS NULL OR ai.label_en IS NULL OR ai.description_en IS NULL;

-- 5. 每家店的客群分布（只算有分群的會員；商家後台顯示用）
CREATE OR REPLACE TABLE bunnbaa_analytics.vendor_segment_mix AS
SELECT l.vendor_id, s.segment_id, COUNT(DISTINCT l.buyer_uid) AS customers
FROM bunnbaa_analytics.locks_schema_locks_latest l
JOIN bunnbaa_analytics.buyer_segments s USING (buyer_uid)
GROUP BY l.vendor_id, s.segment_id;
