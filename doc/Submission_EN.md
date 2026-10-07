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

### How we use Google AI (Gemini)

Gemini runs through four stages of a meal's life:

| Stage | Feature | Gemini capability | Cloud Function |
|---|---|---|---|
| List | Photo-to-menu: a photo of a paper menu becomes structured, bilingual menu drafts (price, category, dietary tags, allergens) that the owner confirms | Multimodal vision → JSON | `extractMenuFromImage` |
| Find | Conversational pre-order assistant: "Lunch next Mon–Fri, Da'an district, under NT$120, no beef" → bookable meal cards | Multi-turn function calling (`searchMenuItems`, `checkAvailability`, `searchMealPlans`, `presentCandidates`) | `askShoppingAssistant` |
| Rescue | Resale matching: when a meal is put up for resale, find diners who ate similar dishes nearby and push-notify them | `gemini-embedding-001` (768-dim) + Firestore Vector Search KNN + FCM | `matchResaleLock` |
| Calibrate | Pickup forecast range ("42 locked → 38–41 expected") from statistics, with a nightly Gemini report and what-if questions for the vendor | Structured JSON generation | `getPickupForecast`, `dailyCalibration`, `askCalibrationScenario` |

Gemini also writes plain-language discount explanations (`onLockCreated`), drafts recipes and normalises dish names (insights module), and keeps all content bilingual through Chinese → English translation triggers.

### Responsible AI

- **Numbers are code.** Portions, prices, discounts, payouts and prize draws are deterministic functions; the model never computes them.
- **Drafts, not decisions.** Every AI output carries a `disclaimer` field. Owners confirm menus; vendors decide how much to cook. The assistant never places an order.
- **Server-side guards.** Ids returned by the model are validated against the live catalog, the user's allergens are filtered on the server, and prices are recomputed at checkout.
- **Calm and bounded.** No urgency marketing; 30 assistant questions per user per day with a 10-minute cache; at most 2 resale alerts per person per day, nobody more than 10 km away, one-tap opt-out.

### Technical implementation (Google Cloud)

- Frontend: React + TypeScript + Vite on **Firebase Hosting**; diner app, vendor portal and admin console; Firebase Auth.
- Backend: **71 Cloud Functions** (asia-east1) — callables, Firestore triggers and Cloud Scheduler jobs (cut-off, payouts, pickup reminders, charity conversion).
- Data: **Firestore** with native **Vector Search**; **Firebase Cloud Messaging** for push.
- AI: **Gemini API** (Flash for text/vision/tools, `gemini-embedding-001` for vectors) through one shared wrapper with JSON mode and retry on 429/503.
- Payments: LINE Pay request / confirm / refund (sandbox).
- Quality: 64/64 Firestore security-rule tests and 127/128 Cloud Functions tests passing (as of 5 Oct 2026; the remaining one must run after the 20:00 cut-off).

### Impact

- **Vendors:** cook to confirmed, prepaid demand; purchase and prep lists built for them; onboard with one photo; no monthly fee, just 5% per meal sold.
- **Diners:** up to 20% off for booking early; a guaranteed meal with no queue; find meals in one sentence; resell or gift if plans change.
- **Community:** less food cooked for nobody. Meals rescued through AI matching (`claimed_by_match`), resold meals (`resold_and_fulfilled`) and charity meals claimed are all recorded in Firestore, so impact is measured, not estimated.

### Scalability and roadmap

- Near-zero onboarding cost per vendor (photo-to-menu); city/district filters and automatic translation make new markets cheap.
- Fully serverless: Cloud Functions and Firestore scale with demand.
- Next: Firestore → BigQuery export, then BigQuery ML or Vertex AI forecasting; Gemini review and no-show insights for vendors; fraud signals (early-bird scalping, multiple accounts, gift loops) with Gemini case summaries for admins.

---

## 2. Demo video script (3:00)

Record on the live site. Prepare beforehand: a diner account and a vendor account, a printed or handwritten menu to photograph, at least one meal already locked for tomorrow, and a second diner account that has locked a similar dish (so the resale match fires).

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:15 | Cover slide, then the home page | "Small eateries buy ingredients before anyone orders. Too much and food is wasted; too little and customers leave. BunnBaa fixes that: diners pay ahead to lock a meal, and the earlier they lock, the cheaper it is." |
| 0:15–0:45 | **Vendor portal → Menu → Photo listing.** Photograph the paper menu; drafts appear; edit one allergen; confirm | "Onboarding takes one photo. Gemini's vision model reads the menu and drafts every item — name, English name, price, dietary tags and allergens. Nothing goes live until the owner confirms it." |
| 0:45–1:20 | **Diner home → assistant.** Type "Lunch next Monday to Friday, Da'an, under 120, no beef"; cards appear; open one; show the date/price row with the early-bird price; check out with LINE Pay sandbox | "Diners don't have to browse ten shops. They just ask. Gemini calls our server-side tools to check menus, availability and meal plans, and returns meals they can actually book. It suggests; it never buys. Booking two days ahead saves 20 percent." |
| 1:20–1:55 | **My meals → Transfer → list for resale.** Switch to the second diner's phone: push notification arrives; tap; pay; first diner sees the refund | "Plans change. Instead of wasting the meal, the diner lists it for resale. Gemini embeddings and Firestore vector search find people nearby who like similar food, and we notify them. The new buyer pays, and the original buyer is refunded automatically. That's a meal rescued — and we count every one." |
| 1:55–2:25 | **Vendor portal → Daily prep.** Show locked count, the "expected pickups" range, the prep list; ask a what-if question | "After the 20:00 cut-off, the vendor has an exact count and a ready-made prep and purchase list. The pickup range comes from statistics on past pickups, and Gemini explains it in plain words and answers what-if questions. AI advises; the vendor decides." |
| 2:25–2:40 | **Pickup.** Diner shows QR; vendor scans with camera; "picked up". Briefly show the charity-meal tab | "At the counter, a signed QR code is scanned. Any meal still unclaimed becomes a free charity meal, so it still feeds someone." |
| 2:40–3:00 | Architecture slide, then closing slide | "BunnBaa runs entirely on Google Cloud: Firebase Hosting, 71 Cloud Functions, Firestore with vector search, and Gemini for vision, function calling and embeddings. Cook what's ordered. Eat what's cooked." |

Tips: record at 1080p, keep the browser zoomed so text is readable, cut waiting time (LINE Pay redirects, push delivery), and add English captions.

---

## 3. Pre-submission checklist

- [ ] Fill in the bracketed placeholders in the deck (team names, food-waste statistic, video link) and in this file
- [ ] Export the deck to PDF (Share › Export › PDF)
- [ ] Deploy the latest Functions, rules and indexes; run `backfillMenuEmbeddings` once so resale matching works on existing items
- [ ] Check the four AI features on the live site (see `TODO.md`)
- [ ] Record and upload the 3-minute video as public / unlisted-with-link
- [ ] Make sure the live site works without logging in as an admin (judges will open it)
