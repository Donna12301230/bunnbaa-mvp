# BunnBaa 開發 TODO

**10/18 前提交 Demo＋英文 Proposal。** 投稿前本檔會刪掉。已完成項目看 git 歷史（`git show fe1dc91:doc/TODO.md` 是 10/12 分工前的完整版）。

分工：A＝消費者端＋後端／Google Cloud，B＝商家端＋管理後台＋投稿素材。bug 在誰的區域誰修；跨區域由寫入資料的一方修。測試照 [測試文件.md](測試文件.md)，測完直接改結果欄。

---

## 🚨 最優先

- [ ] `ckchildlikekid@gmail.com`（GCP 專案擁有者）開 2FA；SU 確認管理員帳號密碼夠強、Google 帳號有 2FA
- [ ] Firebase Web API key 加 HTTP 參照網址限制：`bunnbaa-mvp-5474.web.app/*`、`bunnbaa-mvp-5474.firebaseapp.com/*`、`bunnbaa-mvp-5474--*.web.app/*`、`localhost:5300/*`
- [x] 正式站示範商家帳號（A＋B）：`vendor@bunnbaa.test` 已建好並綁仁和雅，登入頁有一鍵登入，README「Try it」兩份都已補上（10/13 正式站實測：按「以店家身分體驗」進得了店家後台）；不給評審管理員帳號
- [-] 以上做完，無痕＋英文瀏覽器走一次評審路徑：開站 → 看菜單 → 體驗帳號登入 → 問預購助理 → 商家帳號看備料與預估。10/13 已用一般視窗＋`?lang=en` 走過一次（兩個體驗帳號、預購助理、備料、報表都正常，殘留中文已修並部署）；待：上面兩項做完後用無痕再走一次

## 🔴 A：消費者端＋後端

- [-] 已從店家設定移除的取餐時段，上面的訂單不進備料時間軸（`prepPlans.timelines`）：程式已改（未部署）——截單時沒有對應店家時段的餐期，改用該餐期訂單自己的取餐時段組出範圍（同 `lockPeriodRangesOn`）。10-13 emulator 驗證：仁和雅 6 份 → 「午餐・4 份」＋「晚餐 17:30-18:30・2 份」。待：推 master 自動部署
- 測試：
  - [-] C-AST-17（PARTIAL）
  - [ ] C-MY-03、C-ORD-02（LINE Pay Sandbox 成功頁）
  - [ ] 重測：C-MY-17、C-BNT-08、C-PLN-01、C-BNT-09、C-CHR-05（文字已過，按預約與倒數待測）
  - [ ] 正式站限定：C-NAV-03、C-AUTH-04／05、C-CHR-06、C-MY-13、C-MTC-09、C-CHR-14、F-11、F-12、N-SEC-01～03、N-PRF-01
  - [ ] 端到端情境（第 9 章）至少跑 A、C、G
- 正式站實際點過：
  - [ ] 組便當 → 購物車套券 → LINE Pay → 我的餐點（QR、修改、取消、代領碼、捐愛心餐）
  - [ ] 加入計畫走 LINE Pay（N 筆 `locks` 同 `plan_id`；某天額滿要擋）；被封鎖時顯示白話提示
  - [ ] 購物車跨店結帳，`locks.vendor_id` 正確
  - [ ] 回饋期結算後抽獎；評分（重複評分要擋）
  - [ ] 真機：定位、取餐提醒推播、OTP 簡訊
- 收尾：
  - [ ] 清測試資料：`customer@bunnbaa.test` 的「A方案」5 筆 locks（`3FISlB1jhR7o8hVo4YHo`、`4XYmoY4zyhT1kFaHATzz`、`JBeV9Xc7C58da8YF09xv`、`GtAMfgcFRBymMQ2cdjXh`、`jNnDK42dOdMF75jckhWe`）、`ban_appeals/lI5dGTVtIBfByBIUTy3W`、`EJEL6PRO`（可選）
  - [ ] 最後核對 README 數字（Functions 81、logic 64、rules 65、Functions 測試 144）。10/13 新增 `translateComponent`，80 → 81，兩份 README、`Submission_EN.md`、開發指南已改
  - [ ] B 在 10/13 動了 A 區的檔案，請看一眼：`functions/src/index.js`／`translate.js`（半成品名稱翻譯）、`MyBookingsPage.tsx`（取餐日已過仍「已鎖定」的訂單排到已結束區）、`MarketplaceHeader.tsx`（英文介面體驗帳號顯示 Diner／Vendor）、`NotificationBell.tsx`（關閉選單時整批標已讀）
  - [ ] 清測試資料（可選）：`customer@bunnbaa.test` 有一筆 9/23、NT$0、狀態仍是「已鎖定」的舊單
  - [-] 報名表單

## 🔴 B：商家端＋管理後台＋投稿素材

- [ ] 幫一家店設公休日（A 測加入計畫要用）
- [ ] 通知鈴鐺「看過清單就清掉未讀數」10/13 已部署，正式站還沒實測（未讀超過 20 則要開關兩次）
- [ ] 英文介面還會看到中文：備料／叫貨的食材名稱（只翻了半成品）、區域洞察「Nearby wishes」的許願文字（使用者輸入）；店家體驗帳號在店面頁頁首的名稱還沒看過
- 新增或改名半成品會自動翻英文；舊資料要管理員到「系統設定 → 補翻既有資料」（10/13 已補 29 筆）
- 測試：
  - [ ] P0：V-MNU-08／09、V-RDM-10
  - [ ] 正式站（Gemini）：V-MNU-03、V-MNU-08～13、V-MNU-17、V-RCP-04、V-PRP-07
  - [ ] 其他：V-RCP-05（邏輯已過，畫面新增半成品待測）、V-SET-08
  - [-] V-PRP-11、V-SET-03
  - [ ] 正式站限定：V-RDM-13／14／16、V-MNU-10、V-MNU-15（emulator 權限直接放行測不了）、V-PUR-08、V-REV-06、A-AUD-01、A-DIS-08
  - [ ] 第二家店主：V-ACC-02、V-RDM-09、V-MNU-06；別家店主呼叫 `completePickup` 要回 `permission-denied`
- 正式站實際點過：
  - [ ] 配方與原物料 → 菜單 → 今日備料 → 採購叫貨（LINE 傳送）→ 取餐掃碼 → 愛心餐 → 券負債 → 區域洞察
  - [ ] QR 相機掃碼（iPhone Safari＋Android Chrome；重掃、非本站 QR、拒絕相機權限）
  - [ ] 取餐時段結束前「登記未取餐」要是灰的
  - [ ] 商家頁手機版面（挑多分類的店）
  - [ ] 校準報告＋what-if、撥款排程手動觸發
  - [ ] 管理員：平台參數、菜色庫、天災事件（會真的退款，用測試訂單）、異常審核、平台儀表板
- 投稿素材：
  - [ ] 投影片（https://claude.ai/artifact/FCk692pY4uC2KmKJ2qHzQD）：補團隊、影片連結；架構圖與技術清單加上 Vertex AI、BigQuery AI、Looker Studio、Evaluation Service；匯出 PDF（10–12 頁）
  - [ ] 截圖：重拍 `assets/screenshots/` 4 張（正式站已有英文）；預購助理、拍照建菜單、備料、預估卡、客群卡、掃碼、Looker 兩張圖、評估結果表
  - [-] 影片：已錄完剪輯中；上傳 YouTube 後連結填進兩份 README、`Submission_EN.md`、簡報
  - [-] 補方括號：`Submission_EN.md`（影片、PDF）、兩份 README（影片、PDF、商家帳密）
  - [-] `assets/demo.gif`（約 10 秒）
  - [ ] 推上 GitHub 後看一次 README（Mermaid、徽章、連結）

## 📦 送出前確認

- [ ] 表單 5 項：PDF、原型網址 `?lang=en`、影片（≤ 3:00）、類別只勾 **Sustainability**、repo 網址
- [ ] PDF 文字可選取；原型無痕打開是英文；影片與 repo 登出後可看
- [ ] GitHub Actions 最後一次部署成功
- [ ] 刪掉本檔

## ❓ 要跟雅婷確認

- [ ] 退款折價券能不能疊加（目前每份限一張、早鳥照算）
- [ ] 取消留在店家的款項（`locks.kept_amount`）要不要算營收、要不要抽成
- [ ] 取餐 48 小時前取消也不退現金，是否符合消保法（條款在 `TermsNotices.tsx`）
- [ ] 轉讓價高於原價時差額留在店家，要不要另做撥款給轉讓人
- [ ] GitHub `master` branch protection

## ⚪ Demo 後

- [ ] 份數上限併發測試（搶最後一份、LINE Pay 確認失敗時份數退回）
- [ ] LINE Pay 特約商店審核（換 `functions/.env` 與 `LINE_PAY_ENV=production`）
- [ ] Firestore 備份、Secret Manager（[資安.md](資安.md) 第 5 節）
- [ ] CSP 從 Report-Only 改強制
- [ ] 店名、方案英文的編輯介面
- [ ] 清舊欄位：`vendors.subscription_*`、`vendors.billing`、`rewardStatus.min_tickets`

---

## ⚠️ 部署注意

- 推 `master` 自動部署 Hosting、Functions；**rules／indexes 要手動**，合併前先部署，新索引要先建好
- 改 `functions/.env` 要同步：`gh secret set FUNCTIONS_ENV < functions/.env`
- 移除 function 時自動部署會失敗，先 `firebase functions:delete <名稱> --region asia-east1`
- 部署逾時：`FUNCTIONS_DISCOVERY_TIMEOUT=60 npx firebase deploy --only functions`

## 📌 環境備忘

- GCP／Firebase 用 `ckchildlikekid@gmail.com`，不是 `tom040798@gmail.com`
- emulator 從 junction `C:\Users\USER\bunnbaa-dev` 跑（重建：`mklink /J C:\Users\USER\bunnbaa-dev "D:\雅婷\03赫滋與羊\+程式碼\BunnBaa"`）；Vite 要留在中文路徑
- emulator 需要 JRE（已裝 OpenJDK 21）
- `npm run dev` **直接讀寫正式資料**；隔離用 `.env.local` 設 `VITE_USE_EMULATORS=true` 後 `npm run dev:emulator`（重灌 `dev:emulator:reset`）
- 設計系統預覽：http://localhost:5300/#/design-system

## 測試帳號

本機 emulator（密碼都是 `demo1234`）：`customer@bunnbaa.test`（會員）、`vendor@bunnbaa.test`（仁和雅店主）、`applicant@bunnbaa.test`（申請中）、`suw192336@gmail.com`（管理員）。

正式站：管理員 `suw192336@gmail.com`、`ckchildlikekid@gmail.com`；測試會員 `customer@bunnbaa.test`（`demo123`）；仁和雅店主 `vendor@bunnbaa.test`（`demo1234`，登入頁有一鍵登入）。
