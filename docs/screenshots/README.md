# Web app screenshots

Taken on 20 Nov 2026 from `main` (after #24, the R7 landing redesign) in mock mode (`cd web && npm run dev:mock`). 1920×1080, dark theme. **All data is simulated: no real calls were made.**

| File | Screen | Shows |
|---|---|---|
| `01-home-hero.png` | `/` | Headline «خلّ الجواب يجيك» and the 3D journey scene, step 1 |
| `02-home-voice-orb.png` | `/` | Step 2: the «وكيل صوتي» orb between the request and the shops |
| `03-home-result.png` | `/` | Step 5: every card connected, ending on the 450 SAR result |
| `04-evidence.png` | `/#about` | «ما نكتفي بالسعر»: the price next to the shop's own words |
| `05-evidence-warranty.png` | `/#about` | Same section, warranty tab |
| `06-request.png` | `/request` | «أبي أغير شاشة آيفون ١٥ برو في الملقا» typed in |
| `07-tracking-done.png` | `/tracking` | Three shops called: two offers, one no answer |
| `08-comparison.png` | `/comparison` | 450 SAR commercial vs 1,200 SAR original, marked as a partial comparison |
| `09-comparison-scrolled.png` | `/comparison` | Both offer cards in full (price, part, warranty, time, availability) |
| `10-comparison-evidence.png` | `/comparison` | Evidence panel: «التجاري بأربعمية وخمسين» highlighted in the call transcript |

To retake them, run the mock web app and capture at a 1920×1080 viewport. The tracking and comparison screens need a request in the same browser session (they are empty after a reload).
