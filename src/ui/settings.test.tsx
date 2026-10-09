// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalShop, type LocalShopProduct } from "@/data/db";
import { DeviceDB } from "@/data/device";
import { requestPersistentStorage } from "@/data/storagePersist";
import { BUILD_ID } from "@/pwa/buildId";
import { BillView } from "./BillingScreen";
import { SettingsScreen } from "./SettingsScreen";

// KB-312 (owner, 8 Oct 2026): S7 Settings - shop name and phone, the customer's receipt language, and a
// collapsed Developer mode (learned aliases, provisional products, price suggestions, reset learning).
// A shop edit is local-first (works offline) and pushed by the ordinary sync (D64); the reset is local-only
// and says so (NI-27).

const shopId = "11111111-1111-4111-8111-111111111111";
const otherShopId = "99999999-9999-4999-8999-999999999999";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
let online = true;

const shop = (over: Partial<LocalShop> = {}): LocalShop => ({
  id: shopId, syncStatus: "synced", name: "Sharma Kirana", phone: null, address: "Gali 4", logoUrl: null, catalogMode: "custom_only",
  billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.123456+00:00", ...over,
});
const product = (displayName: string, over: Partial<LocalShopProduct> = {}): LocalShopProduct => ({
  id: crypto.randomUUID(), shopId, baseProductId: null, displayName, category: null, unit: "kg", pricePaise: 4_800, aliases: [displayName],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...over,
});
const sugar = product("Sugar");
const now = "2026-10-08T10:00:00.000Z";

beforeEach(async () => {
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  db = new KiranaBillDB(`ui-settings-${crypto.randomUUID()}`);
  await db.shops.put(shop());
  await db.shopProducts.put(sugar);
});
afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  db.close();
  await db.delete();
});

async function open(onClose = vi.fn()) {
  render(<SettingsScreen localDb={db} shopId={shopId} deviceId={deviceId} onClose={onClose} />);
  await screen.findByRole("textbox", { name: "Shop name" });
  return { onClose };
}
const nameBox = () => screen.getByRole("textbox", { name: "Shop name" }) as HTMLInputElement;
const phoneBox = () => screen.getByRole("textbox", { name: "Shop phone" }) as HTMLInputElement;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const save = () => fireEvent.click(screen.getByRole("button", { name: "Save" }));
const row = () => db.shops.get(shopId);

async function seedLearning() {
  await db.learnedAliases.bulkPut([
    { localId: "la1", shopId, syncStatus: "synced", alias: "chini", shopProductId: sugar.id, hitCount: 3, confidence: 0.8, source: "correction", updatedAt: now, deviceId },
    { localId: "la2", shopId, syncStatus: "synced", alias: "cheeni", shopProductId: sugar.id, hitCount: 1, confidence: 0.5, source: "confirmation", updatedAt: now, deviceId },
    { localId: "la-other", shopId: otherShopId, syncStatus: "synced", alias: "other", shopProductId: "x", hitCount: 1, confidence: 0.5, source: "confirmation", updatedAt: now, deviceId },
  ]);
  await db.provisionalProducts.bulkPut([
    { localId: "pp1", shopId, syncStatus: "synced", spokenName: "kurkure", seenCount: 2, suggestedUnit: null, suggestedPricePaise: 1000, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId },
    { localId: "pp-other", shopId: otherShopId, syncStatus: "synced", spokenName: "other", seenCount: 1, suggestedUnit: null, suggestedPricePaise: null, promotedAt: null, promotedShopProductId: null, updatedAt: now, deviceId },
  ]);
  const at = new Date().toISOString();
  await db.priceObservations.bulkPut([
    ...[1, 2, 3].map((i) => ({ localId: `po${i}`, shopId, syncStatus: "synced" as const, shopProductId: sugar.id, observedPricePaise: 5_500, occurredAt: at, updatedAt: at, deviceId })),
    { localId: "po-other", shopId: otherShopId, syncStatus: "synced" as const, shopProductId: "x", observedPricePaise: 100, occurredAt: at, updatedAt: at, deviceId },
  ]);
}
const openDeveloper = async () => {
  const section = screen.getByText("Developer mode").closest("details")!;
  section.open = true;
  fireEvent(section, new Event("toggle"));
  return section;
};

describe("KB-312 - S7 Settings", () => {
  it("the ≡ menu has Settings", () => {
    const onOpenSettings = vi.fn();
    render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onOpenSettings={onOpenSettings} />);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("shows the shop's name, phone and receipt language; Back closes it", async () => {
    await db.shops.put(shop({ phone: "9876543210", billLanguage: "hi" }));
    const { onClose } = await open();
    expect(nameBox().value).toBe("Sharma Kirana");
    expect(phoneBox().value).toBe("98765 43210");
    expect((screen.getByRole("radio", { name: "हिन्दी" }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("Save does nothing until something changed", async () => {
    await open();
    expect(screen.getByRole("button", { name: "Save" }).getAttribute("aria-disabled")).toBe("true");
    save();
    expect((await row())?.syncStatus).toBe("synced");
  });

  it("an empty name is refused with the reason - nothing is saved", async () => {
    await open();
    type(nameBox(), "   ");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("Shop name is required.");
    expect(await row()).toEqual(shop());
  });

  it("a phone that isn't a 10-digit mobile is refused - including a landline with an STD code (NI-39)", async () => {
    await open();
    type(phoneBox(), "12345");
    save();
    expect((await screen.findByRole("alert")).textContent).toBe("Enter a 10-digit mobile number");
    type(phoneBox(), "0712-2345678");
    save();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("without a leading 0"));
    expect(await row()).toEqual(shop());
  });

  it("a valid save is written locally as pending (the sync loop pushes it) and says so", async () => {
    await open();
    type(nameBox(), "  Gupta   Store ");
    type(phoneBox(), "98765 43210");
    save();
    await screen.findByText("Saved");
    expect(await row()).toMatchObject({ name: "Gupta Store", phone: "9876543210", syncStatus: "pending", billLanguage: "en", address: "Gali 4", receiptPrefix: "KB" });
    expect((await row())!.updatedAt).not.toBe(shop().updatedAt);
    expect(phoneBox().value).toBe("98765 43210");
  });

  it("offline, the save still works and says it will sync later", async () => {
    online = false;
    await open();
    type(nameBox(), "Gupta Store");
    save();
    await screen.findByText("Saved on this phone — it will sync when you're online");
    expect(await row()).toMatchObject({ name: "Gupta Store", syncStatus: "pending" });
  });

  it("choosing a receipt language saves at once, through the same path", async () => {
    await open();
    fireEvent.click(screen.getByRole("radio", { name: "हिन्दी" }));
    await waitFor(async () => expect(await row()).toMatchObject({ billLanguage: "hi", syncStatus: "pending" }));
    fireEvent.click(screen.getByRole("radio", { name: "Both" }));
    await waitFor(async () => expect((await row())?.billLanguage).toBe("both"));
  });

  it("an edit that arrives from the server while Settings is open shows up - unless the shopkeeper is typing in that field", async () => {
    await open();
    await db.shops.update(shopId, { name: "Edited Elsewhere", billLanguage: "hi", updatedAt: "2026-10-08T11:00:00.000000+00:00" }); // a pull landed
    await waitFor(() => expect(nameBox().value).toBe("Edited Elsewhere"));
    expect((screen.getByRole("radio", { name: "हिन्दी" }) as HTMLInputElement).checked).toBe(true);
    type(phoneBox(), "98765"); // mid-typing
    await db.shops.update(shopId, { name: "Edited Again", phone: "9123456789", updatedAt: "2026-10-08T12:00:00.000000+00:00" });
    await waitFor(() => expect(nameBox().value).toBe("Edited Again")); // the untouched field follows
    expect(phoneBox().value).toBe("98765"); // the one being typed stays
  });

  it("says plainly that a reopened receipt shows today's name, phone and language (owner Q4)", async () => {
    await open();
    expect(screen.getByText(/A receipt opened from History shows today's shop name, phone and language/)).toBeTruthy();
  });
});

describe("KB-312 - Developer mode", () => {
  it("is collapsed by default, and shows this shop's learning when opened: aliases, provisional products, price suggestions - read-only", async () => {
    await seedLearning();
    await open();
    expect((screen.getByText("Developer mode").closest("details") as HTMLDetailsElement).open).toBe(false);
    const section = await openDeveloper();
    const dev = within(section);
    expect((await dev.findByText(/chini → Sugar/)).textContent).toContain("seen 3 times");
    expect(dev.getByText(/chini → Sugar/).textContent).toContain("80%");
    expect(dev.getByText(/cheeni → Sugar/)).toBeTruthy();
    expect(dev.queryByText(/other/)).toBeNull(); // another shop's learning never shows
    expect(dev.getByText(/“kurkure” — said 2 times/)).toBeTruthy();
    expect(dev.getByText("Sugar: ₹55 / kg on 3 bills (now ₹48)")).toBeTruthy();
    expect(dev.getAllByRole("button").map((b) => b.textContent)).toEqual(["Reset learning"]); // nothing here applies anything
  });

  it("Reset learning asks first - the dialog says what is and is not cleared; Cancel changes nothing", async () => {
    await seedLearning();
    await open();
    const dev = within(await openDeveloper());
    await dev.findByText(/chini → Sugar/);
    fireEvent.click(dev.getByRole("button", { name: "Reset learning" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Reset learning?" });
    expect(dialog.textContent).toContain("Your bills and catalog are not touched");
    expect(dialog.textContent).toContain("The server keeps its copy");
    expect(await db.learnedAliases.count()).toBe(3);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(await db.learnedAliases.count()).toBe(3);
    expect(await db.learningEvents.count()).toBe(0);
  });

  it("confirming clears THIS shop's learning only, says the server's copy was not deleted, and records the reset event for the sync", async () => {
    await seedLearning();
    await open();
    const dev = within(await openDeveloper());
    await dev.findByText(/chini → Sugar/);
    fireEvent.click(dev.getByRole("button", { name: "Reset learning" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Clear learning on this phone" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Cleared on this phone: 2 learned aliases, 1 provisional products, 3 price records. The server's copy was not deleted.",
    );
    expect((await db.learnedAliases.toArray()).map((a) => a.localId)).toEqual(["la-other"]); // the other shop's row survives
    expect((await db.provisionalProducts.toArray()).map((p) => p.localId)).toEqual(["pp-other"]);
    expect((await db.priceObservations.toArray()).map((p) => p.localId)).toEqual(["po-other"]);
    const events = await db.learningEvents.toArray();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ shopId, eventType: "learning_reset", billLocalId: "", syncStatus: "pending", payload: { clearedCounts: { learnedAliases: 2, provisionalProducts: 1, priceObservations: 3 } } });
    expect(dev.queryByText(/chini → Sugar/)).toBeNull(); // the lists are empty now
  });

  it("with nothing learned it says so", async () => {
    await open();
    const dev = within(await openDeveloper());
    expect(await dev.findByText("Nothing learned on this phone yet.")).toBeTruthy();
  });
});

// KB-401 (D67, KI-68): which version this phone runs, and whether its storage is protected.
describe("KB-401 - version and storage", () => {
  it("shows the build id (support can see which version a phone has)", async () => {
    await open();
    expect(screen.getByText(`Version ${BUILD_ID}`)).toBeTruthy();
  });

  it("Developer mode says plainly whether the phone's storage is protected - never alarming", async () => {
    const deviceDb = new DeviceDB(`ui-settings-device-${crypto.randomUUID()}`);
    render(<SettingsScreen localDb={db} shopId={shopId} deviceId={deviceId} deviceDb={deviceDb} onClose={() => {}} />);
    await screen.findByRole("textbox", { name: "Shop name" });
    const dev = within(await openDeveloper());
    expect(await dev.findByText("Storage: not protected yet — install the app")).toBeTruthy();
    expect(dev.queryByRole("alert")).toBeNull();
    await requestPersistentStorage(deviceDb, { persisted: () => Promise.resolve(false), persist: () => Promise.resolve(true) });
    cleanup();
    render(<SettingsScreen localDb={db} shopId={shopId} deviceId={deviceId} deviceDb={deviceDb} onClose={() => {}} />);
    await screen.findByRole("textbox", { name: "Shop name" });
    expect(await within(await openDeveloper()).findByText("Storage: protected")).toBeTruthy();
    deviceDb.close();
  });

  it("without a device database there is no storage line", async () => {
    await open();
    const dev = within(await openDeveloper());
    await dev.findByText("Nothing learned on this phone yet.");
    expect(dev.queryByText(/Storage:/)).toBeNull();
  });
});
