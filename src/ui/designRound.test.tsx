// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { parseUtterance } from "@/domain/grammar";
import { KiranaBillDB, type LocalShopProduct } from "@/data/db";
import { BillView } from "./BillingScreen";
import { EditableValue } from "./EditableValue";
import { EditProductSheet } from "./EditProductSheet";
import { AddProductSheet } from "./AddProductSheet";
import { CancelBillSheet } from "./CancelBillSheet";
import { SettingsScreen } from "./SettingsScreen";
import { OnboardingScreen } from "./OnboardingScreen";
import { ShareBar } from "./ShareBar";
import { setScreenLanguage } from "./screenLanguage";
import { IDLE_VOICE } from "./useVoiceBilling";
import { UNDO_MS, useBillLines } from "./useBillLines";
import { stubLocalStorage } from "./testStorage";
import type { ReceiptShare } from "./useReceiptShare";

// KB-343 (owner, 19 Oct 2026; docs/21 Part 5 #13-#19): focus after Enter, "Discard changes?", a reason beside every
// disabled button, "Understanding…", the Undo strip, translated error messages, visible labels on the set-up fields.

vi.mock("@/providers/ShopProvider", () => ({ useShop: () => ({ createShop: async () => {} }) }));
stubLocalStorage();
afterEach(async () => {
  cleanup();
  setScreenLanguage("en");
  await new Promise((r) => setTimeout(r, 30));
});

// ---------------------------------------------------------------------------------------------------------------- #13
describe("#13 - after Enter in an inline editor, focus stays on that line's same value", () => {
  it("Enter commits and the value's own button has the focus", () => {
    render(<EditableValue label="Chini quantity" fieldId="q" text="1" initial="1" startOpen onCommit={() => null} />);
    const input = screen.getByRole("textbox", { name: "Chini quantity" });
    fireEvent.change(input, { target: { value: "2" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Chini quantity" }));
  });

  it("tapping away (blur) commits but does NOT pull the focus back", () => {
    render(
      <>
        <EditableValue label="Chini quantity" fieldId="q" text="1" initial="1" startOpen onCommit={() => null} />
        <button type="button">Elsewhere</button>
      </>,
    );
    const input = screen.getByRole("textbox", { name: "Chini quantity" });
    fireEvent.change(input, { target: { value: "2" } });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    fireEvent.blur(input);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(elsewhere);
  });

  it("a refused value keeps the editor open and focused", () => {
    render(<EditableValue label="Chini quantity" fieldId="q" text="1" initial="1" startOpen onCommit={() => "Enter a quantity like 2 or 0.5"} />);
    const input = screen.getByRole("textbox", { name: "Chini quantity" });
    fireEvent.change(input, { target: { value: "abc" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("textbox", { name: "Chini quantity" })).toBe(input);
    expect(screen.getByRole("alert").textContent).toContain("Enter a quantity");
  });
});

// ---------------------------------------------------------------------------------------------------------------- #14
const product = (displayName: string): LocalShopProduct => ({
  id: crypto.randomUUID(), shopId: "s", baseProductId: null, displayName, category: null, unit: "kg", pricePaise: 4_800, aliases: [displayName],
  source: "custom", useCount: 0, sku: null, barcode: null, isActive: true,
});
const okWrite = async () => ({ ok: true as const });

describe("#14 - Back / Escape with typed changes asks 'Discard changes?'; with none it just closes (Catalog sheets only)", () => {
  const dialog = () => screen.queryByRole("alertdialog", { name: "Discard changes?" });
  const settle = () => new Promise((r) => setTimeout(r, 40));

  it("Edit product, no change: the Back arrow and Escape close at once", () => {
    const close = vi.fn();
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(close).toHaveBeenCalledTimes(1);
    expect(dialog()).toBeNull();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("Edit product, a typed change: the Back arrow asks; Cancel keeps the sheet and the text; Discard closes", () => {
    const close = vi.fn();
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={close} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sugar Fine" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(dialog()).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" })); // the safe one
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dialog()).toBeNull();
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Sugar Fine");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Escape asks too (and Escape on the question keeps editing)", () => {
    const close = vi.fn();
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={close} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sugar Fine" } });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).not.toBeNull();
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(dialog()).toBeNull();
    expect(close).not.toHaveBeenCalled();
  });

  it("Android Back asks too - and the sheet still has its history entry afterwards (a second Back asks again)", async () => {
    const close = vi.fn();
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={close} />);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sugar Fine" } });
    act(() => window.history.back());
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(close).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" })); // keep editing
    await settle();
    expect(typeof window.history.state?.kbEditProduct).toBe("string"); // the entry Back took was put straight back
    act(() => window.history.back());
    await waitFor(() => expect(dialog()).not.toBeNull());
    expect(close).not.toHaveBeenCalled();
  });

  it("Add product: nothing typed closes at once; anything typed asks", () => {
    const close = vi.fn();
    render(<AddProductSheet existing={[]} online onCreate={okWrite} onClose={close} />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Besan" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(dialog()).not.toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(close).toHaveBeenCalledTimes(2);
  });

  it("Add product: a typed price alone, or a typed unit alone, counts as a change", () => {
    for (const label of [/^price/i, /^unit$/i]) {
      const { unmount } = render(<AddProductSheet existing={[]} online onCreate={okWrite} onClose={() => {}} />);
      fireEvent.change(screen.getByLabelText(label), { target: { value: "12" } });
      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(dialog(), String(label)).not.toBeNull();
      unmount();
    }
  });

  it("Edit product: a typed change to 'Other names' alone counts as a change", () => {
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Other names"), { target: { value: "Sugar, shakkar" } });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(dialog()).not.toBeNull();
  });

  it("हिन्दी: the question and its buttons are translated", () => {
    setScreenLanguage("hi");
    render(<AddProductSheet existing={[]} online onCreate={okWrite} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("नाम"), { target: { value: "Besan" } });
    fireEvent.click(screen.getByRole("button", { name: "वापस" }));
    expect(screen.getByRole("alertdialog", { name: "बदलाव छोड़ें?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "छोड़ दें" })).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------------------------------------------- #15
describe("#15 - every disabled button says why, in one short line", () => {
  const fakeShare = (ready: boolean): ReceiptShare => ({
    ready, smsText: "x", downloadImage() {}, downloadPdf() {}, whatsApp() {}, storedMobile: async () => null, sendSms() {},
  });

  it("Share: while the receipt files are being prepared", () => {
    const { rerender } = render(<ShareBar share={fakeShare(false)} />);
    expect(screen.getByText("Preparing the receipt…")).toBeTruthy();
    rerender(<ShareBar share={fakeShare(true)} />);
    expect(screen.queryByText("Preparing the receipt…")).toBeNull();
  });

  it("SMS Send: with no number it says to enter one; a valid number removes the line", async () => {
    render(<ShareBar share={fakeShare(true)} />);
    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    expect(screen.getByText("Enter the 10-digit mobile number to send")).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/mobile/i), { target: { value: "9876543210" } });
    expect(screen.queryByText("Enter the 10-digit mobile number to send")).toBeNull();
  });

  it("Cancel bill: 'Cancel and make a new bill' / 'Cancel only' say to choose a reason first", () => {
    render(<CancelBillSheet receiptNumber="59" billInProgress={false} onCancel={async () => null} onClose={() => {}} />);
    expect(screen.getByText("Choose a reason first")).toBeTruthy();
    fireEvent.click(screen.getByText("Wrong item"));
    expect(screen.queryByText("Choose a reason first")).toBeNull();
  });

  it("Edit product Save: 'No changes to save yet' until something changes", () => {
    render(<EditProductSheet product={product("Sugar")} others={[]} online onSave={okWrite} onClose={() => {}} />);
    expect(screen.getByText("No changes to save yet")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Sugar Fine" } });
    expect(screen.queryByText("No changes to save yet")).toBeNull();
  });

  it("Bill Banao on an empty bill: 'Add an item first'", () => {
    const { rerender } = render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onFinalise={() => {}} />);
    expect(screen.getByText("Add an item first")).toBeTruthy();
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    rerender(
      <BillView
        lines={items.map((item, i) => ({ id: `l${i}`, item, displayName: "Chini", source: "fastpath" as const, utteranceId: 1, original: item }))}
        onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onFinalise={() => {}}
      />,
    );
    expect(screen.queryByText("Add an item first")).toBeNull();
  });

  it("Bill Banao while the bill is being saved: 'Saving the bill…'", () => {
    const items = parseUtterance("2 kilo chini", SEED_PARSER_CATALOG)!;
    render(
      <BillView
        lines={items.map((item, i) => ({ id: `l${i}`, item, displayName: "Chini", source: "fastpath" as const, utteranceId: 1, original: item }))}
        onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onFinalise={() => {}} saving
      />,
    );
    expect(screen.getByText("Saving the bill…")).toBeTruthy();
  });

  it("the reasons are translated", () => {
    setScreenLanguage("hi");
    render(<CancelBillSheet receiptNumber="59" billInProgress={false} onCancel={async () => null} onClose={() => {}} />);
    expect(screen.getByText("पहले कारण चुनें")).toBeTruthy();
  });
});

describe("#15 - Settings Save says 'No changes to save yet' until the shop's details change", () => {
  let db: KiranaBillDB;
  beforeEach(async () => {
    db = new KiranaBillDB(`ui-round-${crypto.randomUUID()}`);
    await db.shops.put({ id: "s", syncStatus: "synced", name: "Sharma Kirana", phone: null, address: null, logoUrl: null, catalogMode: "base_imported", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-10-08T10:00:00.000Z" });
  });
  afterEach(async () => {
    db.close();
    await db.delete();
  });
  it("shows the reason, then drops it once the name is edited", async () => {
    render(<SettingsScreen localDb={db} shopId="s" deviceId="d" onClose={() => {}} />);
    const name = await screen.findByRole("textbox", { name: "Shop name" });
    expect(screen.getByText("No changes to save yet")).toBeTruthy();
    fireEvent.change(name, { target: { value: "Verma Store" } });
    expect(screen.queryByText("No changes to save yet")).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------- #16
describe("#16 - after the recording stops: 'Understanding…' until the result or the error arrives", () => {
  const view = (phase: "listening" | "transcribing" | "resolving") => (
    <BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} onMicTap={() => {}} voice={{ ...IDLE_VOICE, phase, transcript: phase === "listening" ? null : "do kilo chini" }} />
  );
  it("listening still says Listening…; transcribing and resolving say Understanding…, on the line and on the mic", () => {
    const { rerender } = render(view("listening"));
    expect(screen.getAllByText(/Listening…/).length).toBeGreaterThan(0);
    for (const phase of ["transcribing", "resolving"] as const) {
      rerender(view(phase));
      expect(screen.queryByText(/Listening…/), phase).toBeNull();
      expect(screen.getAllByText("Understanding…").length, phase).toBeGreaterThanOrEqual(2);
    }
  });
  it("in हिन्दी and Hinglish", () => {
    for (const [lang, word] of [["hi", "समझ रहे हैं…"], ["hl", "Samajh rahe hain…"]] as const) {
      setScreenLanguage(lang);
      const { unmount } = render(view("transcribing"));
      expect(screen.getAllByText(word).length, lang).toBeGreaterThan(0);
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------- #17
describe("#17 - the Undo strip stays until the next action, or 10 s", () => {
  const catalog = SEED_PARSER_CATALOG.entries;
  const line = (t: string) => parseUtterance(t, SEED_PARSER_CATALOG)!.map((item) => ({ item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));

  it("10 seconds", () => {
    expect(UNDO_MS).toBe(10_000);
  });

  it("it is still there after 9 s and gone after 10 s", () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBillLines(catalog));
      act(() => result.current.add(line("2 kilo chini"), [], "2 kilo chini"));
      act(() => result.current.remove(result.current.rows[0]!.id));
      expect(result.current.removed).not.toBeNull();
      act(() => void vi.advanceTimersByTime(9_000));
      expect(result.current.removed).not.toBeNull();
      act(() => void vi.advanceTimersByTime(1_100));
      expect(result.current.removed).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("the next action (another line added, a line edited, the customer changed) takes it away", () => {
    const { result } = renderHook(() => useBillLines(catalog));
    const removeOne = () => {
      act(() => result.current.add(line("2 kilo chini"), [], "2 kilo chini"));
      act(() => result.current.remove(result.current.rows[result.current.rows.length - 1]!.id));
      expect(result.current.removed).not.toBeNull();
    };
    removeOne();
    act(() => result.current.add(line("5 kg chawal 30 ka"), [], "5 kg chawal 30 ka"));
    expect(result.current.removed).toBeNull();
    removeOne();
    act(() => void result.current.edit(result.current.rows[0]!.id, "qty", "3"));
    expect(result.current.removed).toBeNull();
    removeOne();
    act(() => void result.current.setCustomerName("Ramesh"));
    expect(result.current.removed).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------------------------- #19
describe("#19 - the set-up fields have visible labels (the placeholders are examples)", () => {
  it("English: a label per field, each tied to its input; the placeholders are examples", () => {
    render(<OnboardingScreen />);
    const name = screen.getByLabelText("Shop name") as HTMLInputElement;
    const phone = screen.getByLabelText("Phone (optional)") as HTMLInputElement;
    expect(name.tagName).toBe("INPUT");
    expect(phone.tagName).toBe("INPUT");
    expect(name.placeholder).not.toBe("Shop name");
    expect(phone.placeholder).not.toBe("Phone (optional)");
    expect(name.closest("label")?.textContent).toContain("Shop name"); // visible text, not only an aria-label
    expect(phone.closest("label")?.textContent).toContain("Phone (optional)");
  });
  it("हिन्दी", () => {
    setScreenLanguage("hi");
    render(<OnboardingScreen />);
    expect(screen.getByLabelText("दुकान का नाम").closest("label")?.textContent).toContain("दुकान का नाम");
  });
});
