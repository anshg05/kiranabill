import { codePointLength } from "./customer.js";
import {
  ALIAS_MAX_CHARS,
  MAX_SHOP_PRODUCTS,
  MIN_ALIAS_CHARS,
  NAME_MAX_CHARS,
  UNIT_MAX_CHARS,
  nameKey,
  normalizeName,
  normalizeUnit,
  parseImportPrice,
  splitAliases,
} from "./catalogImport.js";

// KB-330 (docs/07-DECISIONS.md D71, D77): the pure rules behind the Catalog's rename, aliases edit and "Add product". They
// are the KB-314 import's rules - the same normalisation, alias judging, unit and price parsing - so an edit can never
// accept what the import would refuse. Nothing here writes, and nothing here ever chooses a unit or a price: the form's
// values come from the shopkeeper's typing (hard rule 7).

/** Another product of the same shop - ARCHIVED ones too: the database's unique name index counts them. */
export interface OtherProduct {
  id: string;
  displayName: string;
  aliases: readonly string[];
  isActive: boolean;
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

export function checkName(raw: string, others: readonly OtherProduct[]): NameCheck {
  const name = normalizeName(raw);
  if (name === "") return { ok: false, error: "Name needed" };
  if (codePointLength(name) > NAME_MAX_CHARS) return { ok: false, error: `Name is longer than ${NAME_MAX_CHARS} characters` };
  const key = nameKey(name);
  const clash = others.find((o) => nameKey(o.displayName) === key);
  if (clash) return { ok: false, error: `Another product is already called “${name}”${clash.isActive ? "" : " (archived)"}` };
  return { ok: true, name };
}

export interface AliasCheck {
  aliases: string[];
  dropped: { alias: string; why: string }[];
}

/** The import's alias judging, for one product against every OTHER product's names and aliases. */
export function checkAliases(ownName: string, text: string, others: readonly OtherProduct[]): AliasCheck {
  const taken = new Set(others.flatMap((o) => [nameKey(o.displayName), ...o.aliases.map(nameKey)]));
  const own = nameKey(ownName);
  const out: AliasCheck = { aliases: [], dropped: [] };
  for (const alias of splitAliases(text)) {
    if (alias === own) continue; // the name itself is always matched - redundant, not a clash
    const why =
      codePointLength(alias) < MIN_ALIAS_CHARS
        ? `shorter than ${MIN_ALIAS_CHARS} characters`
        : codePointLength(alias) > ALIAS_MAX_CHARS
          ? `longer than ${ALIAS_MAX_CHARS} characters`
          : taken.has(alias)
            ? "same as another product's name or alias"
            : null;
    if (why) out.dropped.push({ alias, why });
    else out.aliases.push(alias);
  }
  return out;
}

/** After a rename the old name stops matching when spoken - unless it is kept as another name. */
export function lostNameNote(oldName: string, newName: string, aliases: readonly string[]): string | null {
  const old = nameKey(oldName);
  if (old === nameKey(newName) || aliases.map(nameKey).includes(old)) return null;
  return `“${normalizeName(oldName)}” will stop matching when spoken.`;
}

/** The columns a save sends: only those that changed. Type-limited on purpose - a unit or a price can't be in it (D71). */
export interface ProductPatch {
  display_name?: string;
  aliases?: string[];
}

export function productPatch(
  current: { displayName: string; aliases: readonly string[] },
  next: { displayName: string; aliases: readonly string[] },
): ProductPatch {
  const patch: ProductPatch = {};
  if (next.displayName !== current.displayName) patch.display_name = next.displayName;
  const same = next.aliases.length === current.aliases.length && next.aliases.every((a) => current.aliases.includes(a));
  if (!same) patch.aliases = [...next.aliases];
  return patch;
}

export interface NewProductInput {
  name: string;
  unit: string;
  price: string;
}
export interface NewProduct {
  name: string;
  unit: string;
  unitKnown: boolean;
  pricePaise: number;
}
export type NewProductCheck = { ok: true; product: NewProduct } | { ok: false; errors: { name?: string; unit?: string; price?: string } };

/** The "Add product" form: what the shopkeeper typed, judged like an import row. Nothing is defaulted. */
export function checkNewProduct(input: NewProductInput, existing: readonly OtherProduct[], catalogSize: number): NewProductCheck {
  const errors: { name?: string; unit?: string; price?: string } = {};
  const name = checkName(input.name, existing);
  if (!name.ok) errors.name = name.error;
  else if (catalogSize + 1 > MAX_SHOP_PRODUCTS) errors.name = `The catalog holds at most ${MAX_SHOP_PRODUCTS.toLocaleString("en-US")} products`;
  const unit = normalizeUnit(input.unit);
  if (unit === null) errors.unit = "Unit needed";
  else if (codePointLength(unit.unit) > UNIT_MAX_CHARS) errors.unit = `Unit is longer than ${UNIT_MAX_CHARS} characters`;
  const price = parseImportPrice(input.price);
  if (!price.ok) errors.price = price.error;
  if (errors.name !== undefined || errors.unit !== undefined || errors.price !== undefined) return { ok: false, errors };
  return { ok: true, product: { name: (name as { name: string }).name, unit: unit!.unit, unitKnown: unit!.known, pricePaise: (price as { paise: number }).paise } };
}
