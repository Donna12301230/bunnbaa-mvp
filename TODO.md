# BunnBaa 開發 TODO

對應文件：`../../BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`、`BunnBaa_現有雛型改造指南.docx`。舊雛型參照：`../../BunnBaa Parse_Ref/`。

## 現在卡在哪（下次先做這個）

Firebase 專案已建好並完成大半設定：`bunnbaa-mvp-5474`（擁有者帳號 `ckchildlikekid@gmail.com`），`.firebaserc` 已連結，Firestore（asia-east1／Taiwan）與 Authentication（匿名登入）都已啟用，`firestore.rules`／`firestore.indexes.json` 也已部署上去。

**卡點**：Cloud Functions 需要專案升級到 Blaze（隨用隨付）方案才能啟用，這需要綁定信用卡/帳單帳戶，所以留給人工手動處理，尚未升級、尚未啟用 Functions。

**下一步**：手動完成 Blaze 升級 → 回來啟用 Functions → 部署 `functions/`。Hosting 目前先跳過，因為 `web/` 還沒 build（沒有 `web/dist`），等 firebaseConfig 換好、本機跑通之後再一起處理。

**Gemini API Key 也要手動申請**：在 [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 用瀏覽器自動化建立金鑰時，Google 判定為「suspicious request」擋下（可能是防機器人機制對自動化互動的偵測），重試也一樣失敗。已經把 GCP 專案 `bunnbaa-mvp-5474` import 進 AI Studio 了，只差手動點「Create API key」→ 選 BunnBaa MVP 專案 → 建立，然後把金鑰貼進 `functions/.env`。

**帳號注意**：這個 GCP/Firebase 專案是掛在 `ckchildlikekid@gmail.com`（鍾雅婷），不是 `tom040798@gmail.com`。CLI 登入、瀏覽器操作都要用前者的帳號，否則 `firebase projects:list` 會顯示空的。

## 環境搭建剩餘步驟

- [x] 上面的 Firebase 專案建立
- [x] `firebase use --add` 連結專案，產生 `.firebaserc`
- [x] 在 Firebase Console 啟用 Firestore（asia-east1）、Authentication（匿名登入）
- [x] 部署 `firestore.rules` 和 `firestore.indexes.json`
- [ ] 升級到 Blaze 方案（需要人工填信用卡資訊）→ 啟用 Functions
- [ ] 啟用 Hosting（等 `web/` 有 build 產物後再做）
- [ ] 申請 Gemini API Key（見上方「現在卡在哪」，需人工操作），填入 `functions/.env`（複製自 `functions/.env.example`）
- [x] 把 `web/src/lib/firebase.ts` 裡的 `firebaseConfig` 換成真實專案設定值（已建立 web app「BunnBaa Web」並填入）
- [ ] 本機用 emulator 跑通：`firebase emulators:start --only functions,firestore,auth` + `node scripts/seed.js` + `cd web && npm run dev`

已完成：`functions/` 和 `web/` 的 npm 依賴都裝好了，四個 Cloud Functions 檔案語法確認正常，`web` 補了缺失的 `vite-env.d.ts`（原本沒有導致 `import.meta.env` 型別報錯），`npx tsc --noEmit` 已過。

## 業務面（不是我能代勞的部分，記得盡快處理）

- [ ] **LINE Pay／綠界特約商店申請**——審核週期可能數個工作天到數週，越早送件越好，避免卡到最後一週才發現金流串不上

## 骨架裡尚未實作的功能（見 `README.md`「尚未實作」清單）

- [ ] 轉賣流程（`for_resale` → `resold_and_fulfilled`）的實際 UI，目前只有 Firestore rules 預留欄位
- [ ] 履約穩定度徽章自動換算（目前 `vendor.reliability_tone` 是手動欄位，應該由 `dailyCalibration` 依 `accuracy_rate` 自動更新，例如 >80% = 穩定）
- [ ] 取餐時段推播提醒（spec §3.7，Firebase Cloud Messaging，跟 AI 無關的純 UX）
- [ ] 商家後台標記 no-show／備註的介面（目前 `seed.js` 是寫死模擬資料）

## 之後的工作（照架構文件時程表順序）

- [ ] 從 `BunnBaa Parse_Ref` 複製可直接沿用的前端元件：表單（react-hook-form + zod）、QR Code 掃碼核銷、Cloudinary 上傳設定——只改資料請求那幾行（Parse SDK → Firestore SDK）
- [ ] 商業邏輯用「參照不複製」原則，依 `locks` 新資料模型重寫（不要逐行翻譯舊的 `cloud/main.js`，資料結構已經不同）
- [ ] 金流串接：LINE Pay／綠界，平台代收、定期撥款商家（`settleVendorPayouts()` Cloud Scheduler，尚未寫）
- [ ] 整合測試 → 部署 Firebase Hosting → 錄 Demo（3 分鐘腳本見 v6 §8）→ 撰寫英文版 Proposal → 10/18 前提交

## 本次不做（列入路線圖，不要誤觸）

揪團（GroupOrder）、現場點餐（TableOrder）、申訴機制（BanAppeal）、多站點美食地圖——全部留在舊 repo，不影響本次原型範圍。
