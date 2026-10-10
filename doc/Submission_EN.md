# BunnBaa — Hackathon Submission Pack (English)

Google AI Builder Cup 2026 · deadline 10/18. This file holds the English text for the submission form and the 3-minute demo video script. The proposal deck is a Slides artifact (export to PDF from Share › Export): https://claude.ai/artifact/FCk692pY4uC2KmKJ2qHzQD

Items in `[brackets]` must be filled in before submitting.

---

## 1. Submission form

**Project name:** BunnBaa 飯飽 — AI Pre-order Platform for Small Eateries

**Challenge theme:** Retail & Commerce — Intelligent Customer and Business Experiences

**Category / domain:** Sustainability (food waste reduction); also Social Good (free charity meals)

**Live prototype (Firebase Hosting, Google Cloud):** https://bunnbaa-mvp-5474.web.app

**Demo video (3 min, public):** [YouTube / Vimeo / Google Drive link]

**Proposal PDF:** [attach the PDF exported from the deck]

**Code repository:** [GitHub link, if required]

### One-line pitch

Diners pay ahead to lock a meal — the earlier, the cheaper — so small eateries know exactly what to cook, and Gemini makes sure every cooked meal finds someone to eat it.

### Problem

Small eateries near campuses and offices buy ingredients before anyone orders. Guess high and food is thrown away; guess low and customers are turned away. Diners queue every day with no guarantee and no reward for deciding early. Even a prepaid meal is wasted when its owner's plans change, because nobody else knows it is available. [Add one sourced statistic on food-service waste in Taiwan.]

### Solution

BunnBaa is a pre-order "lock" platform:

1. **Lock** — diners book breakfast, lunch or dinner up to 30 days ahead: 20% off two or more days early, 5% off for tomorrow, paid with LINE Pay.
2. **Cut-off** — at 20:00 the day before, the vendor gets an exact count plus auto-generated purchase and prep lists.
3. **Pass it on** — a diner who can't come can resell, gift, or donate the meal as a free charity meal. Unclaimed meals become charity meals automatically.
4. **Pick up** — a signed QR code is scanned at the counter.

Vendors pay no monthly fee: the platform takes a 5% commission on each meal sold, deducted at payout.

### How we use Google AI (Gemini on Vertex AI + BigQuery AI)

Gemini on **Vertex AI** (`gemini-3.6-flash`, service-account auth, no API keys) runs through four stages of a meal's life:

| Stage | Feature | Gemini capability | Cloud Function |
|---|---|---|---|
| List | Photo-to-menu: a photo of a paper menu becomes structured, bilingual menu drafts (price, category, dietary tags, allergens) that the owner confirms | Multimodal vision → JSON | `extractMenuFromImage` |
| Find | Conversational pre-order assistant: "Lunch next Mon–Fri, under NT$120, no beef" or "congee next Tuesday, somewhere without a queue, and what goes well with it?" → bookable meal cards. It reads the BigQuery demand forecast and frequently-bought-together pairs to put quieter vendors first and suggest add-ons | Multi-turn function calling (`searchMenuItems`, `checkAvailability`, `searchMealPlans`, `getVendorInsights`, `presentCandidates`) | `askShoppingAssistant` |
| Rescue | Resale matching: when a meal is put up for resale, find diners who ate similar dishes nearby and push-notify them | `gemini-embedding-001` (768-dim) + Firestore Vector Search KNN + FCM | `matchResaleLock` |
| Calibrate | Pickup forecast range ("42 locked → 38–41 expected") from statistics, with a nightly Gemini report and what-if questions for the vendor | Structured JSON generation | `getPickupForecast`, `dailyCalibration`, `askCalibrationScenario` |

Gemini also explains the early-bird discount and pre-order rules on the item page before checkout (`getDiscountExplanation`, cached per discount tier), drafts recipes and normalises dish names (insights module), and keeps all content bilingual through Chinese → English translation triggers.

Every Firestore write streams into **BigQuery** (official *Stream Firestore to BigQuery* extension; a transform function strips personal and payment fields before they land), where **BigQuery AI** turns history into decisions:

| Analysis | BigQuery AI | Where it shows up |
|---|---|---|
| Demand forecast, 7 days ahead per vendor | `AI.FORECAST` (TimesFM, no training) — daily job `demandForecast` | Vendor portal "next 7 days" card; the assistant's `getVendorInsights` tool |
| Frequently bought together | SQL over each diner's purchases per vendor | Vendor portal; assistant add-on suggestions |
| Diner segments | `ML.KMEANS` on recency, frequency, spend, early-bird use, resale and no-show rates; `AI.GENERATE` (Gemini) names and describes each segment in Chinese and English — weekly job `customerInsights` | Vendor portal "who your regulars are" (counts only, never member lists) |
| Impact dashboard | Views over BigQuery, **Looker Studio** report embedded in the admin console | Meals saved (resold + charity), forecast vs. actual, segment mix |

### Responsible AI

- **Numbers are code.** Portions, prices, discounts, payouts, prize draws and the vendor accuracy rate behind the "reliable" badge are deterministic functions; the model only explains numbers it is given.
- **Drafts, not decisions.** Every AI output carries a `disclaimer` field. Owners confirm menus; vendors decide how much to cook — AI-drafted recipes stay flagged until the owner saves them, and the prep, purchasing and cost screens warn (and ask before sending a supplier order) while any are unconfirmed. The assistant never places an order.
- **Server-side guards.** The assistant can only show items its own search tools returned in that turn, the user's allergens are filtered on the server both in search and again on the final cards, and prices are recomputed at checkout. An empty allergen field means "not labelled", never "free of": the assistant must say so and avoid dishes that very likely contain the allergen (for example battered fried chicken for a gluten allergy).
- **Measured, not assumed.** A 24-question test set (budgets, allergies, vegetarian, meal times, multi-day plans, English, an unsupported area, "just order it for me") runs the production assistant end to end. Rule checks pass 24/24 with zero allergen violations, and the **Vertex AI Gen AI Evaluation Service** (pointwise custom rubrics, `gemini-2.5-pro` judge) scores fulfillment 4.96/5 and groundedness 4.92/5. The evaluation found real problems — "no allergen listed" read as "allergen-free", a breakfast-shop plan offered for lunch, an empty answer when the tool budget ran out — and they were fixed before these scores.
- **Calm and bounded.** No urgency marketing; 30 assistant questions per user per day with a 10-minute cache; at most 2 resale alerts per person per day, nobody more than 10 km away, one-tap opt-out.

### Technical implementation (Google Cloud)

- Frontend: React + TypeScript + Vite on **Firebase Hosting**; diner app, vendor portal and admin console; Firebase Auth.
- Backend: **79 Cloud Functions** (2nd gen on **Cloud Run**, asia-east1) — callables, Firestore triggers and Cloud Scheduler jobs (cut-off, payouts, pickup reminders, charity conversion, daily forecast, weekly segments).
- Data: **Firestore** with native **Vector Search**; **Cloud Storage** for menu photos; **Firebase Cloud Messaging** for push.
- AI: **Gemini on Vertex AI** (`gemini-3.6-flash` for text/vision/tools, `gemini-embedding-001` for 768-dim vectors) through one shared wrapper (`@google/genai`, JSON mode, retry, and a final round that must return an answer), authenticated with the functions' service account (`roles/aiplatform.user`).
- Analytics: **BigQuery** (`bunnbaa_analytics`, asia-east1) fed by the *Stream Firestore to BigQuery* extension; **BigQuery AI** `AI.FORECAST`, `ML.KMEANS`, `AI.GENERATE`; **Looker Studio** dashboard; forecasts and segments are written back to Firestore so the apps stay real-time.
- Evaluation: **Vertex AI Gen AI Evaluation Service** (`evaluateInstances`) on a 24-question assistant test set.
- Payments: LINE Pay request / confirm / refund (sandbox).
- Quality: 61/61 business-logic tests and 141 Cloud Functions tests passing with none failing (as of 9 Oct 2026; 2 date-dependent tests are skipped when the next day is not a business day), plus Firestore security-rule tests.

### Impact

- **Vendors:** cook to confirmed, prepaid demand; purchase and prep lists built for them; onboard with one photo; no monthly fee, just 5% per meal sold.
- **Diners:** up to 20% off for booking early; a guaranteed meal with no queue; find meals in one sentence; resell or gift if plans change.
- **Community:** less food cooked for nobody. Meals rescued through AI matching (`claimed_by_match`), resold meals (`resold_and_fulfilled`) and charity meals claimed are all recorded in Firestore and counted in BigQuery, so impact is measured, not estimated. On the prototype's demo data (seeded orders plus simulated background demand), the dashboard counts 408 of 3,659 meals saved by resale or charity, and next-day forecasts land within 6–15% of actual platform-wide (WAPE, 14-day backtest).

### Scalability and roadmap

- Near-zero onboarding cost per vendor (photo-to-menu); city/district filters and automatic translation make new markets cheap.
- Fully serverless: Cloud Functions and Firestore scale with demand.
- Next: **Vertex AI Search** for semantic menu search ("light, with soup, no beef"); forecast covariates such as weather and campus calendars (multivariate `AI.FORECAST`); Gemini review and no-show insights for vendors; fraud signals (early-bird scalping, multiple accounts, gift loops) with Gemini case summaries for admins.

---

## 2. Demo video script (3:00)

Record on the live site. Prepare beforehand: a diner account and a vendor account, a printed or handwritten menu to photograph, at least one meal already locked for tomorrow, and a second diner account that has locked a similar dish (so the resale match fires).

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Cover slide, then the home page | "Small eateries buy ingredients before anyone orders. Too much and food is wasted; too little and customers leave. BunnBaa fixes that: diners pay ahead to lock a meal, and the earlier they lock, the cheaper it is." |
| 0:15–0:45 | **Vendor portal → Menu → Photo listing.** Photograph the paper menu; drafts appear; edit one allergen; confirm | "Onboarding takes one photo. Gemini's vision model reads the menu and drafts every item — name, English name, price, dietary tags and allergens. Nothing goes live until the owner confirms it." |
| 0:45–1:20 | **Diner home → assistant.** Type "Lunch next Monday to Friday, Da'an, under 120, no beef"; cards appear; open one; show the date/price row with the early-bird price; check out with LINE Pay sandbox | "Diners don't have to browse ten shops. They just ask. Gemini calls our server-side tools to check menus, availability and meal plans, and returns meals they can actually book. It suggests; it never buys. Booking two days ahead saves 20 percent." |
| 1:20–1:55 | **My meals → Transfer → list for resale.** Switch to the second diner's phone: push notification arrives; tap; pay; first diner sees the refund as platform points | "Plans change. Instead of wasting the meal, the diner lists it for resale. Gemini embeddings and Firestore vector search find people nearby who like similar food, and we notify them. The new buyer pays, and the original buyer is refunded automatically as platform points. That's a meal rescued — and we count every one." |
| 1:55–2:25 | **Vendor portal → Daily prep**, then **Reports → Revenue**: the 7-day forecast card and "who your regulars are" | "After the 20:00 cut-off, the vendor has an exact count and a ready-made prep and purchase list. For the days after that, BigQuery's TimesFM model forecasts demand, and k-means groups the regulars, with Gemini naming each group. AI advises; the vendor decides." |
| 2:25–2:40 | **Pickup.** Diner shows QR; vendor scans with camera; "picked up". Briefly show the charity-meal tab | "At the counter, a signed QR code is scanned. Any meal still unclaimed becomes a free charity meal, so it still feeds someone." |
| 2:40–3:00 | **Admin → Analytics** (Looker Studio: meals saved, forecast vs. actual), architecture slide, closing slide | "Every booking streams into BigQuery, so we can show meals saved and how close the forecast was. BunnBaa runs entirely on Google Cloud: Gemini on Vertex AI, Cloud Run functions, Firestore with vector search, BigQuery AI and Looker Studio — and we test the assistant with Vertex AI's evaluation service. Cook what's ordered. Eat what's cooked." |

Tips: record at 1080p, keep the browser zoomed so text is readable, cut waiting time (LINE Pay redirects, push delivery), and add English captions.

---

## 3. Pre-submission checklist

- [ ] Fill in the bracketed placeholders in the deck (team names, food-waste statistic, video link) and in this file
- [ ] Export the deck to PDF (Share › Export › PDF)
- [x] Deploy the latest Functions and Hosting (10 Oct: Vertex AI, BigQuery sync, forecast, segments, assistant insights tool)
- [ ] Run `backfillMenuEmbeddings` once so resale matching works on existing items (embeddings now come from Vertex AI)
- [ ] Build the Looker Studio report from Admin → Analytics, enable embedding and paste the embed URL back
- [ ] Ask the pre-order assistant one question on the live site (first live call through Vertex AI)
- [ ] Screenshot the evaluation summary (`doc/評估/預購助理回答品質評估.md`) for the deck
- [ ] Update the architecture slide: Firestore →(extension)→ BigQuery → BigQuery AI / Looker Studio, forecasts written back to Firestore → vendor portal
- [ ] Check the four AI features on the live site (see `TODO.md`)
- [ ] Record and upload the 3-minute video as public / unlisted-with-link
- [ ] Make sure the live site works without logging in as an admin (judges will open it)
