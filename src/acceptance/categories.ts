// KB-364 (owner, 30 Oct 2026): the acceptance orders the owner records on his phone. The CATEGORIES say what to cover - never the words:
// he says each order in his own words and writes the expected bill for it (docs/23-ACCEPTANCE.md). Shared by the phone recorder
// (draft builds only) and the PC-side tools.

export interface AcceptanceCategory {
  readonly id: string;
  readonly title: string;
  readonly count: number;
  readonly hint: string;
}

export const CATEGORIES: readonly AcceptanceCategory[] = [
  { id: "short-priced", title: "Short, with prices", count: 6, hint: "1-2 items, you say the price: \"2 किलो चीनी 45 रुपए किलो\", \"5 किलो चावल 225 रुपए\"" },
  { id: "short-priceless", title: "Short, no prices", count: 6, hint: "1-2 items, no price said: the shop's own price is used" },
  { id: "long-priced", title: "Long, with prices", count: 5, hint: "4-6 items, every one with its price, with and without a pause between items" },
  { id: "long-priceless", title: "Long, no prices", count: 5, hint: "4-6 items, no prices - name first (\"दाल एक किलो चीनी दो किलो\") and quantity first (\"एक किलो दाल दो किलो चीनी\")" },
  { id: "mixed", title: "Mixed: some priced, some not", count: 5, hint: "one breath, e.g. \"चीनी दो किलो चावल 90 रुपए दाल एक किलो 96 रुपए किलो\"" },
  { id: "number-words", title: "Prices in Hindi words", count: 6, hint: "अठासी, छियानवे, पचपन, एक सो दस, दो सो अठासी, डेढ़ सौ ..." },
  { id: "units-fractions", title: "Units and fractions", count: 5, hint: "ग्राम, लीटर, पैकेट, आधा, डेढ़, सवा, ढाई ..." },
  { id: "repeated", title: "Repeated or corrected", count: 3, hint: "the same item said twice, or a quick correction in the middle" },
  { id: "unclear-words", title: "Unclear or unusual names", count: 5, hint: "a brand name, a mumbled product, a name that is not in the catalog" },
  { id: "unreadable-price", title: "A price you cannot say clearly", count: 4, hint: "trail off or mumble the price: the bill must show \"Price needed\", never a guessed number" },
  // KB-370 (owner, 31 Oct 2026): Whisper restarted on a 40 s order. Last, so A01-A50 keep their ids; A62 is the 31 Oct dal order.
  { id: "long-30-90s", title: "Long orders, 30-90 seconds", count: 12, hint: "a whole real order in one go, 30-90 s, 8-12 items, the way a customer says it; A62 = the 31 Oct dal order (10 items)" },
];

export const TOTAL_ORDERS = CATEGORIES.reduce((n, c) => n + c.count, 0);

export interface Slot {
  /** A01, A02 ... in category order - the row of the expected-bill sheet. */
  readonly id: string;
  readonly category: string;
  /** 1-based position inside its category. */
  readonly nth: number;
}

/** Every slot, in order: the same ids on the phone and in the sheet. */
export function slots(): Slot[] {
  const out: Slot[] = [];
  for (const c of CATEGORIES) for (let nth = 1; nth <= c.count; nth++) out.push({ id: `A${String(out.length + 1).padStart(2, "0")}`, category: c.id, nth });
  return out;
}
