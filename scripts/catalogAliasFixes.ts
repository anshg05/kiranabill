/**
 * KB-317 commit 2 - the owner's catalog alias rulings (29 Sep 2026), as ONE
 * list read by both:
 *   - scripts/build-catalog-seed.ts   -> src/domain/catalog-seed.json (tests, eval)
 *   - scripts/build-alias-migration.ts -> supabase/migrations/*_kb317_alias_fixes.sql
 *     (base_products AND every existing shop's base-copied shop_products)
 * scripts/catalogAliasFixes.test.ts fails if the seed or the committed
 * migration drifts from this list.
 *
 * Products are named by display_name: base_products ids are random UUIDs, and
 * display_name is unique there (KB-108). Aliases are exact strings, as stored.
 */
export interface CatalogAliasFix {
  readonly displayName: string;
  readonly remove?: readonly string[];
  readonly add?: readonly string[];
  /** Deactivate (never delete - history stays; no bills reference it). */
  readonly deactivate?: true;
  readonly why: string;
}

export const KB317_ALIAS_FIXES: readonly CatalogAliasFix[] = [
  { displayName: "गेहूं", remove: ["आटा"], why: "आटा is flour (Chakki Aata), not grain" },
  { displayName: "Chakki Aata", add: ["आटा"], why: "आटा = Chakki Aata (owner)" },
  { displayName: "Bath Sabun", remove: ["sabun", "साबुन"], why: "a bare sabun is the generic Sabun, never Bath Sabun" },
  { displayName: "Sabun", add: ["sabun", "साबुन"], why: "sabun = generic Sabun (614) (owner)" },
  { displayName: "Desi Shakkar", remove: ["shakkar"], why: "bare shakkar = Chini (owner); Desi Shakkar only when desi is said" },
  {
    displayName: "Arhar Daal",
    remove: ["arhar daal", "tur daal", "tuvar dal", "toor dal", "pigeon pea", "अरहर दाल", "तुअर दाल", "तूर दाल"],
    deactivate: true,
    why: "toor = arhar, one pulse (owner): Toor Daal (16) only; Arhar Daal (Rs.140) deactivated",
  },
  {
    displayName: "Toor Daal",
    add: ["arhar", "arhar daal", "tur daal", "tuvar dal", "toor dal", "pigeon pea", "अरहर दाल", "तुअर दाल", "तूर दाल", "तुवर दाल", "तूअल दाल"],
    why: "toor = arhar (owner); तुवर दाल (owner's spelling list) and तूअल दाल (RT23, Whisper's ल for र) are below the fuzzy bar even after the folds",
  },
  // Whisper's spellings in the owner's real recordings that the spelling folds
  // (catalogIndex.ts foldDevanagariSpelling) still don't land - measured on
  // every real misspelling, 29 Sep 2026. बेशन, मुंग दाल, देशी चना and बरवटी दाल
  // needed an alias before the folds and don't any more.
  { displayName: "Parle-G 10", add: ["पार लेजी", "पारलेजी", "परलेजी", "पालेजी"], why: "RT01/RT05/RT07/RT08/RT11/RT26: the word boundary moves, no fold reaches it" },
  { displayName: "Chai Patti", add: ["चायपत्ती"], why: "RT14: one word vs चाय पत्ती - 0.74, under the one-word 0.85 bar" },
  { displayName: "Masoor Daal", add: ["मसूल दाल"], why: "RT23: Whisper's ल for र, 0.67 (ल/र not folded - too many real words differ only there)" },
];
