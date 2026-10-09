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

**Code repository:** https://github.com/Donna12301230/bunnbaa-mvp (setup, architecture and design decisions in the README)

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

Gemini, served through **Vertex AI**, runs through four stages of a meal's life:

| Stage | Feature | Gemini capability | Cloud Function |
|---|---|---|---|
| List | Photo-to-menu: a photo of a paper menu becomes structured, bilingual menu drafts (price, category, dietary tags, allergens) that the owner confirms | Multimodal vision → JSON | `extractMenuFromImage` |
| Find | Conversational pre-order assistant: "Lunch next Mon–Fri, Da'an district, under NT$120, no beef" or "dinner tomorrow, not spicy" → bookable meal cards (breakfast / lunch / dinner aware) | Multi-turn function calling (`searchMenuItems`, `checkAvailability`, `searchMealPlans`, `presentCandidates`) | `askShoppingAssistant` |
| Rescue | Resale matching: when a meal is put up for resale, find diners who ate similar dishes nearby and push-notify them | `gemini-embedding-001` (768-dim) + Firestore Vector Search KNN + FCM | `matchResaleLock` |
| Calibrate | Pickup forecast range ("42 locked → 38–41 expected") from statistics, with a nightly Gemini report and what-if questions for the vendor | Structured JSON generation | `getPickupForecast`, `dailyCalibration`, `askCalibrationScenario` |

On the analytics side, every order streams from Firestore to **BigQuery**, where **BigQuery AI** adds two more capabilities:

| Capability | How | Where it shows up |
|---|---|---|
| Demand forecast | `AI.FORECAST` (TimesFM, no training) predicts each shop's orders for the next 7 days | Written back to Firestore by a scheduled function; vendor reports show "expected tomorrow: N (reference)" |
| Customer segments | `ML.KMEANS` on recency, frequency, spend, resale and no-show rates; `AI.GENERATE` asks Gemini for a one-line description of each segment | Vendor insights and the admin dashboard |
| Impact dashboard | **Looker Studio** on the BigQuery dataset: daily orders, forecast vs. actual, meals rescued by AI matching, charity meals | Embedded in the admin console |

Gemini also explains the early-bird discount and pre-order rules on the item page before checkout (`getDiscountExplanation`, cached per discount tier), drafts recipes and normalises dish names (insights module), and keeps all content bilingual through Chinese → English translation triggers.

### Responsible AI

- **Numbers are code.** Portions, prices, discounts, payouts, prize draws and the vendor accuracy rate behind the "reliable" badge are deterministic functions; the model only explains numbers it is given.
- **Drafts, not decisions.** Every AI output carries a `disclaimer` field. Owners confirm menus; vendors decide how much to cook — AI-drafted recipes stay flagged until the owner saves them, and the prep, purchasing and cost screens warn (and ask before sending a supplier order) while any are unconfirmed. The assistant never places an order.
- **Server-side guards.** The assistant can only show items its own search tools returned in that turn, the user's allergens are filtered on the server both in search and again on the final cards, and prices are recomputed at checkout.
- **Calm and bounded.** No urgency marketing; 30 assistant questions per user per day with a 10-minute cache; at most 2 resale alerts per person per day, nobody more than 10 km away, one-tap opt-out.

### Technical implementation (Google Cloud)

- Frontend: React + TypeScript + Vite on **Firebase Hosting**; diner app, vendor portal and admin console; Firebase Auth.
- Backend: **74 Cloud Functions (2nd gen, running on Cloud Run)** in asia-east1 — callables, Firestore triggers and Cloud Scheduler jobs (cut-off, payouts, pickup reminders, charity conversion).
- Data: **Firestore** with native **Vector Search**; **Firebase Cloud Messaging** for push.
- AI: **Gemini on Vertex AI** (Flash for text/vision/tools, `gemini-embedding-001` for vectors) via the Google Gen AI SDK, authenticated with the Functions service account (no API keys), through one shared wrapper with JSON mode and retries.
- Analytics: **Stream Firestore to BigQuery** extension → `bunnbaa_analytics` dataset; **BigQuery AI** (`AI.FORECAST`, `ML.KMEANS`, `AI.GENERATE`); **Looker Studio** dashboard. Only the fields analysis needs are exported; phone digits and notes are excluded.
- Payments: LINE Pay request / confirm / refund (sandbox).
- Quality: 61/61 business-logic tests and 141 Cloud Functions tests passing with none failing (as of 9 Oct 2026; 2 date-dependent tests are skipped when the next day is not a business day), plus Firestore security-rule tests.

### Impact

- **Vendors:** cook to confirmed, prepaid demand; purchase and prep lists built for them; onboard with one photo; no monthly fee, just 5% per meal sold.
- **Diners:** up to 20% off for booking early; a guaranteed meal with no queue; find meals in one sentence; resell or gift if plans change.
- **Community:** less food cooked for nobody. Meals rescued through AI matching (`claimed_by_match`), resold meals (`resold_and_fulfilled`) and charity meals claimed are all recorded and charted on the Looker Studio dashboard, so impact is measured, not estimated.

### Scalability and roadmap

- Near-zero onboarding cost per vendor (photo-to-menu); city/district filters and automatic translation make new markets cheap.
- Fully serverless: Cloud Functions on Cloud Run, Firestore, Vertex AI and BigQuery all scale with demand.
- Analytics-ready from day one: every order already lands in BigQuery, so new forecasts and segments are SQL, not new infrastructure.
- Next: Vertex AI Search for semantic menu search; Gemini review and no-show insights for vendors; fraud signals (early-bird scalping, multiple accounts, gift loops) with Gemini case summaries for admins.

---

## 2. Demo video script (3:00)

Structure follows the judging criteria: problem (0:00–0:35), live prototype with the four Gemini features (0:35–2:15, technical merit 40%), architecture and responsible AI (2:15–2:30), data, scalability and impact (2:30–3:00). Everything in 0:35–2:15 is recorded on the live site, with an on-screen caption naming the Google technology used. Production notes, preparation and the upload checklist (in Chinese) are in `doc/Demo影片腳本.md`.

| Time | Screen | On-screen caption | Voice-over |
|---|---|---|---|
| 0:00–0:20 | Cover slide → problem slide | Theme: Retail & Commerce — Intelligent Customer and Business Experiences | "Every day, small eateries near campuses and offices buy ingredients before a single order comes in. Guess too high and food goes in the bin. Guess too low and hungry customers walk away. And when a customer who paid can't show up, that meal is wasted too." |
| 0:20–0:35 | Live home page, early-bird price row | — | "BunnBaa turns guesswork into confirmed demand. Diners pay ahead to lock a meal — the earlier they book, the bigger the discount — so vendors know exactly what to cook. Gemini runs through every step." |
| 0:35–1:00 | **Vendor portal → Menu → Photo listing.** Photograph a paper menu; drafts appear; fix one allergen; confirm | Gemini multimodal → structured JSON · `extractMenuFromImage` | "For a small shop, onboarding takes one photo. Gemini's multimodal model reads a paper menu and drafts every item: name, English name, price, dietary tags and allergens. Nothing goes live until the owner checks and confirms." |
| 1:00–1:30 | **Diner home → assistant.** Ask "Lunch next Monday to Friday, Da'an, under 120, no beef"; open a card; early-bird price; LINE Pay sandbox checkout | Gemini function calling · 4 server-side tools · `askShoppingAssistant` | "Diners don't browse ten shops — they just ask. Gemini uses function calling to search menus, check availability and find multi-day plans, all on our server. It returns meals that can actually be booked, with allergies filtered out. It suggests; it never buys. Booking two days ahead saves twenty percent." |
| 1:30–1:55 | **My meals → Transfer → set price → list.** Second phone: push alert → take over and pay → first diner sees the refund as points | gemini-embedding-001 · Firestore Vector Search · Firebase Cloud Messaging | "Plans change. Instead of wasting the meal, the diner lists it for resale. We embed every dish with Gemini, search Firestore's vector index for people nearby who like similar food, and push them an alert. Someone takes it over, and the first diner is refunded. One more meal rescued — and we count every one." |
| 1:55–2:15 | **Vendor portal → Today's prep** (locked count, expected-pickup range, prep list, what-if question) → **camera QR scan** at pickup | Statistics compute the numbers · Gemini explains · Cloud Scheduler cut-off | "After the evening cut-off, the vendor has an exact count and a ready-made prep list. The pickup range comes from statistics, and Gemini explains it and answers what-if questions. At the counter, a signed QR code completes pickup." |
| 2:15–2:30 | Architecture slide → Responsible AI slide | Vertex AI · Cloud Run · Firestore · BigQuery | "Everything runs on Google Cloud: Firebase Hosting, seventy-four Cloud Functions on Cloud Run, Firestore vector search, and Gemini on Vertex AI. Our rule: AI advises, code calculates, people decide." |
| 2:30–3:00 | **Looker Studio dashboard** (forecast vs. actual, meals rescued) → vendor report "expected tomorrow" → closing slide with URL | BigQuery AI.FORECAST · ML.KMEANS · AI.GENERATE · Looker Studio | "Every order streams into BigQuery. BigQuery AI forecasts each shop's next week and groups its customers, and Gemini describes each group in plain words. Looker Studio tracks forecast versus actual and every meal rescued. A new vendor is one photo away, so BunnBaa can grow to every lunch district. Cook what's ordered. Eat what's cooked." |

Record at 1080p with a separate voiceover track, cut all waiting time (LINE Pay redirects, Gemini generation, push delivery), add English captions, and upload as **Public** (YouTube public or unlisted-with-link, or Drive "Anyone with the link"). Check the link in a private window before submitting.

---

## 3. Pre-submission checklist

- [ ] Finish P0 and P1 in `doc/GoogleCloud改動建議.md` (Vertex AI, BigQuery export, `AI.FORECAST`, `ML.KMEANS` + `AI.GENERATE`, Looker Studio). This document already describes them as done
- [ ] Fill in the bracketed placeholders in the deck (team names, food-waste statistic, video link) and in this file
- [ ] Export the deck to PDF (Share › Export › PDF)
- [ ] Deploy the latest Functions, rules and indexes; run `backfillMenuEmbeddings` once so resale matching works on existing items
- [ ] Check the four AI features on the live site (see `TODO.md`)
- [ ] Record and upload the 3-minute video as public / unlisted-with-link
- [ ] Make sure the live site works without logging in as an admin (judges will open it)
