# BigQuery 分析資料（`bunnbaa_analytics`）

Firestore 用官方 extension **Stream Firestore to BigQuery** 同步到 BigQuery（`doc/GoogleCloud改動建議.md` P0）。

- 實例設定：`firebase.json` 的 `extensions` ＋ `extensions/bq-*.env`（`locks`、`menu_items`、`vendors`、`payment_intents` 各一個）
- Dataset：`bunnbaa_analytics`（`asia-east1`），每個集合一張 `{collection}_raw_changelog` 和一個 `{collection}_raw_latest` view
- 去個資：extension 寫入前會呼叫 `bqTransform`（`functions/src/bigqueryExport.js`），拿掉手機、備註、交易序號、取餐碼等欄位；`payment_intents` 只留金額、狀態和時間
- 有型別的 view：`schemas/*.json` → `{collection}_schema_{collection}_latest`（例如 `locks_schema_locks_latest`），後面的 SQL 都查這些 view

## 部署（用專案擁有者帳號，一次性）

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
    -P bunnbaa-mvp-5474 -s "$c" -d bunnbaa_analytics -t "$c" -l asia-east1 \
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

## 權限

`bunnbaa_analytics` 只開給管理員（BigQuery Data Viewer），Looker Studio 用管理員帳號連線。資料流描述同步寫在 `doc/ISMS_管理制度文件.md`。
