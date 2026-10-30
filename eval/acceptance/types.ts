// KB-364: the acceptance orders (docs/23-ACCEPTANCE.md).

export type ExpectedPrice =
  | { readonly kind: "default" } // the shop's own price (nothing was said)
  | { readonly kind: "rate"; readonly paise: number } // "@45": a rate per the line's unit
  | { readonly kind: "total"; readonly paise: number } // "=225": a total
  | { readonly kind: "needed" }; // the bill must show "Price needed" - never a guessed number

export interface ExpectedLine {
  /** As the owner writes it ("चीनी", "मूंग दाल"): matched to a product by the app's own matcher. */
  readonly name: string;
  readonly qty: number | null;
  readonly unit: string;
  readonly price: ExpectedPrice;
}

export interface ExpectedBill {
  readonly lines: readonly ExpectedLine[];
  /** Pieces that must show as "Not added" (nothing could read them). */
  readonly notAdded: number;
  /** How many Theek hai checks the owner accepts for this order (usually 0). */
  readonly checks: number;
}

export interface AcceptanceOrder {
  readonly id: string;
  readonly category: string;
  /** The owner's words, typed (for the reader of the sheet; the gate uses the transcript). */
  readonly said: string;
  /** What Whisper heard, frozen by `accept:live --freeze`; null until then. */
  readonly transcript: string | null;
  readonly expected: ExpectedBill;
}
