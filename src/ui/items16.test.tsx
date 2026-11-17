// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalLearningEvent, type LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { NewProduct, ProductPatch } from "@/domain/catalogEdit";
import { CatalogScreen } from "./CatalogScreen";
import { TabFrame } from "./AppTabs";
import { setScreenLanguage } from "./screenLanguage";

// KB-414 step 3 (owner + reviewer, 17 Nov 2026; the approved plan + mock, all 5 defaults): Items (16) and Add / Edit item (19).
// THE LIST COMES FIRST - the title with "+ Add", the search, today's filters as chips, then the cards. Nothing of today is dropped:
// Ready catalog / Import / New item are in the "+ Add" sheet; price suggestions, said-not-in-catalog names and learned names are
// behind ONE banner ("From your bills", an inner page); Archived is the last chip (Restore there); Undo is a bar after an Archive.
// A card opens Edit item: name, other names (chips), the unit fixed, the PRICE (moved here from the row), "Used N times", Save item,
// Archive. Add item: name, other names (saved with the item - one write), Sold by (today's unit chips + Other...), price. Edits stay
// online only with today's message; Ignore / Remove stay offline-able. Every list is read from the phone (a cold start shows it all).

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
let name = "";
let online = true;

const product = (p: Partial<LocalShopProduct> & Pick<LocalShopProduct, "displayName">): LocalShopProduct => ({
  id: p.displayName.toLowerCase().replace(/\s/g, "-"), shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...p,
});
const sugar = product({ displayName: "चीनी", id: "sugar", aliases: ["चीनी", "sugar", "शक्कर"], pricePaise: 4_500, source: "base" });
const salt = product({ displayName: "टाटा नमक", id: "salt", aliases: ["tata salt"], unit: "piece", pricePaise: 3_000, source: "learned" });
const rice = product({ displayName: "चावल", id: "rice", aliases: ["rice"], pricePaise: 6_800 });
const soap = product({ displayName: "Old Soap", id: "old-soap", isActive: false, pricePaise: 3_000 });

let n = 0;
const confirm = (alias: string, productId: string): LocalLearningEvent => ({
  localId: `e${n++}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias, shop_product_id: productId, source_layer: "fastpath" },
  createdAt: new Date(Date.now() - 1000 * (50 - n)).toISOString(), updatedAt: new Date().toISOString(), deviceId: "d",
});
/** 2 price suggestions (sugar ₹48 on 3 bills, rice ₹70 on 3), 1 said-not-in-catalog name, 2 learned names. */
async function fromBills() {
  const now = new Date().toISOString();
  for (const [p, price] of [[sugar, 4_800], [rice, 7_000]] as const)
    for (let i = 0; i < 3; i++) await db.priceObservations.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", shopProductId: p.id, observedPricePaise: price, occurredAt: now, updatedAt: now, deviceId: "d" });
  await db.provisionalProducts.put({ localId: crypto.randomUUID(), shopId, syncStatus: "synced", spokenName: "काजू", seenCount: 2, suggestedUnit: null, suggestedPricePaise: null, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId: "d" });
  // 2 learned names (not 1): the banner's counts differ, so a count shown under the wrong words is seen
  await db.learningEvents.bulkAdd([confirm("cheeni", "sugar"), confirm("cheeni", "sugar"), confirm("cheeni", "sugar"), confirm("chaawal", "rice")]);
}

beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  name = `ui-items16-${crypto.randomUUID()}`;
  db = new KiranaBillDB(name);
  await db.shopProducts.bulkPut([sugar, salt, rice, soap]);
});
afterEach(async () => {
  cleanup();
  act(() => setScreenLanguage("en"));
  vi.restoreAllMocks();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30));
});

function writers(result: CatalogWriteResult = { ok: true }) {
  const save = vi.fn(async (id: string, pricePaise: number) => {
    if (result.ok) await db.shopProducts.update(id, { pricePaise });
    return result;
  });
  const add = vi.fn(async () => result);
  const saveDetails = vi.fn(async (id: string, patch: ProductPatch) => {
    if (result.ok) await db.shopProducts.update(id, { ...(patch.display_name !== undefined ? { displayName: patch.display_name } : {}), ...(patch.aliases ? { aliases: patch.aliases } : {}) });
    return result;
  });
  const setActive = vi.fn(async (id: string, active: boolean) => {
    if (result.ok) await db.shopProducts.update(id, { isActive: active });
    return result;
  });
  const create = vi.fn(async (p: NewProduct) => {
    if (result.ok) await db.shopProducts.put(product({ displayName: p.name, unit: p.unit, pricePaise: p.pricePaise, aliases: [...p.aliases] }));
    return result;
  });
  const ignoreSuggestion = vi.fn(async () => {});
  const removeAlias = vi.fn(async () => {});
  const importRows = vi.fn(async () => ({ added: 0, alreadyThere: 0, failed: 0, stopped: false }) as never);
  return { save, add, saveDetails, setActive, create, ignoreSuggestion, removeAlias, importRows };
}

const onChanged = vi.fn();
async function open(w = writers(), inFrame = false) {
  onChanged.mockClear();
  const screenEl = (
    <CatalogScreen localDb={db} shopId={shopId} {...w} onChanged={onChanged} onClose={vi.fn()} />
  );
  render(inFrame ? <TabFrame tab="items" onTab={() => {}} offline={false}>{screenEl}</TabFrame> : screenEl);
  await waitFor(() => expect(within(screen.getByRole("region")).getAllByRole("listitem").length).toBeGreaterThan(0)); // any language
  return w;
}
const list = () => screen.getByRole("list", { name: "Products" });
const names = () => within(list()).getAllByTestId("name").map((e) => e.textContent);
const card = (n: string) => within(list()).getByRole("button", { name: `Edit ${n}` });
const nav = () => screen.queryByRole("navigation", { name: "Main" });
const back = async () =>
  act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 40));
  });

describe("16 Items: the list comes first", () => {
  it("in order: the title 'Items' with '+ Add', the search, the filter chips, then the list - before any extra", async () => {
    await fromBills();
    await open();
    const region = screen.getByRole("region", { name: "Items" });
    const order = [
      screen.getByRole("heading", { level: 1, name: "Items" }),
      screen.getByRole("button", { name: "Add" }),
      screen.getByRole("searchbox", { name: "Search products" }),
      screen.getByRole("group", { name: "Show" }),
      await screen.findByRole("button", { name: /From your bills/ }),
      list(),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy();
    expect(region.contains(list())).toBe(true);
    // the old clutter is gone from the page: no ready-catalog / import / learned-names / suggestions blocks above the list
    expect(screen.queryByRole("button", { name: "Add from ready catalog" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import from file" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Learned names" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Suggestions" })).toBeNull();
  });

  it("the search placeholder is the design's: 'Search items or what customers say'", async () => {
    await open();
    expect(screen.getByRole("searchbox", { name: "Search products" }).getAttribute("placeholder")).toBe("Search items or what customers say");
  });

  it("today's filters as 16's chips: All N · Custom · Learned · From base catalog · Archived; one pressed; a tap filters", async () => {
    await open();
    const chips = within(screen.getByRole("group", { name: "Show" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All 3", "Custom", "Learned", "From base catalog", "Archived"]);
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chips[2]!);
    expect(names()).toEqual(["टाटा नमक"]);
    expect(chips[2]!.getAttribute("aria-pressed")).toBe("true");
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("false");
  });

  it("a card as drawn: the first-letter tile, the name, the other names (never the name itself), 'learned', the price and 'per unit'", async () => {
    await open();
    const s = card("चीनी");
    expect(within(s).getByTestId("tile").textContent).toBe("च");
    expect(within(s).getByTestId("aliases").textContent).toBe("sugar · शक्कर");
    expect(within(s).queryByText("learned")).toBeNull();
    const t = card("टाटा नमक");
    expect(within(t).getByText("learned")).toBeTruthy();
    expect(within(t).getByText("₹30")).toBeTruthy();
    expect(within(t).getByText("per piece")).toBeTruthy();
    expect(within(s).getByText("per kg")).toBeTruthy();
  });

  it("the price on a card is shown, not edited there - a tap on the card opens Edit item (the price is edited there)", async () => {
    await open();
    expect(within(list()).queryByRole("textbox")).toBeNull();
    fireEvent.click(card("चावल"));
    const page = await screen.findByRole("region", { name: "Edit item" });
    expect((within(page).getByRole("textbox", { name: "Price per kg" }) as HTMLInputElement).value).toBe("68");
  });

  it("no back arrow on the tab (the nav and Android Back go Home)", async () => {
    await open();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });
});

describe("B: '+ Add' opens a sheet with every way to add", () => {
  it("New item · Add from ready catalog · Import from file", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const sheet = await screen.findByRole("dialog", { name: "Add items" });
    expect(within(sheet).getAllByRole("button").map((b) => b.querySelector("b")?.textContent ?? b.textContent)).toEqual(["New item", "Add from ready catalog", "Import from file"]);
  });

  it("each opens its page (the sheet closes): New item -> Add item; ready catalog; import", async () => {
    await open();
    for (const [option, page] of [["New item", "Add item"], ["Add from ready catalog", "Ready catalog"], ["Import from file", "Import products"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: "Add" }));
      fireEvent.click(within(await screen.findByRole("dialog", { name: "Add items" })).getByRole("button", { name: new RegExp(option) }));
      expect(screen.queryByRole("dialog", { name: "Add items" })).toBeNull();
      expect(await screen.findByRole("region", { name: page })).toBeTruthy();
      await back();
      await waitFor(() => expect(screen.queryByRole("region", { name: page })).toBeNull());
      expect(screen.getByRole("region", { name: "Items" })).toBeTruthy(); // Android Back: the list, never Home
    }
  });

  it("offline: all three wait, with today's note", async () => {
    online = false;
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    const sheet = await screen.findByRole("dialog", { name: "Add items" });
    for (const b of within(sheet).getAllByRole("button")) expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(within(sheet).getByText("Needs internet to change the catalog")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: /New item/ }));
    expect(screen.queryByRole("region", { name: "Add item" })).toBeNull();
  });

  it("Android Back closes only the sheet", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("dialog", { name: "Add items" });
    await back();
    expect(screen.queryByRole("dialog", { name: "Add items" })).toBeNull();
    expect(screen.getByRole("region", { name: "Items" })).toBeTruthy();
  });
});

describe("C: the 'From your bills' banner and its inner page", () => {
  it("the banner counts what is waiting - 2 prices, 1 new name, 2 learned names; none when there is nothing", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /From your bills/ })).toBeNull();
    cleanup();
    await fromBills();
    await open();
    const banner = await screen.findByRole("button", { name: /From your bills/ });
    expect(banner.textContent).toContain("2 prices to check");
    expect(banner.textContent).toContain("1 new name");
    expect(banner.textContent).toContain("2 learned names");
    expect(banner.textContent).not.toContain("2 new names");
  });

  it("the page holds today's three blocks - Use / Ignore on each price, the said names (read only), Remove on each learned name", async () => {
    await fromBills();
    const w = await open();
    fireEvent.click(await screen.findByRole("button", { name: /From your bills/ }));
    const page = await screen.findByRole("region", { name: "From your bills" });
    const prices = within(page).getByRole("region", { name: "Prices you charged" });
    expect(within(prices).getByRole("button", { name: "Use ₹48 for चीनी" })).toBeTruthy();
    expect(within(prices).getByRole("button", { name: "Ignore the suggestion for चावल" })).toBeTruthy();
    expect(within(page).getByRole("region", { name: "Said, not in your items" }).textContent).toContain("“काजू” — said 2 times, not in the catalog");
    const learned = within(page).getByRole("region", { name: "Learned names" });
    fireEvent.click(within(learned).getByRole("button", { name: /Remove “cheeni”/ }));
    await waitFor(() => expect(w.removeAlias).toHaveBeenCalledWith("cheeni", "sugar"));
    fireEvent.click(within(prices).getByRole("button", { name: "Use ₹48 for चीनी" }));
    await waitFor(() => expect(w.save).toHaveBeenCalledWith("sugar", 4_800));
  });

  it("offline: Use waits (a catalog write); Ignore and Remove still work (local learning writes)", async () => {
    await fromBills();
    online = false;
    const w = await open();
    fireEvent.click(await screen.findByRole("button", { name: /From your bills/ }));
    const page = await screen.findByRole("region", { name: "From your bills" });
    const use = within(page).getByRole("button", { name: "Use ₹48 for चीनी" });
    expect(use.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(use);
    fireEvent.click(within(page).getByRole("button", { name: "Ignore the suggestion for चीनी" }));
    await waitFor(() => expect(w.ignoreSuggestion).toHaveBeenCalledWith("sugar"));
    expect(w.save).not.toHaveBeenCalled();
  });

  it("an inner page: Back (and Android Back) returns to the list", async () => {
    await fromBills();
    await open();
    fireEvent.click(await screen.findByRole("button", { name: /From your bills/ }));
    await screen.findByRole("region", { name: "From your bills" });
    await back();
    expect(screen.queryByRole("region", { name: "From your bills" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /From your bills/ }));
    fireEvent.click(within(await screen.findByRole("region", { name: "From your bills" })).getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "From your bills" })).toBeNull());
  });
});

describe("Archived and Undo", () => {
  it("the Archived chip lists archived items, each with Restore", async () => {
    const w = await open();
    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Archived" }));
    expect(names()).toEqual(["Old Soap"]);
    fireEvent.click(within(list()).getByRole("button", { name: "Restore Old Soap" }));
    await waitFor(() => expect(w.setActive).toHaveBeenCalledWith("old-soap", true));
  });

  it("after Archive in Edit item: the Undo bar - '“चावल” archived', Undo restores it", async () => {
    const w = await open();
    fireEvent.click(card("चावल"));
    fireEvent.click(within(await screen.findByRole("region", { name: "Edit item" })).getByRole("button", { name: "Archive product" }));
    const bar = (await screen.findByText("“चावल” archived")).closest<HTMLElement>("[role=status]")!;
    expect(bar).toBeTruthy();
    expect(names()).not.toContain("चावल");
    fireEvent.click(within(bar).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(w.setActive).toHaveBeenLastCalledWith("rice", true));
    await waitFor(() => expect(names()).toContain("चावल"));
  });
});

describe("D: Add item (19)", () => {
  async function openAdd(w = writers()) {
    await open(w);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "Add items" })).getByRole("button", { name: /New item/ }));
    return { w, page: within(await screen.findByRole("region", { name: "Add item" })) };
  }

  it("as drawn: Item name, Other names customers say (+ Add name), Sold by (today's units + Other…), Price per unit, Save item - nothing filled in", async () => {
    const { page } = await openAdd();
    expect((page.getByRole("textbox", { name: "Item name" }) as HTMLInputElement).value).toBe("");
    expect(page.getByText("Other names customers say")).toBeTruthy();
    expect(page.getByRole("button", { name: "Add name" })).toBeTruthy();
    const units = within(page.getByRole("radiogroup", { name: "Sold by" })).getAllByRole("radio");
    expect(units.map((u) => u.textContent)).toEqual(["kg", "gm", "liter", "ml", "piece", "Other…"]);
    expect(units.every((u) => u.getAttribute("aria-checked") === "false")).toBe(true); // the app never picks a unit (rule 7)
    expect((page.getByRole("textbox", { name: "Price" }) as HTMLInputElement).value).toBe("");
    expect(page.getByText("Fills in when you don’t say a price.")).toBeTruthy();
    expect(page.getByRole("button", { name: "Save item" })).toBeTruthy();
  });

  it("the price label follows the unit chosen ('Price per kg'); Other… opens today's typed unit with its hint", async () => {
    const { page } = await openAdd();
    fireEvent.click(page.getByRole("radio", { name: "kg" }));
    expect(page.getByRole("textbox", { name: "Price per kg" })).toBeTruthy();
    fireEvent.click(page.getByRole("radio", { name: "Other…" }));
    fireEvent.change(page.getByRole("textbox", { name: "Unit" }), { target: { value: "packet" } });
    expect(page.getByText(/“packet” isn't one of/)).toBeTruthy();
    expect(page.getByRole("textbox", { name: "Price per packet" })).toBeTruthy();
  });

  it("other names are saved WITH the item, in one write, by Edit's rules (a name taken by another item is not saved, and says why)", async () => {
    const { w, page } = await openAdd();
    fireEvent.change(page.getByRole("textbox", { name: "Item name" }), { target: { value: "तूर दाल" } });
    for (const alias of ["toor dal", "rice"]) {
      fireEvent.click(page.getByRole("button", { name: "Add name" }));
      const field = page.getByRole("textbox", { name: "Other name" });
      fireEvent.change(field, { target: { value: alias } });
      fireEvent.keyDown(field, { key: "Enter" });
    }
    expect(page.getByRole("button", { name: "Remove toor dal" })).toBeTruthy();
    expect(page.getByRole("list", { name: "Not saved" }).textContent).toContain("rice");
    fireEvent.click(page.getByRole("radio", { name: "kg" }));
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "150" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(w.create).toHaveBeenCalledOnce());
    expect(w.create.mock.calls[0]![0]).toEqual({ name: "तूर दाल", unit: "kg", unitKnown: true, pricePaise: 15_000, aliases: ["toor dal"] });
    await waitFor(() => expect(screen.queryByRole("region", { name: "Add item" })).toBeNull());
    expect(names()).toContain("तूर दाल");
  });

  it("a missing name / unit / price: each says why, nothing is written", async () => {
    const { w, page } = await openAdd();
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    const alerts = page.getAllByRole("alert").map((a) => a.textContent);
    expect(alerts).toEqual(expect.arrayContaining(["Name needed", "Unit needed"]));
    expect(alerts.length).toBe(3);
    expect(w.create).not.toHaveBeenCalled();
  });

  it("the connection lost while it is open: Save item waits, with today's note", async () => {
    const { page } = await openAdd();
    online = false;
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(page.getByText("Needs internet to change the catalog")).toBeTruthy();
    expect(page.getByRole("button", { name: "Save item" }).hasAttribute("disabled")).toBe(true);
  });
});

describe("E: Edit item (19, filled)", () => {
  async function openEdit(n: string, w = writers()) {
    await open(w);
    fireEvent.click(card(n));
    return { w, page: within(await screen.findByRole("region", { name: "Edit item" })) };
  }

  it("as drawn, filled: the name, the other names as chips (not the name itself), the unit fixed, the price, 'Used N times', Save item, Archive", async () => {
    const { page } = await openEdit("चीनी");
    expect((page.getByRole("textbox", { name: "Item name" }) as HTMLInputElement).value).toBe("चीनी");
    expect(page.getByRole("button", { name: "Remove sugar" })).toBeTruthy();
    expect(page.getByRole("button", { name: "Remove शक्कर" })).toBeTruthy();
    expect(page.queryByRole("button", { name: "Remove चीनी" })).toBeNull();
    expect(page.getByText(/A unit can't be changed here/)).toBeTruthy();
    expect(page.queryByRole("radiogroup", { name: "Sold by" })).toBeNull();
    expect((page.getByRole("textbox", { name: "Price per kg" }) as HTMLInputElement).value).toBe("45");
    expect(page.getByText("Not used yet")).toBeTruthy();
    expect(page.getByRole("button", { name: "Save item" })).toBeTruthy();
    expect(page.getByRole("button", { name: "Archive product" })).toBeTruthy();
  });

  it("a new price saves through today's price writer (whole paise), nothing else sent", async () => {
    const { w, page } = await openEdit("चीनी");
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "48.50" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(w.save).toHaveBeenCalledWith("sugar", 4_850));
    expect(w.saveDetails).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Edit item" })).toBeNull());
    expect(within(card("चीनी")).getByText("₹48.50")).toBeTruthy();
  });

  it("a bad price says why and writes nothing", async () => {
    const { w, page } = await openEdit("चीनी");
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "abc" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    expect(await page.findByRole("alert")).toBeTruthy();
    expect(w.save).not.toHaveBeenCalled();
    expect(w.saveDetails).not.toHaveBeenCalled();
  });

  it("a rename + another name: one details write; removing a chip sends the list without it", async () => {
    const { w, page } = await openEdit("चीनी");
    fireEvent.change(page.getByRole("textbox", { name: "Item name" }), { target: { value: "शक्कर चीनी" } });
    fireEvent.click(page.getByRole("button", { name: "Remove sugar" }));
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledOnce());
    const patch = w.saveDetails.mock.calls[0]![1];
    expect(patch.display_name).toBe("शक्कर चीनी");
    expect(patch.aliases).not.toContain("sugar");
    expect(patch.aliases).toContain("शक्कर");
    expect(w.save).not.toHaveBeenCalled();
  });

  it("after a rename, 'Keep as another name' adds the old name as a chip", async () => {
    const { page } = await openEdit("चावल");
    fireEvent.change(page.getByRole("textbox", { name: "Item name" }), { target: { value: "बासमती चावल" } });
    fireEvent.click(page.getByRole("button", { name: /Keep/ }));
    expect(page.getByRole("button", { name: "Remove चावल" })).toBeTruthy();
  });

  it("offline: it opens to look, but Save item and Archive wait, with today's note", async () => {
    online = false;
    const { page } = await openEdit("चीनी");
    expect(page.getByText("Needs internet to change the catalog")).toBeTruthy();
    expect(page.getByRole("button", { name: "Save item" }).hasAttribute("disabled")).toBe(true);
    expect(page.getByRole("button", { name: "Archive product" }).hasAttribute("disabled")).toBe(true);
  });

  it("a rename that saves, then a price that fails: the page stays and says so; billing is told once (the name did change)", async () => {
    const w = writers();
    w.save.mockResolvedValue({ ok: false, reason: "failed" });
    const { page } = await openEdit("चीनी", w);
    fireEvent.change(page.getByRole("textbox", { name: "Item name" }), { target: { value: "शक्कर" } });
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "50" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    expect((await page.findByRole("alert")).textContent).toBe("Couldn't save — check the internet and try again");
    expect(w.saveDetails).toHaveBeenCalledOnce();
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.getByRole("region", { name: "Edit item" })).toBeTruthy();
  });

  it("a write that fails says so and keeps the page open", async () => {
    const { page } = await openEdit("चीनी", writers({ ok: false, reason: "failed" }));
    fireEvent.change(page.getByRole("textbox", { name: "Price per kg" }), { target: { value: "50" } });
    fireEvent.click(page.getByRole("button", { name: "Save item" }));
    expect((await page.findByRole("alert")).textContent).toBe("Couldn't save — check the internet and try again");
    expect(screen.getByRole("region", { name: "Edit item" })).toBeTruthy();
  });

  it("Android Back with nothing changed: back to the list (with a change it asks first, as today)", async () => {
    await openEdit("चीनी");
    await back();
    expect(screen.queryByRole("region", { name: "Edit item" })).toBeNull();
    expect(screen.getByRole("region", { name: "Items" })).toBeTruthy();
  });
});

describe("inner pages over the Items tab hide the nav", () => {
  it("the Add sheet, From your bills, Add item, Edit item: no nav while open; the list: the nav", async () => {
    await fromBills();
    await open(writers(), true);
    expect(nav()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await screen.findByRole("dialog", { name: "Add items" });
    expect(nav()).toBeNull();
    await back();
    expect(nav()).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /From your bills/ }));
    await screen.findByRole("region", { name: "From your bills" });
    expect(nav()).toBeNull();
    await back();
    fireEvent.click(card("चीनी"));
    await screen.findByRole("region", { name: "Edit item" });
    expect(nav()).toBeNull();
  });
});

describe("cold start: everything read from the phone's database", () => {
  it("a fresh connection shows the list, the counts, the banner and the archived item", async () => {
    await fromBills();
    db.close();
    db = new KiranaBillDB(name);
    await open();
    expect(names()).toEqual(expect.arrayContaining(["चीनी", "टाटा नमक", "चावल"]));
    expect(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "All 3" })).toBeTruthy();
    expect((await screen.findByRole("button", { name: /From your bills/ })).textContent).toContain("2 prices to check");
    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Archived" }));
    expect(names()).toEqual(["Old Soap"]);
  });
});

describe("3 languages", () => {
  it("हिन्दी: the title, the search, the sheet, the banner and the Add page", async () => {
    act(() => setScreenLanguage("hi"));
    await fromBills();
    await open();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("सामान");
    expect(screen.getByRole("searchbox").getAttribute("placeholder")).toBe("सामान या ग्राहक जो बोलते हैं, खोजें");
    expect((await screen.findByRole("button", { name: /आपके बिलों से/ })).textContent).toContain("2 भाव देखने हैं");
    fireEvent.click(screen.getByRole("button", { name: "जोड़ें" }));
    const sheet = await screen.findByRole("dialog");
    expect(sheet.textContent).toContain("नया सामान");
    fireEvent.click(within(sheet).getByRole("button", { name: /नया सामान/ }));
    const page = await screen.findByRole("region", { name: "सामान जोड़ें" });
    expect(within(page).getByRole("button", { name: "सामान सेव करें" })).toBeTruthy();
  });
});
