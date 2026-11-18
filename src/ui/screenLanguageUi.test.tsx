// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { LANGUAGES, render as say, type Language } from "@/domain/messages";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";
import { SignInScreen } from "./SignInScreen";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";
import type { ShownFlag } from "./useBillLines";
import { SignOutButton } from "./OfflineUi";

vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

// KB-332 (D84), Checkpoint A: the screens seen on nearly every bill - billing, flags, voice messages, sync, sign-in - in the
// chosen language, switching live without a reload. Wording is read from the catalog (the owner reviews it on the real
// screens); what is proven here is that each screen USES it, that what must not change does not, and that numbers are
// identical in every language.

beforeEach(() => {
  stubLocalStorage();
});
afterEach(() => {
  cleanup();
  act(() => setScreenLanguage("en"));
  window.history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

const lines = (t = "2 kilo chini"): (BillLine & { id: string })[] =>
  parseUtterance(t, SEED_PARSER_CATALOG)!.map((item, i) => ({ id: `l${i}`, item, displayName: SEED_PARSER_CATALOG.byId.get(item.catalogId!)!.displayName, source: "fastpath" as const }));
const base = { lines: [] as (BillLine & { id: string })[], onEdit: () => null, onRemove: () => {} };
const highFlag = (message: string, code = "duplicate_line"): ShownFlag =>
  ({ id: "f1", code, severity: "HIGH", message, itemIndex: null, lineId: null, utteranceId: 1, anchorLineId: "l0", transcript: "do kilo chini", key: "k1", acknowledged: false }) as ShownFlag;
const use = (l: Language) => act(() => setScreenLanguage(l));

// ("the mic and the recording text" tested the OLD mic - deleted with the old voice path, 18 Nov 2026; V3's recorder screens have their own language tests)

describe("the bill screen", () => {
  it.each(LANGUAGES)("Back, Clear bill, headings, total, customer - in %s; Bill Banao never changes", (l) => {
    use(l);
    render(<BillView {...base} lines={lines()} onFinalise={() => {}} onBack={() => {}} onClearBill={() => {}} />);
    // KB-414 step 1: the ≡ menu is gone - Back (to Home) and Clear bill are on the bill; the rest is the bottom nav (appTabs.test)
    expect(screen.getByRole("button", { name: say("settings.back", {}, l) })).toBeTruthy();
    expect(screen.getByRole("button", { name: say("menu.clear", {}, l) })).toBeTruthy();
    expect(screen.getAllByText(say("bill.total", {}, l)).length).toBeGreaterThan(0);
    expect(screen.getByText(say("customer.label", {}, l))).toBeTruthy();
    // KB-413: no table headers on the phone layout (D110 8.11); a line's sheet labels its editors in the chosen language
    fireEvent.click(screen.getByRole("button", { name: say("catalog.editLabel", { name: "Chini" }, l) }));
    const sheet = within(screen.getByRole("dialog", { name: say("catalog.editLabel", { name: "Chini" }, l) }));
    for (const id of ["col.qty", "col.unit", "col.rate", "col.amount"] as const) expect(sheet.getByText(say(id, {}, l))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bill Banao" })).toBeTruthy();
    expect(screen.getByText("Cash")).toBeTruthy(); // the customer default is the English word on every screen
  });
  it("numbers and amounts are identical in every language", () => {
    const seen = LANGUAGES.map((l) => {
      use(l);
      const { unmount } = render(<BillView {...base} lines={lines()} />);
      fireEvent.click(screen.getByRole("button", { name: say("catalog.editLabel", { name: "Chini" }, l) })); // KB-413: the editors are in the sheet
      const t = [screen.getByTestId("bill-total").textContent, within(screen.getByRole("dialog")).getByRole("button", { name: say("line.quantity", { name: "Chini" }, l) }).textContent];
      unmount();
      return t;
    });
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(seen[0]![0]).toBe("₹90");
  });
  it("switching the language changes the open screen at once - no reload, no remount", () => {
    render(<BillView {...base} lines={lines()} catalog={SEED_PARSER_CATALOG} onAddByHand={() => {}} />);
    expect(screen.getByRole("button", { name: say("add.title", {}, "en") })).toBeTruthy();
    use("hi");
    expect(screen.getByRole("button", { name: say("add.title", {}, "hi") })).toBeTruthy();
    use("hl");
    expect(screen.getByRole("button", { name: say("add.title", {}, "hl") })).toBeTruthy();
    use("en");
    expect(screen.getByRole("button", { name: say("add.title", {}, "en") })).toBeTruthy();
  });
  it("a line's own controls carry the product name in the chosen language's sentence", () => {
    use("hi");
    render(<BillView {...base} lines={lines()} catalog={SEED_PARSER_CATALOG} onChangeProduct={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: say("catalog.editLabel", { name: "Chini" }, "hi") })); // KB-413: the line's sheet
    const sheet = within(screen.getByRole("dialog", { name: say("catalog.editLabel", { name: "Chini" }, "hi") }));
    expect(sheet.getByRole("button", { name: say("line.remove", { name: "Chini" }, "hi") })).toBeTruthy();
    expect(sheet.getByRole("button", { name: say("line.change", { name: "Chini" }, "hi") })).toBeTruthy();
  });
  it("saved strip and Undo", () => {
    use("hi");
    render(<BillView {...base} lines={lines()} saved={{ localId: "b", receiptNumber: "KB-000012", receipt: null } as never} removed={{ displayName: "Besan" }} onUndo={() => {}} />);
    expect(screen.getByRole("status", { name: say("bill.savedLabel", {}, "hi") }).textContent).toContain("KB-000012");
    expect(screen.getByRole("status", { name: say("bill.savedLabel", {}, "hi") }).textContent).toContain(say("bill.savedAfter", {}, "hi"));
  });
});

describe("flags: the sentence is translated, the buttons that must not change do not", () => {
  const english = 'Heard "5" but it doesn\'t appear on any line. Did you mean to add it?';
  it.each(LANGUAGES)("in %s", (l) => {
    use(l);
    render(<BillView {...base} lines={lines()} flags={[highFlag(english)]} pending={1} onAcknowledge={() => {}} onFinalise={() => {}} />);
    const sentence = screen.getAllByText((_, el) => el?.tagName === "SPAN" && el.textContent !== null && el.textContent.includes("5") && !!el.closest("[data-severity='HIGH']") && !el.classList.contains("sr-only")).map((e) => e.textContent)[0];
    expect(sentence).toBeTruthy();
    if (l === "en") expect(sentence).toBe(english);
    else expect(sentence).not.toBe(english);
    expect(sentence).toContain("5");
    expect(screen.getAllByRole("button", { name: /Theek hai/ }).length).toBeGreaterThan(0);
    expect(screen.getByText(say("checks.one", { n: 1 }, l))).toBeTruthy();
  });
  // KB-363b: a number reason is ONE short sentence, in the chosen language
  it.each(LANGUAGES)("the short number sentence in %s", (l) => {
    use(l);
    render(<BillView {...base} lines={lines()} flags={[highFlag(english, "number_dropped")]} pending={1} onAcknowledge={() => {}} onFinalise={() => {}} />);
    expect(screen.getAllByText(say("flag.checkLines", {}, l)).length).toBeGreaterThan(0);
    expect(screen.queryByText(english)).toBeNull();
  });
});

describe("sync chip and dialogs", () => {
  it.each(LANGUAGES)("the chip and its details - in %s", (l) => {
    use(l);
    render(<BillView {...base} syncChip={{ kind: "failing", label: "Sync failing" }} syncDetail={{ pending: 2, conflict: 0, lastAttemptAt: null }} />);
    const chip = screen.getByTestId("sync-chip");
    expect(chip.textContent).toBe(say("sync.failing", {}, l));
    fireEvent.click(chip);
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain(say("sync.pending.many", { n: 2 }, l));
    expect(dialog.textContent).toContain(say("sync.continues", {}, l));
  });
  it("the sign-out warning - title, line and buttons", () => {
    use("hi");
    render(<SignOutButton onSignOut={() => {}} billInProgress={false} unsynced={{ pending: 2, conflict: 0 }} />); // KB-414: on More
    fireEvent.click(screen.getByRole("button", { name: say("menu.signout", {}, "hi") }));
    const dialog = screen.getByRole("alertdialog", { name: say("signout.title", {}, "hi") });
    expect(dialog.textContent).toContain(say("signout.pending.many", { n: 2 }, "hi"));
    expect(within(dialog).getByRole("button", { name: say("signout.anyway", {}, "hi") })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: say("common.cancel", {}, "hi") })).toBeTruthy();
  });
});

describe("typing a value: the input error is translated", () => {
  it("a mobile number that is too short", () => {
    use("hi");
    render(<BillView {...base} lines={lines()} onCustomerName={() => null} onCustomerMobile={() => "Enter a 10-digit mobile number"} />);
    fireEvent.click(screen.getByRole("button", { name: say("customer.mobile", {}, "hi") }));
    const input = screen.getByRole("textbox", { name: say("customer.mobile", {}, "hi") });
    fireEvent.change(input, { target: { value: "98" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert").textContent).toBe(say("err.mobileDigits", {}, "hi"));
  });
});

describe("sign-in", () => {
  it.each(LANGUAGES)("the button and a refused return - in %s", (l) => {
    use(l);
    window.history.replaceState(null, "", "/?error=access_denied&error_code=signup_disabled");
    render(<SignInScreen />);
    expect(screen.getByRole("button", { name: say("signin.google", {}, l) })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(say("signin.refused", {}, l));
  });
});

describe("the Add item panel", () => {
  it("title, search, close and the new-product option - in हिन्दी", async () => {
    use("hi");
    render(<BillView {...base} lines={lines()} catalog={SEED_PARSER_CATALOG} onAddByHand={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(say("add.title", {}, "hi")) }));
    const panel = screen.getByRole("region", { name: say("add.title", {}, "hi") });
    const search = within(panel).getByRole("searchbox", { name: say("add.search", {}, "hi") });
    expect((search as HTMLInputElement).placeholder).toBe(say("add.placeholder", {}, "hi"));
    fireEvent.change(search, { target: { value: "zzzqq" } });
    expect(within(panel).getByRole("button", { name: say("add.new", { typed: "zzzqq" }, "hi") })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: say("add.close", {}, "hi") })).toBeTruthy();
  });
});
