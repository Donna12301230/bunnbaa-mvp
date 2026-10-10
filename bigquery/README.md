# BigQuery 分析資料（`bunnbaa_analytics`）

Firestore 用官方 extension **Stream Firestore to BigQuery** 同步到 BigQuery（`doc/GoogleCloud改動建議.md` P0）。

- 實例設定：`firebase.json` 的 `extensions` ＋ `extensions/bq-*.env`（`locks`、`menu_items`、`vendors`、`payment_intents` 各一個）
- Dataset：`bunnbaa_analytics`（`asia-east1`），每個集合一張 `{collection}_raw_changelog` 和一個 `{collection}_raw_latest` view
- 去個資：extension 寫入前會呼叫 `bqTransform`（`functions/src/bigqueryExport.js`），拿掉手機、備註、交易序號、取餐碼等欄位；`payment_intents` 只留金額、狀態和時間
- 有型別的 view：`schemas/*.json` → `{collection}_schema_{collection}_latest`（例如 `locks_schema_locks_latest`），後面的 SQL 都查這些 view

## 部署（用專案擁有者帳號，一次性）

> 2026-10-10 已全部完成：四個 extension 實例、回填（vendors 21、menu_items 261、payment_intents 608、locks 3,659 筆，已查核沒有個資欄位）、schema view、需求預測 SQL 與回測、`demandForecast` 排程。

```bash
# 1. 先部署 transform function：extension 安裝時就會開始呼叫它
firebase deploy --only functions:bqTransform

# 2. 安裝 4 個 extension 實例（第一次要同意 Extensions 服務條款）
firebase deploy --only extensions
```

## 回填既有資料

extension 只同步安裝之後的寫入。舊資料要用匯入腳本回填，而且要帶 transform function，不然個資會寫進 BigQuery：

```bash
for c in locks menu_items vendors payment_intents; do
  npx @firebaseextensions/fs-bq-import-collection --non-interactive \
    -P bunnbaa-mvp-5474 -B bunnbaa-mvp-5474 -q false -m false -u false -e false \
    -s "$c" -d bunnbaa_analytics -t "$c" -l asia-east1 \
    --transform-function-url https://asia-east1-bunnbaa-mvp-5474.cloudfunctions.net/bqTransform
done
```

## 產生有型別的 view

```bash
cd bigquery
for c in locks menu_items vendors payment_intents; do
  npx @firebaseextensions/fs-bq-schema-views --non-interactive \
    --project=bunnbaa-mvp-5474 --big-query-project=bunnbaa-mvp-5474 \
    --dataset=bunnbaa_analytics --table-name-prefix="$c" \
    --schema-files="./schemas/$c.json"
done
```

新增分析需要的欄位時，改 `schemas/*.json` 再跑一次即可。被 `bqTransform` 拿掉的欄位不要加進 schema，因為那些欄位不會出現在資料裡。

## 需求預測（P1）

1. 在 BigQuery 主控台執行 `sql/01_demand_forecast.sql`：建立模擬背景需求 `demand_history_sim`、每店每日需求 view `daily_demand`、預測結果表 `demand_forecast`、Looker 用的 `forecast_vs_actual`，最後一段回測會補上過去 14 天的預測（要跑幾分鐘）。
2. 給 functions 服務帳號 BigQuery 權限，讓排程函式能查詢和寫入：
   ```bash
   SA=<PROJECT_NUMBER>-compute@developer.gserviceaccount.com
   gcloud projects add-iam-policy-binding bunnbaa-mvp-5474 --member="serviceAccount:$SA" --role="roles/bigquery.jobUser"
   ```
   再到 BigQuery 主控台 → `bunnbaa_analytics` → 共用 → 權限，把同一個服務帳號加成「BigQuery 資料編輯者」（只給這個 dataset，不開整個專案）。
3. 部署 `demandForecast`（每天 05:00）與 `triggerDemandForecastNow`（管理員手動重跑），跑一次後商家後台「報表與洞察 → 營收」會出現「未來 7 天預估份數」。

模擬資料只是展示用：真實資料夠長後執行 `DROP TABLE bunnbaa_analytics.demand_history_sim`，`daily_demand` 就只剩真實份數。

## 購物籃與客戶分群（P1）

SQL 在 `functions/src/customerInsights.sql`（函式部署時一起打包），由 `customerInsights` 每週一 04:00 執行，產生 `basket_pairs`、`buyer_features`、`buyer_segments_model`（K-means）、`buyer_segments`、`segment_profiles`（含 `AI.GENERATE` 群組描述）、`vendor_segment_mix`。也可以直接貼到 BigQuery 主控台跑。

## 權限

`bunnbaa_analytics` 只開給管理員（BigQuery Data Viewer），Looker Studio 用管理員帳號連線。資料流描述同步寫在 `doc/ISMS_管理制度文件.md`。
