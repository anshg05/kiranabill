// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import type { CatalogWriteResult } from "@/data/catalogEdit";
import type { NewProduct, ProductPatch } from "@/domain/catalogEdit";
import { CatalogScreen } from "./CatalogScreen";

// KB-330 (D71, D77): the Catalog renames, edits aliases, archives / restores and adds a product. All writes are ONLINE
// (D62) and go through injected writers (the app's write to Postgres + re-pull, data/catalogEdit.ts with its own e2e);
// the fakes do what the re-pull does - they update Dexie. The screen never writes Dexie itself.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;

function product(p: Partial<LocalShopProduct> & Pick<LocalShopProduct, "displayName">): LocalShopProduct {
  return {
    id: crypto.randomUUID(), shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [],
    source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...p,
  };
}
const sugar = product({ displayName: "Sugar", aliases: ["chini", "cheeni"], pricePaise: 4_800, useCount: 9, source: "base" });
const atta = product({ displayName: "Atta", aliases: ["gehun atta"], pricePaise: 3_500, useCount: 5 });
const oldSoap = product({ displayName: "Old Soap", aliases: ["purana sabun"], isActive: false, pricePaise: 3_000 });

let online = true;
beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`ui-catalog-manage-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([sugar, atta, oldSoap]);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30)); // a closed sheet takes its history entry off on the next tick
});

function writers(result: CatalogWriteResult = { ok: true }) {
  const save = vi.fn(async () => ({ ok: true }) as CatalogWriteResult);
  const add = vi.fn(async () => ({ ok: true }) as CatalogWriteResult);
  const saveDetails = vi.fn(async (id: string, patch: ProductPatch) => {
    if (result.ok) await db.shopProducts.update(id, { ...(patch.display_name !== undefined ? { displayName: patch.display_name } : {}), ...(patch.aliases ? { aliases: patch.aliases } : {}) });
    return result;
  });
  const setActive = vi.fn(async (id: string, active: boolean) => {
    if (result.ok) await db.shopProducts.update(id, { isActive: active });
    return result;
  });
  const create = vi.fn(async (p: NewProduct) => {
    if (result.ok) await db.shopProducts.put(product({ displayName: p.name, unit: p.unit, pricePaise: p.pricePaise }));
    return result;
  });
  return { save, add, saveDetails, setActive, create };
}

async function open(w = writers(), onChanged = vi.fn()) {
  render(
    <CatalogScreen localDb={db} shopId={shopId} save={w.save} add={w.add} saveDetails={w.saveDetails} setActive={w.setActive} create={w.create} onChanged={onChanged} onClose={() => {}} />,
  );
  await screen.findByRole("list", { name: "Products" });
  return { ...w, onChanged };
}
const rows = () => within(screen.getByRole("list", { name: "Products" })).queryAllByRole("listitem");
const names = () => rows().map((r) => within(r).getByTestId("name").textContent);
const row = (name: string) => rows().find((r) => within(r).getByTestId("name").textContent === name)!;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const tap = (el: HTMLElement) => fireEvent.click(el);

async function openEdit(name: string) {
  tap(within(row(name)).getByRole("button", { name: `Edit ${name}` }));
  return within(await screen.findByRole("region", { name: "Edit product" }));
}

describe("KB-330 - Edit product: rename and other names", () => {
  it("each row has an Edit button; the sheet shows the name, the other names, and the unit as plain text (no unit field)", async () => {
    await open();
    const s = await openEdit("Sugar");
    expect((s.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Sugar");
    expect((s.getByRole("textbox", { name: "Other names" }) as HTMLTextAreaElement).value).toBe("chini\ncheeni");
    expect(s.getByText(/Unit: kg/)).toBeTruthy();
    expect(s.queryByRole("textbox", { name: /unit/i })).toBeNull();
    expect(s.queryByRole("combobox")).toBeNull();
  });

  it("Save is off until something changed", async () => {
    await open();
    const s = await openEdit("Sugar");
    expect((s.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    type(s.getByRole("textbox", { name: "Name" }), "Sugar Fine");
    expect((s.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a rename sends ONLY the name, normalised; the list, the sheet and onChanged follow", async () => {
    const w = await open();
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "  Sugar   Fine ");
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledOnce());
    expect(w.saveDetails).toHaveBeenCalledWith(sugar.id, { display_name: "Sugar Fine" });
    await waitFor(() => expect(names()).toContain("Sugar Fine"));
    expect(screen.queryByRole("region", { name: "Edit product" })).toBeNull();
    expect(w.onChanged).toHaveBeenCalledOnce();
  });

  it("a pure rename never rewrites aliases it did not touch - even stored ones the rules would drop today", async () => {
    const besan = product({ displayName: "Besan", aliases: ["Gram Flour", "gehun atta", "bn"] }); // mixed case; one clashes with Atta; one too short
    await db.shopProducts.put(besan);
    const w = await open();
    const s = await openEdit("Besan");
    expect(s.queryByRole("list", { name: "Not saved" })).toBeNull(); // nothing listed until the shopkeeper edits the names
    type(s.getByRole("textbox", { name: "Name" }), "Besan Fine");
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledOnce());
    expect(w.saveDetails).toHaveBeenCalledWith(besan.id, { display_name: "Besan Fine" });
  });

  it("a name already used - by an active OR an archived product - is refused before any write", async () => {
    const w = await open();
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "atta");
    expect(s.getByRole("alert").textContent).toBe("Another product is already called “atta”");
    expect((s.getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    type(s.getByRole("textbox", { name: "Name" }), "OLD SOAP");
    expect(s.getByRole("alert").textContent).toBe("Another product is already called “OLD SOAP” (archived)");
    expect(w.saveDetails).not.toHaveBeenCalled();
  });

  it("an empty name is refused", async () => {
    await open();
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "   ");
    expect(s.getByRole("alert").textContent).toBe("Name needed");
  });

  it("a dropped alias is LISTED before Save, with its reason; Save sends only the good ones", async () => {
    const w = await open();
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Other names" }), "chini\nab\nGehun Atta\nmeetha");
    const list = s.getByRole("list", { name: "Not saved" });
    expect(list.textContent).toContain("“ab” — shorter than 3 characters");
    expect(list.textContent).toContain("“gehun atta” — same as another product's name or alias");
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledOnce());
    expect(w.saveDetails).toHaveBeenCalledWith(sugar.id, { aliases: ["chini", "meetha"] });
  });

  it("renaming warns that the old name stops matching; 'Keep as another name' adds it to the field - and only then is it saved", async () => {
    const w = await open();
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "Cheeni Powder");
    expect(s.getByText("“Sugar” will stop matching when spoken.")).toBeTruthy();
    tap(s.getByRole("button", { name: "Keep “Sugar” as another name" }));
    expect((s.getByRole("textbox", { name: "Other names" }) as HTMLTextAreaElement).value).toBe("chini\ncheeni\nsugar");
    expect(s.queryByText(/will stop matching/)).toBeNull();
    expect(w.saveDetails).not.toHaveBeenCalled(); // nothing silent: it is a field edit until Save
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledWith(sugar.id, { display_name: "Cheeni Powder", aliases: ["chini", "cheeni", "sugar"] }));
  });

  it("the server says 'duplicate' (another phone took the name): the sheet stays open and says so", async () => {
    await open(writers({ ok: false, reason: "duplicate" }));
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "Sugar Fine");
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.getByRole("alert").textContent).toContain("already called “Sugar Fine”"));
    expect(screen.getByRole("region", { name: "Edit product" })).toBeTruthy();
  });

  it("a failed save keeps the sheet and the typing, and says why", async () => {
    await open(writers({ ok: false, reason: "failed" }));
    const s = await openEdit("Sugar");
    type(s.getByRole("textbox", { name: "Name" }), "Sugar Fine");
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(s.getByRole("alert").textContent).toBe("Couldn't save — check the internet and try again"));
    expect((s.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Sugar Fine");
  });
});

describe("KB-330 - Archive and restore (never a delete)", () => {
  it("Archive: one tap writes is_active=false, the product leaves the list, a status line offers Undo; billing is told to reload", async () => {
    const w = await open();
    const s = await openEdit("Sugar");
    tap(s.getByRole("button", { name: "Archive product" }));
    await waitFor(() => expect(w.setActive).toHaveBeenCalledWith(sugar.id, false));
    await waitFor(() => expect(names()).toEqual(["Atta"]));
    expect(screen.getByRole("status").textContent).toContain("“Sugar” archived");
    expect(w.onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull(); // no confirm dialog
  });

  it("Undo restores it at once", async () => {
    const w = await open();
    tap((await openEdit("Sugar")).getByRole("button", { name: "Archive product" }));
    tap(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(w.setActive).toHaveBeenLastCalledWith(sugar.id, true));
    await waitFor(() => expect(names()).toContain("Sugar"));
  });

  it("the Archived filter lists archived products with Restore (price shown, not editable); Restore brings one back", async () => {
    const w = await open();
    tap(screen.getByRole("radio", { name: "Archived" }));
    expect(names()).toEqual(["Old Soap"]);
    expect(row("Old Soap").textContent).toContain("₹30 / kg");
    expect(within(row("Old Soap")).queryByRole("button", { name: /Price of/ })).toBeNull();
    tap(within(row("Old Soap")).getByRole("button", { name: "Restore Old Soap" }));
    await waitFor(() => expect(w.setActive).toHaveBeenCalledWith(oldSoap.id, true));
    await waitFor(() => expect(screen.getByText("No archived products.")).toBeTruthy());
    tap(screen.getByRole("radio", { name: "All" }));
    expect(names()).toContain("Old Soap");
  });

  it("an archived product can still be renamed - that is how its name is freed for a new product", async () => {
    const w = await open();
    tap(screen.getByRole("radio", { name: "Archived" }));
    const s = await openEdit("Old Soap");
    type(s.getByRole("textbox", { name: "Name" }), "Old Soap (retired)");
    expect(s.queryByRole("button", { name: "Archive product" })).toBeNull(); // already archived
    tap(s.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(w.saveDetails).toHaveBeenCalledWith(oldSoap.id, { display_name: "Old Soap (retired)" }));
  });

  it("a failed archive changes nothing on screen", async () => {
    await open(writers({ ok: false, reason: "failed" }));
    const s = await openEdit("Sugar");
    tap(s.getByRole("button", { name: "Archive product" }));
    await waitFor(() => expect(s.getByRole("alert").textContent).toBe("Couldn't save — check the internet and try again"));
    tap(s.getByRole("button", { name: "Back" })); // the list behind the sheet is inert while it is open
    await waitFor(() => expect(names()).toContain("Sugar"));
  });
});

describe("KB-330 - offline: the catalog can't be changed (D62)", () => {
  it("Edit, Add product and Restore are disabled with the existing note; nothing opens", async () => {
    const w = await open();
    online = false;
    window.dispatchEvent(new Event("offline"));
    await screen.findByText("Needs internet to change the catalog");
    const edit = within(row("Sugar")).getByRole("button", { name: "Edit Sugar" });
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    tap(edit);
    expect(screen.queryByRole("region", { name: "Edit product" })).toBeNull();
    const add = screen.getByRole("button", { name: "Add product" });
    expect(add.getAttribute("aria-disabled")).toBe("true");
    tap(add);
    expect(screen.queryByRole("region", { name: "Add product" })).toBeNull();
    tap(screen.getByRole("radio", { name: "Archived" }));
    const restore = within(row("Old Soap")).getByRole("button", { name: "Restore Old Soap" });
    expect(restore.getAttribute("aria-disabled")).toBe("true");
    tap(restore);
    expect(w.setActive).not.toHaveBeenCalled();
  });
});

describe("KB-330 - Add product (D77): name, unit, price - typed by the shopkeeper, never filled in by the app", () => {
  async function openAdd(w = writers()) {
    const ctx = await open(w);
    tap(screen.getByRole("button", { name: "Add product" }));
    const s = within(await screen.findByRole("region", { name: "Add product" }));
    return { ...ctx, s };
  }
  const fields = (s: ReturnType<typeof within>) => ({
    name: s.getByRole("textbox", { name: "Name" }) as HTMLInputElement,
    unit: s.getByRole("textbox", { name: "Unit" }) as HTMLInputElement,
    price: s.getByRole("textbox", { name: "Price (₹)" }) as HTMLInputElement,
  });

  it("opens with every field EMPTY - no default unit, no default price", async () => {
    const { s } = await openAdd();
    const f = fields(s);
    expect([f.name.value, f.unit.value, f.price.value]).toEqual(["", "", ""]);
    expect(s.queryByRole("button", { name: "kg" })?.getAttribute("aria-pressed") ?? "false").toBe("false"); // no chip pre-picked
  });

  it("Add with nothing typed reports all three and writes nothing", async () => {
    const { s, create } = await openAdd();
    tap(s.getByRole("button", { name: "Add" }));
    expect(s.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Name needed", "Unit needed", "Price needed"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("a typed row is written once: normalised name, the app's unit spelling, exact paise; the list and a status line follow", async () => {
    const { s, create, onChanged } = await openAdd();
    const f = fields(s);
    type(f.name, "  Jaggery  Block ");
    type(f.unit, "Kilo");
    type(f.price, "₹ 125.50");
    tap(s.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create).toHaveBeenCalledWith({ name: "Jaggery Block", unit: "kg", unitKnown: true, pricePaise: 12_550 });
    await waitFor(() => expect(names()).toContain("Jaggery Block"));
    expect(screen.getByRole("status").textContent).toContain("Jaggery Block added — ₹125.50 / kg");
    expect(onChanged).toHaveBeenCalledOnce();
    expect(screen.queryByRole("region", { name: "Add product" })).toBeNull();
  });

  it("a unit chip is a tap by the shopkeeper: it fills the unit field", async () => {
    const { s } = await openAdd();
    tap(s.getByRole("button", { name: "piece" }));
    expect(fields(s).unit.value).toBe("piece");
  });

  it("an unusual unit is allowed, with a note that it is kept as typed", async () => {
    const { s, create } = await openAdd();
    const f = fields(s);
    type(f.name, "Eggs");
    type(f.unit, "Dozen");
    type(f.price, "84");
    expect(s.getByText(/“dozen” isn't one of kg, gm, liter, ml, piece — it is saved as typed/)).toBeTruthy();
    tap(s.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Eggs", unit: "dozen", unitKnown: false, pricePaise: 8_400 }));
  });

  it("a name used by an ARCHIVED product is refused, pointing at the Archived list", async () => {
    const { s, create } = await openAdd();
    const f = fields(s);
    type(f.name, "old soap");
    type(f.unit, "pc");
    type(f.price, "30");
    tap(s.getByRole("button", { name: "Add" }));
    expect(s.getAllByRole("alert").map((a) => a.textContent)).toEqual(["Another product is already called “old soap” (archived)"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("a price of 0 or unclear text is refused", async () => {
    const { s, create } = await openAdd();
    const f = fields(s);
    type(f.name, "Soap");
    type(f.unit, "pc");
    type(f.price, "0");
    tap(s.getByRole("button", { name: "Add" }));
    expect(s.getByRole("alert").textContent).toBe("Must be more than ₹0");
    type(f.price, "45,50");
    tap(s.getByRole("button", { name: "Add" }));
    expect(s.getByRole("alert").textContent).toMatch(/Price unclear/);
    expect(create).not.toHaveBeenCalled();
  });

  it("the server says 'duplicate' (another phone added it): the sheet stays and says so; 'failed' says to check the internet", async () => {
    const { s } = await openAdd(writers({ ok: false, reason: "duplicate" }));
    const f = fields(s);
    type(f.name, "Soap");
    type(f.unit, "pc");
    type(f.price, "30");
    tap(s.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(s.getByRole("alert").textContent).toContain("already called “Soap”"));
  });

  it("a failed add keeps the typing", async () => {
    const { s } = await openAdd(writers({ ok: false, reason: "failed" }));
    const f = fields(s);
    type(f.name, "Soap");
    type(f.unit, "pc");
    type(f.price, "30");
    tap(s.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(s.getByRole("alert").textContent).toBe("Couldn't save — check the internet and try again"));
    expect(f.price.value).toBe("30");
  });
});
