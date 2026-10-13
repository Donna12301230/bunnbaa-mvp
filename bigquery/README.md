# BigQuery analytics (`bunnbaa_analytics`)

**English** | [中文](README.zh-TW.md)

Firestore is synced to BigQuery with the official **Stream Firestore to BigQuery** extension (`doc/AI與GoogleCloud設計.md`, P0).

- Instance config: `extensions` in `firebase.json` plus `extensions/bq-*.env` (one each for `locks`, `menu_items`, `vendors`, `payment_intents`)
- Dataset: `bunnbaa_analytics` (`asia-east1`), with one `{collection}_raw_changelog` table and one `{collection}_raw_latest` view per collection
- Personal data removed: before writing, the extension calls `bqTransform` (`functions/src/bigqueryExport.js`), which drops phone numbers, notes, transaction ids, pickup codes and similar fields; `payment_intents` keeps only amount, status and timestamps
- Typed views: `schemas/*.json` → `{collection}_schema_{collection}_latest` (for example `locks_schema_locks_latest`); all later SQL queries these views

## Deploy (project owner account, one time)

> Done on 2026-10-10: four extension instances, backfill (vendors 21, menu_items 261, payment_intents 608, locks 3,659 rows, checked for no personal-data fields), schema views, demand-forecast SQL and backtest, and the `demandForecast` schedule.

```bash
# 1. Deploy the transform function first: the extension starts calling it as soon as it is installed
firebase deploy --only functions:bqTransform

# 2. Install the 4 extension instances (the first time you must accept the Extensions terms of service)
firebase deploy --only extensions
```

## Backfill existing data

The extension only syncs writes made after installation. Backfill older data with the import script, and always pass the transform function, or personal data will land in BigQuery:

```bash
for c in locks menu_items vendors payment_intents; do
  npx @firebaseextensions/fs-bq-import-collection --non-interactive \
    -P bunnbaa-mvp-5474 -B bunnbaa-mvp-5474 -q false -m false -u false -e false \
    -s "$c" -d bunnbaa_analytics -t "$c" -l asia-east1 \
    --transform-function-url https://asia-east1-bunnbaa-mvp-5474.cloudfunctions.net/bqTransform
done
```

## Generate the typed views

```bash
cd bigquery
for c in locks menu_items vendors payment_intents; do
  npx @firebaseextensions/fs-bq-schema-views --non-interactive \
    --project=bunnbaa-mvp-5474 --big-query-project=bunnbaa-mvp-5474 \
    --dataset=bunnbaa_analytics --table-name-prefix="$c" \
    --schema-files="./schemas/$c.json"
done
```

To add a field for analysis, edit `schemas/*.json` and run this again. Don't add fields that `bqTransform` removes: they never appear in the data.

## Demand forecast (P1)

1. Run `sql/01_demand_forecast.sql` in the BigQuery console. It creates the simulated background demand `demand_history_sim`, the per-vendor daily demand view `daily_demand`, the forecast table `demand_forecast` and `forecast_vs_actual` for Looker; the last part backfills forecasts for the past 14 days as a backtest (takes a few minutes).
2. Give the functions service account BigQuery access so the scheduled function can query and write:
   ```bash
   SA=<PROJECT_NUMBER>-compute@developer.gserviceaccount.com
   gcloud projects add-iam-policy-binding bunnbaa-mvp-5474 --member="serviceAccount:$SA" --role="roles/bigquery.jobUser"
   ```
   Then in the BigQuery console → `bunnbaa_analytics` → Sharing → Permissions, add the same service account as **BigQuery Data Editor** (on this dataset only, not the whole project).
3. Deploy `demandForecast` (daily at 05:00) and `triggerDemandForecastNow` (manual rerun for admins). After one run, the vendor portal's Reports & insights → Revenue shows the 7-day forecast.

The simulated data is for demonstration only: once there is enough real history, run `DROP TABLE bunnbaa_analytics.demand_history_sim` and `daily_demand` will contain real portions only.

## Basket analysis and customer segments (P1)

The SQL is in `functions/src/customerInsights.sql` (bundled with the functions). `customerInsights` runs it every Monday at 04:00 and produces `basket_pairs`, `buyer_features`, `buyer_segments_model` (k-means), `buyer_segments`, `segment_profiles` (with `AI.GENERATE` segment descriptions) and `vendor_segment_mix`. It can also be pasted into the BigQuery console.

## Looker Studio dashboard (P1)

Run `sql/02_dashboard.sql` to create the dashboard views (run on 2026-10-10). Create the report from the link on the admin console's Dashboard page, then paste the embed URL back on the same page.

## Access

`bunnbaa_analytics` is shared with admins only (BigQuery Data Viewer); Looker Studio connects with an admin account. The data flow is also described in `doc/資安.md`.
