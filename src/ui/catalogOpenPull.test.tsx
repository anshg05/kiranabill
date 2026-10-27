// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import { noteCatalogPulled } from "@/data/catalogPullStatus";
import { CatalogScreen } from "./CatalogScreen";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";

// KB-350 follow-up (owner, 22 Oct 2026): the Catalog screen, when ALREADY OPEN, refreshes on a pull from another phone. If the
// shopkeeper is editing that very product (the inline price editor or the Edit sheet is open) his typing is never overwritten -
// a small note "Changed on another phone: now ₹60" tells him, and he decides.

const shopId = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB;
const sugar: LocalShopProduct = {
  id: "p-sugar", shopId, baseProductId: null, displayName: "Sugar", category: null, unit: "kg", pricePaise: 4_800, aliases: ["Sugar"],
  source: "custom", useCount: 5, sku: null, barcode: null, isActive: true,
};
const atta: LocalShopProduct = { ...sugar, id: "p-atta", displayName: "Atta", pricePaise: 3_500, aliases: ["Atta"], useCount: 1 };

beforeEach(async () => {
  stubLocalStorage();
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => true);
  db = new KiranaBillDB(`ui-catalog-pull-${crypto.randomUUID()}`);
  await db.shopProducts.bulkPut([sugar, atta]);
});
afterEach(async () => {
  cleanup();
  setScreenLanguage("en");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
  await db.delete();
});

async function open() {
  const save = vi.fn(async (id: string, pricePaise: number) => {
    await db.shopProducts.update(id, { pricePaise });
    return { ok: true } as const;
  });
  const saveDetails = vi.fn(async () => ({ ok: true }) as const);
  render(<CatalogScreen localDb={db} shopId={shopId} save={save} add={async () => ({ ok: true })} saveDetails={saveDetails} setActive={async () => ({ ok: true })} onChanged={() => {}} onClose={() => {}} />);
  await screen.findAllByTestId("name");
  return { save, saveDetails };
}
/** What a sync pull does: Dexie gets the other phone's row, then the screens are told. */
const pulled = async (id: string, change: Partial<LocalShopProduct>) => {
  await db.shopProducts.update(id, change);
  await act(async () => noteCatalogPulled(db.name));
};
const names = () => screen.getAllByTestId("name").map((n) => n.textContent);
const row = (name: string) => screen.getAllByTestId("name").find((n) => n.textContent === name)!.closest("li")!;
const NOTE = "Changed on another phone: now ₹60";

describe("an open Catalog refreshes on a pull", () => {
  it("another phone's price shows at once, with no reopening", async () => {
    await open();
    expect(row("Sugar").textContent).toContain("₹48 / kg");
    await pulled("p-sugar", { pricePaise: 6_000 });
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹60 / kg"));
    expect(screen.queryByText(NOTE)).toBeNull(); // nobody was editing it: no note
  });

  it("a rename and an archive on another phone show at once", async () => {
    await open();
    await pulled("p-atta", { displayName: "Aata loose" });
    await waitFor(() => expect(names()).toContain("Aata loose"));
    await pulled("p-atta", { isActive: false });
    await waitFor(() => expect(names()).not.toContain("Aata loose"));
  });
});

describe("the inline price editor is never overwritten", () => {
  it("typing stays; a note says what the other phone set; Enter saves HIS value", async () => {
    const { save } = await open();
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    const input = within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "55" } });
    await pulled("p-sugar", { pricePaise: 6_000 });
    await screen.findByText(NOTE);
    expect((within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }) as HTMLInputElement).value).toBe("55");
    fireEvent.keyDown(within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }), { key: "Enter" });
    expect(save).toHaveBeenCalledWith("p-sugar", 5_500);
  });

  it("an editor opened and left UNTOUCHED does not save its old value over the other phone's when it closes", async () => {
    const { save } = await open();
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    await pulled("p-sugar", { pricePaise: 6_000 });
    await screen.findByText(NOTE);
    fireEvent.blur(within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }));
    expect(save).not.toHaveBeenCalled();
    await waitFor(() => expect(row("Sugar").textContent).toContain("₹60 / kg"));
    expect(screen.queryByText(NOTE)).toBeNull(); // closed: the note goes with the editor
  });

  it("a pull that changes ANOTHER product leaves the open editor and shows no note", async () => {
    await open();
    fireEvent.click(within(row("Sugar")).getByRole("button", { name: "Price of Sugar" }));
    fireEvent.change(within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }), { target: { value: "55" } });
    await pulled("p-atta", { pricePaise: 3_600 });
    await waitFor(() => expect(row("Atta").textContent).toContain("₹36 / kg"));
    expect((within(row("Sugar")).getByRole("textbox", { name: "Price of Sugar" }) as HTMLInputElement).value).toBe("55");
    expect(screen.queryByText(/Changed on another phone/)).toBeNull();
  });
});

describe("the Edit sheet is never overwritten", () => {
  const openSheet = async () => {
    const w = await open();
    fireEvent.click(screen.getByRole("button", { name: "Edit Sugar" }));
    await screen.findByRole("region", { name: "Edit product" });
    return w;
  };
  it("what he typed stays; the note shows the other phone's price", async () => {
    await openSheet();
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), { target: { value: "Sugar fine" } });
    await pulled("p-sugar", { pricePaise: 6_000 });
    await within(screen.getByRole("region", { name: "Edit product" })).findByText(NOTE);
    expect((screen.getByRole("textbox", { name: "Name" }) as HTMLInputElement).value).toBe("Sugar fine");
  });
  it("a rename or an archive elsewhere is named in the note too", async () => {
    await openSheet();
    await pulled("p-sugar", { displayName: "Chini" });
    await within(screen.getByRole("region", { name: "Edit product" })).findByText("Changed on another phone: now “Chini”");
    await pulled("p-sugar", { isActive: false });
    await within(screen.getByRole("region", { name: "Edit product" })).findByText("Changed on another phone: now archived");
  });
  it("no note while nothing changed", async () => {
    await openSheet();
    await act(async () => noteCatalogPulled(db.name));
    expect(screen.queryByText(/Changed on another phone/)).toBeNull();
  });
});

describe("the note in हिन्दी and Hinglish", () => {
  it.each([
    ["hi", "दूसरे फ़ोन पर बदला गया: अब ₹60"],
    ["hl", "Dusre phone par badla gaya: ab ₹60"],
  ] as const)("%s", async (lang, text) => {
    setScreenLanguage(lang);
    await open();
    fireEvent.click(within(row("Sugar")).getAllByRole("button")[0]!); // the price button
    await pulled("p-sugar", { pricePaise: 6_000 });
    await screen.findByText(text);
  });
});
