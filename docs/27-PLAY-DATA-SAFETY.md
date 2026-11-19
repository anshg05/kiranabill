# 27 — Google Play: the Data safety form and the App content answers

**What this is:** the answers the owner types into Play Console (App content → Data safety, and the other App content
declarations) for **Kirana Voice Bill** (`com.kiranavoicebill.app`). Every answer is traced to the code and matches
`/privacy` (`public/privacy.html`). Written 20 Nov 2026 (D120); `src/ui/playDataSafety.test.ts` keeps the data types
below in step with the privacy page.

**When to update it:** whenever the app starts or stops collecting something, sends data to a new service, or keeps it
longer (docs/23 §8 item 4i) - change this file, `/privacy` and Play Console together.

---

## 1. Data collection and security (the first page of the form)

| Play's question | Our answer |
|---|---|
| Does your app collect or share any of the required user data types? | **Yes** |
| Is all of the user data collected by your app encrypted in transit? | **Yes** (HTTPS to Supabase, Netlify and Google) |
| Which methods of account creation does your app support? | **OAuth** (Sign in with Google) |
| Do you provide a way for users to request that their data is deleted? | **Yes** |
| Delete account URL | `https://kiranabilling.netlify.app/delete-account` |
| (In-app path, for your own reference) | More → Account → Delete account |
| Has your app been independently validated against a global security standard? | **No** |

**Shared?** Everywhere below: **No.** Supabase, Netlify and Google process data only on our behalf (service providers,
which Play does not count as sharing); sending a bill on WhatsApp is the user's own action, which Play also does not
count as sharing.

**Processed ephemerally?** **No** for every type (each is stored, even if only for 7 days).

## 2. Data types

| Play category | Data type | Collected | Shared | Required / optional | Purposes | What it is in our app (code) |
|---|---|---|---|---|---|---|
| Personal info | **Name** | Yes | No | Required | Account management, App functionality | the Google account's name (Supabase Auth); customers' names typed on a bill (`bills.customer_name`) |
| Personal info | **Email address** | Yes | No | Required | Account management | the Google sign-in email (Supabase Auth) |
| Personal info | **User IDs** | Yes | No | Required | Account management | the Supabase user id and the Google account id |
| Personal info | **Phone number** | Yes | No | Optional | App functionality | the shop's phone; customers' mobiles typed on a bill (`shops.phone`, `bills.customer_mobile`) |
| Financial info | **Purchase history** | Yes | No | Required | App functionality | the shop's bills: items, prices, totals, status (`bills`, `bill_items`, `bill_cancellations`) |
| Audio | **Voice or sound recordings** | Yes | No | Optional (typing works) | App functionality | the spoken order, its transcript and items, kept 7 days (`voice_recordings`, the `recordings` bucket) |
| App activity | **App interactions** | Yes | No | Required | Analytics, App functionality | per-bill usage numbers (`bill_metrics`) |
| App activity | **Other user-generated content** | Yes | No | Required | App functionality | products and prices, learned names, new item names, price changes (`shop_products`, `learned_aliases`, `provisional_products`, `price_observations`, `learning_events`) |
| App info and performance | **Diagnostics** | Yes | No | Required | App functionality | on recording rows: the app version, the error kind, model usage, timings; the server's status log lines |
| Device or other IDs | **Device or other IDs** | Yes | No | Required | App functionality | a random id made once per install (`device_id`, `src/data/device.ts`) |

**Not collected - answer "No" / leave unticked:** Location (approximate or precise - the location permission exists only
on Android 11 and older, for Bluetooth printer search, and the app never reads a location), Address and other personal
info (race, religion, political or sexual orientation), Financial info other than purchase history (card / bank
details, credit info), Health and fitness, Messages (emails, SMS, other), Photos and videos, Music files, Other audio
files, Files and docs (a spreadsheet the user picks is read on the phone; only the products in it are saved - covered
above), Calendar, Contacts, Web browsing history, Installed apps, Crash logs, Other app performance data, Search history.

## 3. The other App content declarations

| Declaration | Our answer |
|---|---|
| Privacy policy URL | `https://kiranabilling.netlify.app/privacy` |
| Ads: does your app contain ads? | **No** |
| App access: is all functionality available without special access? | **No** - it needs a Google sign-in; give Play's review a test account (see `17` before submitting) |
| Target audience and content | **18 and over** (shopkeepers; not for children) |
| News app | **No** |
| Government app | **No** |
| Financial features | **My app doesn't provide any financial features** (it makes a shop's bills; no payments, loans, trading or wallets) |
| Health apps | **No** |
| Data deletion in the listing | the same Delete account URL as above |

## 4. Before entering it

- The website release (just before Play) must carry the new `/privacy` and `/delete-account` - both URLs above must load,
  signed out, before the form is submitted (docs/23 §8 item 4h).
- The Gemini key's Google Cloud project must keep an active billing account (the "paid API terms" claim, docs/23 §8).
