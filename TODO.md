# BunnBaa 開發 TODO

對應文件：`../../BunnBaa_0到1架構文件.docx`（唯一權威文件）、`BunnBaa_技術規格文件_v6_消費者端補強版.docx`、`BunnBaa_現有雛型改造指南.docx`。舊雛型參照：`../../BunnBaa Parse_Ref/`。

## 現在卡在哪（下次先做這個）

Firebase 專案已建好並完成大半設定：`bunnbaa-mvp-5474`（擁有者帳號 `ckchildlikekid@gmail.com`），`.firebaserc` 已連結，Firestore（asia-east1／Taiwan）與 Authentication（匿名登入）都已啟用，`firestore.rules`／`firestore.indexes.json` 也已部署上去。

**卡點**：Cloud Functions 需要專案升級到 Blaze（隨用隨付）方案才能啟用，這需要綁定信用卡/帳單帳戶，所以留給人工手動處理，尚未升級、尚未啟用 Functions。

**下一步**：手動完成 Blaze 升級 → 回來啟用 Functions → 部署 `functions/`。Hosting 目前先跳過，因為 `web/` 還沒 build（沒有 `web/dist`），等 firebaseConfig 換好、本機跑通之後再一起處理。

**Gemini API Key 也要手動申請**：在 [aistudio.google.com/apikey](https://aistudio.google.com/apikey) 用瀏覽器自動化建立金鑰時，Google 判定為「suspicious request」擋下（可能是防機器人機制對自動化互動的偵測），重試也一樣失敗。已經把 GCP 專案 `bunnbaa-mvp-5474` import 進 AI Studio 了，只差手動點「Create API key」→ 選 BunnBaa MVP 專案 → 建立，然後把金鑰貼進 `functions/.env`。

**帳號注意**：這個 GCP/Firebase 專案是掛在 `ckchildlikekid@gmail.com`（鍾雅婷），不是 `tom040798@gmail.com`。CLI 登入、瀏覽器操作都要用前者的帳號，否則 `firebase projects:list` 會顯示空的。

**網域**：`bunnbaa.com` 目前掛在舊專案（Parse 版本），這次 MVP 先不動它，暫時用 Firebase 預設網址 `bunnbaa-mvp-5474.web.app`。之後如果要換成 `bunnbaa.com` 或子網域（如 `app.bunnbaa.com`），再另外處理 DNS，不影響舊專案。

**GitHub**：新專案已建立獨立的 private repo，不跟舊專案共用：https://github.com/Donna12301230/bunnbaa-mvp

**本機環境的路徑雷（重要，重開機/新 session 記得看）**：專案路徑含中文字和 `+` 號（`D:\雅婷\03赫滋與羊\+程式碼\...`），這會讓 Windows 上兩個工具行為相反：
- **Firebase Functions emulator**（`firebase emulators:start --only functions,...`）在這個路徑下會卡在「Cannot determine backend specification. Timeout after 10000」——它內部的 discovery 子行程過不了這種路徑。已建一個 ASCII 路徑的 Windows junction 繞過：`C:\Users\USER\bunnbaa-dev` → 指向這個資料夾。**要跑 emulator suite（含 functions）時，cd 到 `C:\Users\USER\bunnbaa-dev` 執行**，不要在原本中文路徑下跑。
- **Vite dev server**（`npm run dev`）則相反，從 `C:\Users\USER\bunnbaa-dev\web` 跑會出現空白頁（vite 沒有正確 transform TSX，直接吐原始碼給瀏覽器）。**跑 `npm run dev` 時要留在原本的中文路徑**（`.../bunnbaa-prototype/bunnbaa/web`），不要走 junction。
- 也要裝 Java（Firestore/Auth emulator 需要 JRE）：已用 winget 裝了 Microsoft OpenJDK 21，並加進使用者 PATH。新開的終端機視窗應該會自動抓到；如果 `java -version` 抓不到，重開一下終端機。

**已知：`web/.env.local` 裡設了 `VITE_USE_EMULATORS=true`**，這會讓前端連本機 emulator 而不是正式環境 Firestore/Auth，正式部署前記得確認這個檔案不會被打包進去（已經在 `.gitignore` 排除，不會進 repo，但本機建置時如果沒清掉可能誤連 emulator）。

## 環境搭建剩餘步驟

- [x] 上面的 Firebase 專案建立
- [x] `firebase use --add` 連結專案，產生 `.firebaserc`
- [x] 在 Firebase Console 啟用 Firestore（asia-east1）、Authentication（匿名登入）
- [x] 部署 `firestore.rules` 和 `firestore.indexes.json`
- [ ] 升級到 Blaze 方案（需要人工填信用卡資訊）→ 啟用 Functions
- [x] 啟用 Hosting：`web/` 已 build 並部署，正式網址 https://bunnbaa-mvp-5474.web.app （目前正式環境 Firestore 是空的，還沒 seed demo 資料，畫面看不到店家；等要錄 demo 前再灌資料）
- [ ] 申請 Gemini API Key（見上方「現在卡在哪」，需人工操作），填入 `functions/.env`（複製自 `functions/.env.example`）
- [x] 把 `web/src/lib/firebase.ts` 裡的 `firebaseConfig` 換成真實專案設定值（已建立 web app「BunnBaa Web」並填入）
- [x] 本機用 emulator 跑通：`firebase emulators:start --only functions,firestore,auth` + `node scripts/seed.js` + `cd web && npm run dev`（消費者端「鎖定這份」流程已驗證：匿名登入、Firestore 寫入、`onLockCreated` 觸發都正常，只差 Gemini Key 導致折扣說明卡在「產生說明中」，見下方環境注意事項）

已完成：`functions/` 和 `web/` 的 npm 依賴都裝好了，四個 Cloud Functions 檔案語法確認正常，`web` 補了缺失的 `vite-env.d.ts`（原本沒有導致 `import.meta.env` 型別報錯），`npx tsc --noEmit` 已過。

## 業務面（不是我能代勞的部分，記得盡快處理）

- [ ] **LINE Pay／綠界特約商店申請**——審核週期可能數個工作天到數週，越早送件越好，避免卡到最後一週才發現金流串不上

## 骨架裡尚未實作的功能（見 `README.md`「尚未實作」清單）

- [ ] 轉賣流程（`for_resale` → `resold_and_fulfilled`）的實際 UI，目前只有 Firestore rules 預留欄位
- [x] 履約穩定度徽章自動換算：`runCalibrationForVendor`（`dailyCalibration` 和 `triggerCalibrationNow` 都會呼叫到）現在算完 `accuracy_rate` 後會自動更新 `vendor.reliability_tone`（>=80% → stable，否則 variable）。**還沒端到端測過**，因為要真的跑出一份報告需要 Gemini API Key（目前還沒申請），只確認了程式碼語法正確、emulator 有正常 reload；Firestore admin 寫入本身已經在 `markLockOutcome` 驗證過同樣機制沒問題。等 Gemini Key 補上後記得實際點一次「立即產生報告」確認徽章真的會變。
- [ ] 取餐時段推播提醒（spec §3.7，Firebase Cloud Messaging，跟 AI 無關的純 UX）
- [x] 商家後台標記 no-show／備註的介面——新增 `/vendor/redeem`（`VendorRedeemPage.tsx`），已在 emulator 驗證完整流程

## 之後的工作（照架構文件時程表順序）

- [x] 從 `BunnBaa Parse_Ref` 複製可直接沿用的前端元件：
  - **QR Code 掃碼核銷**：`LockQRCode.tsx`（消費者端顯示）+ `VendorRedeemPage.tsx`（商家端查詢核對）。舊專案其實也沒真的做相機掃碼（裝了 `html5-qrcode` 但沒用到），核對方式沿用舊版 `vendor/scan.tsx` 的「手動輸入末 8 碼比對」模式。
  - **表單（react-hook-form + zod）**：用在 `VendorRedeemPage.tsx` 的「登記未取餐」備註欄位（`note` 至少 2 字才能送出）。
  - **Cloudinary 上傳**：`ImageUploadField.tsx` 已搬過來、拿掉 shadcn/ui 依賴改用專案原本的純 CSS 風格，但**還沒接到任何頁面**——這個 MVP 還沒有「新增商家/菜單」的表單，先當備用元件放著，等真的要做商家自助上架時再用。需要的話要在 Cloudinary 後台建一個 unsigned upload preset，設定進 `web/.env.local` 的 `VITE_CLOUDINARY_CLOUD_NAME`／`VITE_CLOUDINARY_UPLOAD_PRESET`（範例見 `web/.env.example`）。
  - 新增了 `markLockOutcome` Cloud Function（`functions/src/index.js`），因為 `firestore.rules` 明確禁止 client 端直接改 lock 狀態，核對取餐／登記未取餐都要走這個 callable。
  - **還沒重新部署到正式 Hosting**：因為 Functions 還沒上 Blaze，正式環境呼叫 `markLockOutcome` 會失敗，先留在本機 emulator 驗證過就好，等 Blaze 升級、Functions 部署後再一起重新 `firebase deploy --only hosting`。
- [ ] 商業邏輯用「參照不複製」原則，依 `locks` 新資料模型重寫（不要逐行翻譯舊的 `cloud/main.js`，資料結構已經不同）
- [ ] 金流串接：LINE Pay／綠界，平台代收、定期撥款商家（`settleVendorPayouts()` Cloud Scheduler，尚未寫）
- [ ] 整合測試 → 部署 Firebase Hosting → 錄 Demo（3 分鐘腳本見 v6 §8）→ 撰寫英文版 Proposal → 10/18 前提交

## 本次不做（列入路線圖，不要誤觸）

揪團（GroupOrder）、現場點餐（TableOrder）、申訴機制（BanAppeal）、多站點美食地圖——全部留在舊 repo，不影響本次原型範圍。
