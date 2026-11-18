// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KiranaBillDB, type LocalLearningEvent, type LocalShop, type LocalShopProduct } from "@/data/db";
import { BUILD_ID } from "@/pwa/buildId";
import type { SyncChip, Unsynced } from "./syncChip";
import { TabFrame } from "./AppTabs";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";

// KB-414 step 4 (owner + reviewer, 18 Nov 2026; the approved plan, all 4 defaults): More (17) and its inner pages. The look from the
// design files, the content from the app: the shop card -> Edit shop details (today's name + phone form); Printer (Android app only) ->
// today's printer section; Bill design (21) -> a live receipt preview, the receipt language and the item-names row; Items & prices ->
// the Items tab; App language (3 choices); Sync -> the phone's real sync state; Privacy -> /privacy; Developer -> today's developer
// section; Sign out with today's warning; the version under it. Help & support and account deletion stay out (SG-27, KB-430).
// Every inner page hides the nav; Back (arrow or Android) goes one level at a time. Everything is read from the phone (cold start).

const env = vi.hoisted(() => ({ native: false }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));

import { MoreScreen } from "./MoreScreen";

const shopId = "11111111-1111-4111-8111-111111111111";
const deviceId = "22222222-2222-4222-8222-222222222222";
let db: KiranaBillDB;
let online = true;

const shop = (over: Partial<LocalShop> = {}): LocalShop => ({
  id: shopId, syncStatus: "synced", name: "Gupta Kirana Store", phone: "9876543210", address: null, logoUrl: null, catalogMode: "custom_only",
  billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-18T10:00:00.000000+00:00", ...over,
});
const product = (p: Partial<LocalShopProduct> & Pick<LocalShopProduct, "displayName" | "id">): LocalShopProduct => ({
  shopId, baseProductId: null, category: null, unit: "kg", pricePaise: 4_000, aliases: [], source: "custom", useCount: 0, sku: null, barcode: null, isActive: true, ...p,
});
let n = 0;
const confirm = (alias: string, productId: string): LocalLearningEvent => ({
  localId: `e${n++}`, shopId, syncStatus: "synced", billLocalId: "", eventType: "alias_confirmed", payload: { alias, shop_product_id: productId, source_layer: "fastpath" },
  createdAt: new Date(Date.now() - 1000 * (50 - n)).toISOString(), updatedAt: new Date().toISOString(), deviceId,
});

const SYNCED = { chip: null as SyncChip | null, unsynced: { pending: 0, conflict: 0 } as Unsynced, detail: { pending: 0, conflict: 0, lastAttemptAt: null as string | null } };

beforeEach(async () => {
  env.native = false;
  online = true;
  vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
  stubLocalStorage();
  db = new KiranaBillDB(`ui-more17-${crypto.randomUUID()}`);
  await db.shops.put(shop());
  await db.shopProducts.bulkPut([
    product({ displayName: "चीनी", id: "sugar" }),
    product({ displayName: "चावल", id: "rice" }),
    product({ displayName: "टाटा नमक", id: "salt", unit: "piece" }),
    product({ displayName: "Old Soap", id: "soap", isActive: false }),
  ]);
  await db.learningEvents.bulkAdd([confirm("cheeni", "sugar"), confirm("cheeni", "sugar"), confirm("cheeni", "sugar"), confirm("chaawal", "rice")]);
});
afterEach(async () => {
  cleanup();
  act(() => setScreenLanguage("en"));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  db.close();
  await db.delete();
  await new Promise((r) => setTimeout(r, 30));
});

async function open(over: Partial<{ sync: typeof SYNCED; billInProgress: boolean }> = {}) {
  const on = { signOut: vi.fn(), items: vi.fn(), close: vi.fn() };
  render(
    <TabFrame tab="more" onTab={() => {}} offline={false}>
      <MoreScreen
        localDb={db}
        shopId={shopId}
        deviceId={deviceId}
        sync={over.sync ?? SYNCED}
        billInProgress={over.billInProgress ?? false}
        onSignOut={on.signOut}
        onItems={on.items}
        onClose={on.close}
      />
    </TabFrame>,
  );
  await screen.findByRole("button", { name: /Gupta Kirana Store/ });
  return on;
}
const nav = () => screen.queryByRole("navigation", { name: "Main" });
const row = (name: RegExp) => screen.getByRole("button", { name });
const androidBack = async () =>
  act(async () => {
    window.history.back();
    await new Promise((r) => setTimeout(r, 40));
  });

describe("17 More: the page", () => {
  it("the title, the shop card, Billing and App groups with today's rows, Sign out and the version - in the design's order", async () => {
    await open();
    const order = [
      screen.getByRole("heading", { level: 1, name: "More" }),
      row(/Gupta Kirana Store/),
      screen.getByText("Billing"),
      row(/^Bill design/),
      await screen.findByRole("button", { name: /^Items & prices.*3 items · 2 learned names/ }),
      screen.getByText("App"),
      row(/^App language/),
      row(/^Sync/),
      screen.getByRole("link", { name: /^Privacy/ }),
      row(/^Developer/),
      screen.getByRole("button", { name: "Sign out" }),
      screen.getByText(`Version ${BUILD_ID}`),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING, `${i}`).toBeTruthy();
    expect(row(/Gupta Kirana Store/).textContent).toContain("98765 43210 · Edit shop details");
    expect(row(/^Bill design/).textContent).toContain("Receipt in English");
    expect(row(/^App language/).textContent).toContain("English");
    expect(row(/^Sync/).textContent).toContain("Synced");
    expect(nav()).toBeTruthy(); // More is a tab: the nav shows
  });

  it("left out, as planned: Help & support (SG-27), account deletion (KB-430); no back arrow on the tab", async () => {
    await open();
    expect(screen.queryByText(/Help/)).toBeNull();
    expect(screen.queryByText(/Delete|deletion/i)).toBeNull();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
  });

  it("no phone saved: the card says only 'Edit shop details'", async () => {
    await db.shops.put(shop({ phone: null }));
    await open();
    expect(row(/Gupta Kirana Store/).textContent).toBe("Gupta Kirana StoreEdit shop details");
  });

  it("Printer is a row only inside the Android app, with the saved printer's name - or 'No printer chosen'", async () => {
    await open();
    expect(screen.queryByRole("button", { name: /^Printer/ })).toBeNull();
    cleanup();
    env.native = true;
    await open();
    expect(row(/^Printer/).textContent).toContain("No printer chosen");
    cleanup();
    localStorage.setItem("kb.printer.v1", JSON.stringify({ device: { id: "AA", name: "BT-SRT-58", kind: "classic", printerLike: true }, dots: 384, compat: false }));
    await open();
    expect(row(/^Printer/).textContent).toContain("BT-SRT-58");
  });

  it("Items & prices opens the Items tab", async () => {
    const on = await open();
    fireEvent.click(await screen.findByRole("button", { name: /^Items & prices/ }));
    expect(on.items).toHaveBeenCalledOnce();
  });

  it("Privacy is a link to /privacy in a new tab", async () => {
    await open();
    const link = screen.getByRole("link", { name: /^Privacy/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
  });

  it("a rename that lands while More is open shows at once", async () => {
    await open();
    await db.shops.update(shopId, { name: "Gupta General Store" });
    await waitFor(() => expect(row(/Gupta General Store/)).toBeTruthy());
  });
});

describe("17 More: Sync with the phone's real state", () => {
  const states: [string, typeof SYNCED][] = [
    ["Synced", SYNCED],
    ["Offline", { ...SYNCED, chip: { kind: "offline", label: "Offline" } }],
    ["Sync failing", { chip: { kind: "failing", label: "Sync failing" }, unsynced: { pending: 2, conflict: 1 }, detail: { pending: 2, conflict: 1, lastAttemptAt: "2026-11-18T09:05:00.000Z" } }],
    ["Syncing…", { chip: { kind: "syncing", label: "Syncing…" }, unsynced: { pending: 1, conflict: 0 }, detail: { pending: 1, conflict: 0, lastAttemptAt: null } }],
    ["Not syncing — sign in again", { ...SYNCED, chip: { kind: "nosession", label: "Not syncing — sign in again" } }],
    ["2 bills waiting to sync", { chip: null, unsynced: { pending: 2, conflict: 0 }, detail: { pending: 2, conflict: 0, lastAttemptAt: null } }],
  ];
  for (const [label, sync] of states)
    it(`the row says "${label}"`, async () => {
      await open({ sync });
      expect(row(/^Sync/).textContent).toBe(`Sync${label}`);
    });

  it("the Sync page: the state, what is waiting or stuck, the last try, and that billing continues", async () => {
    await open({ sync: states[2]![1] });
    fireEvent.click(row(/^Sync/));
    const page = screen.getByRole("region", { name: "Sync" });
    expect(page.textContent).toContain("Sync failing");
    expect(page.textContent).toContain("2 bills haven't reached the server yet.");
    expect(page.textContent).toContain("1 bill couldn't be saved to the server. It stays on this phone.");
    expect(page.textContent).toMatch(/Last tried at \d+:\d\d (AM|PM)\./);
    expect(page.textContent).toContain("Billing continues.");
  });

  it("synced: the page says so and nothing more", async () => {
    await open();
    fireEvent.click(row(/^Sync/));
    expect(screen.getByRole("region", { name: "Sync" }).textContent).toBe("SyncSynced");
  });
});

describe("17 More: Sign out keeps today's warning", () => {
  it("nothing waiting: signs out at once", async () => {
    const on = await open();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(on.signOut).toHaveBeenCalledOnce();
  });

  it("bills not on the server: asks first with the counts and the bill in progress; Cancel keeps, 'Sign out anyway' signs out", async () => {
    const on = await open({ sync: { chip: null, unsynced: { pending: 2, conflict: 0 }, detail: { pending: 2, conflict: 0, lastAttemptAt: null } }, billInProgress: true });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sign out?" });
    expect(dialog.textContent).toContain("2 bills haven't reached the server yet");
    expect(dialog.textContent).toContain("Your bill in progress stays on this phone too.");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(on.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out anyway" }));
    expect(on.signOut).toHaveBeenCalledOnce();
  });
});

describe("17 More: inner pages hide the nav; Back goes one level at a time", () => {
  const pages: [RegExp, string][] = [
    [/Gupta Kirana Store/, "Edit shop details"],
    [/^Printer/, "Printer"],
    [/^Bill design/, "Bill design"],
    [/^App language/, "App language"],
    [/^Sync/, "Sync"],
    [/^Developer/, "Developer"],
  ];
  for (const [rowName, title] of pages) {
    it(`${title}: no nav while open; the arrow goes back to More`, async () => {
      env.native = true;
      const on = await open();
      fireEvent.click(row(rowName));
      expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
      expect(nav()).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeTruthy());
      expect(nav()).toBeTruthy();
      expect(on.close).not.toHaveBeenCalled();
    });

    it(`${title}: Android Back closes the page, then the next Back leaves More`, async () => {
      env.native = true;
      const on = await open();
      fireEvent.click(row(rowName));
      await androidBack();
      expect(screen.queryByRole("heading", { level: 1, name: title })).toBeNull();
      expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeTruthy();
      expect(on.close).not.toHaveBeenCalled();
      await androidBack();
      expect(on.close).toHaveBeenCalledOnce();
    });
  }

  it("Sign out's warning open: Android Back closes the warning only", async () => {
    const on = await open({ sync: { chip: null, unsynced: { pending: 1, conflict: 0 }, detail: { pending: 1, conflict: 0, lastAttemptAt: null } } });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(nav()).toBeNull();
    await androidBack();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeTruthy();
    expect(on.close).not.toHaveBeenCalled();
    expect(on.signOut).not.toHaveBeenCalled();
  });

  it("Developer's Reset question open: Android Back leaves the page (the question is part of it), never More", async () => {
    const on = await open();
    fireEvent.click(row(/^Developer/));
    fireEvent.click(await screen.findByRole("button", { name: "Reset learning" }));
    await androidBack();
    expect(screen.getByRole("heading", { level: 1, name: "More" })).toBeTruthy();
    expect(on.close).not.toHaveBeenCalled();
  });
});

describe("21 Bill design", () => {
  it("a live receipt preview with the shop's name and phone; the receipt language changes it at once and is saved", async () => {
    await open();
    fireEvent.click(row(/^Bill design/));
    const preview = screen.getByRole("figure", { name: "Receipt preview" });
    expect(preview.textContent).toContain("Gupta Kirana Store");
    expect(preview.textContent).toContain("98765 43210");
    expect(preview.textContent).toContain("TOTAL");
    const group = screen.getByRole("radiogroup", { name: "Receipt language" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["English", "हिन्दी", "Both"]);
    expect(within(group).getByRole("radio", { name: "English" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(within(group).getByRole("radio", { name: "हिन्दी" }));
    await waitFor(async () => expect(await db.shops.get(shopId)).toMatchObject({ billLanguage: "hi", syncStatus: "pending" }));
    await waitFor(() => expect(screen.getByRole("figure", { name: "Receipt preview" }).textContent).toContain("कुल"));
    expect(screen.getByText(/A receipt opened from History shows today's shop name, phone and language/)).toBeTruthy();
  });

  it("'Item names on bill' says the truth (a fixed row, no choice): voice orders the name said, Add item the items' name", async () => {
    await open();
    fireEvent.click(row(/^Bill design/));
    const names = screen.getByRole("group", { name: "Item names on bill" });
    expect(names.textContent).toContain("As you said them");
    expect(names.textContent).toContain("Voice orders print the name you said. Items you add by hand print the name from your items.");
    expect(within(names).queryByRole("button")).toBeNull();
  });

  it("left out until KB-422: address, thank-you note, show phone; no Save button (the one choice saves at once)", async () => {
    await open();
    fireEvent.click(row(/^Bill design/));
    expect(screen.queryByText(/Address/)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull(); // no name / address / thank-you note fields (the receipt keeps today's "Thank You!")
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});

describe("App language", () => {
  it("three choices, never translated; a choice changes the app at once and stays on the page", async () => {
    await open();
    fireEvent.click(row(/^App language/));
    const group = screen.getByRole("radiogroup", { name: "App language" });
    expect(within(group).getAllByRole("radio").map((r) => r.textContent)).toEqual(["English", "हिन्दी", "Hinglish"]);
    fireEvent.click(within(group).getByRole("radio", { name: "हिन्दी" }));
    expect(screen.getByRole("heading", { level: 1, name: "ऐप की भाषा" })).toBeTruthy();
    expect(within(screen.getByRole("radiogroup")).getAllByRole("radio").map((r) => r.textContent)).toEqual(["English", "हिन्दी", "Hinglish"]);
    expect(within(screen.getByRole("radiogroup")).getByRole("radio", { name: "हिन्दी" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("3 languages", () => {
  for (const [lang, title, rows] of [
    ["hi", "और", ["बिल का डिज़ाइन", "सामान और भाव", "ऐप की भाषा", "सिंक", "गोपनीयता", "साइन आउट", "दुकान की जानकारी बदलें"]],
    ["hl", "Aur", ["Bill ka design", "Saamaan aur bhav", "App ki bhasha", "Sync", "Privacy", "Sign out", "Dukaan ki jaankari badlein"]],
  ] as const)
    it(`${lang}: the page in that language`, async () => {
      act(() => setScreenLanguage(lang));
      await open();
      expect(screen.getByRole("heading", { level: 1, name: title })).toBeTruthy();
      for (const r of rows) expect(screen.getAllByText(new RegExp(r)).length, r).toBeGreaterThan(0);
    });
});

describe("cold start: everything read from the phone, offline", () => {
  it("shop details, receipt language, app language and the printer come back after a restart with no network", async () => {
    online = false;
    env.native = true;
    await db.shops.put(shop({ name: "Sharma Kirana", phone: "9123456789", billLanguage: "both" }));
    localStorage.setItem("kb.printer.v1", JSON.stringify({ device: { id: "CC", name: "KP307-UEWB", kind: "classic", printerLike: true }, dots: 576, compat: true }));
    localStorage.setItem("kb.screenLanguage", "hl");
    act(() => setScreenLanguage("hl"));
    render(
      <MoreScreen localDb={db} shopId={shopId} deviceId={deviceId} sync={{ ...SYNCED, chip: { kind: "offline", label: "Offline" } }} billInProgress={false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} />,
    );
    const card = await screen.findByRole("button", { name: /Sharma Kirana/ });
    expect(card.textContent).toContain("91234 56789");
    expect(row(/^Bill ka design/).textContent).toContain("English + हिन्दी");
    expect(row(/^App ki bhasha/).textContent).toContain("Hinglish");
    expect(row(/^Printer/).textContent).toContain("KP307-UEWB");
    expect(row(/^Sync/).textContent).toContain("Offline");
    fireEvent.click(card);
    expect(((await screen.findByRole("textbox", { name: "Dukaan ka naam" })) as HTMLInputElement).value).toBe("Sharma Kirana");
    fireEvent.click(screen.getByRole("button", { name: "Wapas" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Printer/ }));
    expect(within(screen.getByRole("region", { name: "Printer" })).getByText("KP307-UEWB")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "80 mm (3 inch)" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
  });
});
