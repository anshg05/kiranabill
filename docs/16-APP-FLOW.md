# 16 — App Flow

**Last updated:** 27 Sep 2026 · **Status:** Final for MVP

Journeys, sequences and state machines. `05-FRONTEND-SPEC.md` describes screens; this describes
how a person moves through them and what the system does underneath.

All diagrams are **Mermaid** — plain text, versioned in git, rendered by GitHub, and readable
directly by any AI tool.

---

## 1. Navigation map

```mermaid
flowchart TD
    Start([App opens]) --> Auth{Signed in?}
    Auth -- No --> SignIn[S1 Sign in with Google]
    SignIn --> HasShop{Shop exists?}
    Auth -- Yes --> HasShop
    HasShop -- No --> Onboard[S2 Onboarding]
    Onboard --> Billing
    HasShop -- Yes --> Billing[S3 Billing - home]

    Billing --> Catalog[S4 Catalog]
    Billing --> History[S5 History]
    Billing --> Settings[S7 Settings]
    Billing --> AddItem[S3a Add item sheet]
    History --> BillDetail[S6 Bill detail - read only]
    AddItem --> Billing
    Catalog --> Billing
    History --> Billing
    Settings --> Billing

    style Billing fill:#2C3E7B,color:#fff
```

**S3 Billing is home.** Every other screen is a detour that returns to it. The app opens on S3 and
the back action from anywhere returns to S3, never to a blank state.

---

## 2. First run

```mermaid
sequenceDiagram
    actor Shopkeeper
    participant App
    participant Supabase
    participant Local as IndexedDB

    Shopkeeper->>App: Opens app
    App->>Shopkeeper: Sign in with Google
    Shopkeeper->>App: Signs in
    App->>Supabase: Create user session
    Supabase-->>App: JWT

    App->>Shopkeeper: Shop name, phone, logo
    Shopkeeper->>App: Fills details
    App->>Supabase: INSERT shops, shop_members(owner)

    App->>Shopkeeper: Ready catalog, or start empty?
    alt Ready catalog
        Shopkeeper->>App: Use ready catalog
        App->>Supabase: Copy base_products into shop_products
        Note over App,Supabase: 482 products, suggested prices as starting prices
    else Start empty
        Shopkeeper->>App: Start empty
        Note over App: Products learned as they are spoken
    end

    App->>Supabase: Reserve receipt number block (50)
    Supabase-->>App: KB-000001 to KB-000050
    App->>Local: Cache catalog, settings, number block
    App->>Shopkeeper: Billing screen, ready
```

**The number block is reserved during onboarding**, so the very first bill works even if the network
drops immediately after. *(Built in `KB-315` — `bootstrapAfterOnboarding`, stamped with the device's persistent
id; a start with no usable block reserves again when online.)*

### Sign-out (added 27 Sep 2026, `KB-315`, `07-DECISIONS.md` D38)

Sign-out stops the sync loop, forgets this device's remembered user (so an offline restart can't resume as
them), and ends the Supabase session. **Local data is not deleted** — each user has their own local database,
and the same user signing back in continues where they left off, unsynced bills included.

**Built in `KB-313` (D65):** before signing out, if any
bills are still unsynced, **warn with the count** ("3 bills haven't reached the server yet — they'll stay on
this phone and sync when you sign back in"). Never a silent sign-out over unsynced bills. Bills that will never sync on their own (a permanent
conflict) get their own line, and a bill in progress is mentioned.

---

## 3. Voice billing — the one-turn flow

```mermaid
sequenceDiagram
    actor Shopkeeper
    participant UI
    participant Domain as domain/
    participant Voice as /voice endpoint
    participant Groq
    participant Gemini

    Shopkeeper->>UI: Taps mic
    UI->>Shopkeeper: Listening (pulse + timer)
    Shopkeeper->>UI: "do kilo chini, teen Parle-G das wala"
    Shopkeeper->>UI: Taps stop

    UI->>Domain: buildShopVocabulary()
    Domain-->>UI: top 40 product names
    UI->>Voice: POST audio (binary) + vocabulary
    Voice->>Groq: transcribe with phrase bias
    Groq-->>Voice: transcript
    Voice-->>UI: transcript
    UI->>Shopkeeper: Shows transcript immediately

    UI->>Domain: Layer 1 - deterministic parse
    alt Fast path hit (target 60-70%)
        Domain-->>UI: items (~0ms, no LLM)
    else Fast path miss
        Domain-->>UI: null
        UI->>Voice: POST transcript for parse
        Voice->>Gemini: pricing grammar prompt
        Gemini-->>Voice: proposed items
        Voice-->>UI: proposed items
    end

    UI->>Domain: Layer 3 - validate and flag
    Domain-->>UI: items + review flags
    UI->>Shopkeeper: Items in table, flags inline

    Note over Shopkeeper,UI: NO QUESTION IS ASKED.<br/>Unknown products are added and flagged.
```

**Contrast with Pilloo**, which needs four turns for the same order — it blocks on each unknown
product and asks for a customer name.

---

## 4. Finalising a bill

```mermaid
sequenceDiagram
    actor Shopkeeper
    participant UI
    participant Domain as domain/
    participant Local as IndexedDB
    participant Sync as Sync worker
    participant DB as Supabase

    Shopkeeper->>UI: Taps "Bill Banao"
    UI->>Domain: Check HIGH flags

    alt HIGH flag unacknowledged
        Domain-->>UI: blocked
        UI->>Shopkeeper: "Rate Rs 6/kg - usually Rs 52. Check?"
        Shopkeeper->>UI: Fixes, or acknowledges
    end

    UI->>Domain: Compute totals (integer paise)
    UI->>Local: Take next receipt number from block
    UI->>Local: INSERT bill + bill_items (status final, pending)
    Local-->>UI: saved
    UI->>Shopkeeper: Receipt shown (under 500ms)

    par Background, never blocks the receipt
        UI->>Domain: Run learning engine
        Domain->>Local: aliases, provisional products, price observations
    and
        Sync->>DB: Push pending rows (idempotent on local_id)
        DB-->>Sync: confirmed
        Sync->>Local: mark synced
    end
```

**The receipt appears from a local write.** Sync and learning both happen after, and neither can
delay or fail the bill.

---

## 5. Offline billing and reconnection

```mermaid
sequenceDiagram
    actor Shopkeeper
    participant UI
    participant Local as IndexedDB
    participant Sync as Sync worker
    participant DB as Supabase

    Note over UI: Network drops
    UI->>Shopkeeper: Small grey "Offline" chip

    Shopkeeper->>UI: Taps mic
    UI->>Shopkeeper: Mic disabled - "Voice needs internet"
    Note over UI: One line. Not a dialog.

    Shopkeeper->>UI: Adds items via type-ahead search
    UI->>Local: Search cached catalog (no network)
    Local-->>UI: results instantly

    Shopkeeper->>UI: Bill Banao
    UI->>Local: Receipt number from reserved block
    UI->>Local: INSERT bill (pending)
    UI->>Shopkeeper: Receipt - number is FINAL, will not change

    Note over UI: Network returns
    UI->>Shopkeeper: Chip - "Syncing..."
    Sync->>DB: Push pending bills
    DB-->>Sync: confirmed
    Sync->>DB: Pull changes since last sync
    Sync->>Local: Merge
    UI->>Shopkeeper: Chip clears
```

**The receipt number never changes after sync.** That is what block reservation buys — a customer
holding a parchi with `KB-000042` will find `KB-000042` in the shop's records.

---

## 6. Bill state machine

```mermaid
stateDiagram-v2
    [*] --> Empty
    Empty --> Draft: first item added
    Draft --> Draft: add / edit / remove item
    Draft --> Blocked: HIGH flag present
    Blocked --> Draft: fixed or acknowledged
    Draft --> Final: Bill Banao
    Final --> Synced: sync worker confirms
    Final --> Cancelled: cancel
    Synced --> Cancelled: cancel
    Cancelled --> [*]
    Synced --> [*]

    note right of Final
        IMMUTABLE from here.
        A wrong bill is cancelled
        and reissued, as with paper.
    end note
```

**A draft is never lost** to a network drop, a tab switch, or the app being backgrounded. It lives
in IndexedDB from the first item.

---

## 7. New product learning

```mermaid
flowchart TD
    A["Spoken: 'ajwain'"] --> B{In shop catalog?}
    B -- Yes --> C[Add to bill normally]
    B -- No --> D["Add to bill + REVIEW flag<br/>qty null, total 0<br/>NEVER BLOCKS"]
    D --> E[Shopkeeper fills qty and price]
    E --> F[Bill finalised]
    F --> G["provisional_products<br/>seen_count++"]
    G --> H{seen_count >= 3?}
    H -- No --> I[Wait for next sighting]
    H -- Yes --> J[Promote to shop_products]
    E -.one tap.-> K["'Save to catalog'"]
    K --> J
    J --> L[Available to search,<br/>fast path, STT vocabulary]
    L --> M["Layer 1 coverage widens<br/>→ fewer LLM calls"]

    style D fill:#E0A020,color:#000
    style M fill:#2E6B3E,color:#fff
```

**Two promotion routes**: automatic at three sightings, or one tap when the shopkeeper already knows
they'll sell it again.

---

## 8. Catalog: source of truth and cache

```mermaid
flowchart LR
    subgraph Writes
      A1[Catalog screen] --> W
      A2[Excel bulk import] --> W
      A3[Added mid-bill] --> W
      W[Local write<br/>pending] --> S[Sync worker]
      S --> DB[(Postgres<br/>shop_products)]
    end

    subgraph Reads
      DB --> S2[Sync worker]
      S2 --> C[(IndexedDB cache)]
      C --> IDX[In-memory index<br/>prefix + n-gram]
      IDX --> R1[Type-ahead search]
      IDX --> R2[Voice matching]
      IDX --> R3[STT vocabulary]
    end

    style DB fill:#2C3E7B,color:#fff
```

**Postgres is the source of truth.** All three write paths are the same database write. The cache
exists so search is instant and works offline — above 10,000 products it falls back to server-side
search.

---

## 9. Error and edge behaviour

| Situation | Behaviour |
|---|---|
| Voice fails (network, STT error) | Inline message + "Add manually". Never a dead end. |
| Gemini fails after retries | Keep the transcript on screen, offer manual add. The transcript is not lost. |
| Unknown product | Added with a REVIEW flag. **Never blocks, never asks.** |
| HIGH number flag | Finalise blocked until fixed or acknowledged |
| Receipt number block exhausted offline | Device-prefixed fallback number, flagged, reconciled on sync |
| Sync fails repeatedly | Amber chip, tap for detail. **Billing continues.** |
| App backgrounded mid-bill | Draft in IndexedDB. Returns exactly as left. |
| Two devices, same shop | Out of MVP scope. One device per shop. |
| Product renamed after old bills exist | Old bills keep their `display_name` snapshot |

---

## 10. Where the thesis shows up in these flows

| Thesis element | Flow that enforces it |
|---|---|
| **One turn** | §3 — no question between mic and items |
| **Never blocks** | §3, §7 — unknown products flagged and kept |
| **Never silently wrong about a number** | §4 — HIGH flags gate finalisation |
| **Compounding** | §7 — learning widens fast-path coverage |
| **Works at the counter** | §5 — offline billing, receipt number never changes |
