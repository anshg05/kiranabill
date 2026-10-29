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
import type { VoiceView } from "./useVoiceBilling";
import { chooseMenu } from "./menuTestUtil";

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
const base = { lines: [] as (BillLine & { id: string })[], onSignOut: () => {}, onEdit: () => null, onRemove: () => {} };
const voice = (over: Partial<VoiceView> = {}): VoiceView => ({ phase: "idle", transcript: null, message: null, elapsedMs: 0, disabledReason: null, ...over });
const highFlag = (message: string, code = "duplicate_line"): ShownFlag =>
  ({ id: "f1", code, severity: "HIGH", message, itemIndex: null, lineId: null, utteranceId: 1, anchorLineId: "l0", transcript: "do kilo chini", key: "k1", acknowledged: false }) as ShownFlag;
const use = (l: Language) => act(() => setScreenLanguage(l));

describe("the mic and the recording text", () => {
  it.each(LANGUAGES)("idle, listening, reading - in %s (English mode is fully English; the Hindi wording is हिन्दी's)", (l) => {
    use(l);
    const { rerender } = render(<BillView {...base} voice={voice()} onMicTap={() => {}} />);
    expect(screen.getByRole("button", { name: say("mic.idle", {}, l) })).toBeTruthy();
    rerender(<BillView {...base} voice={voice({ phase: "listening", elapsedMs: 5000 })} onMicTap={() => {}} />);
    expect(screen.getByRole("button", { name: say("mic.stopLabel", {}, l) }).textContent).toContain(say("mic.stop", {}, l));
    expect(document.body.textContent).toContain(say("voice.listening", {}, l));
    rerender(<BillView {...base} voice={voice({ phase: "transcribing" })} onMicTap={() => {}} />);
    expect(document.body.textContent).toContain(say("voice.understanding", {}, l)); // KB-343
  });
  it("a failure message and its 'Add by hand' - in the chosen language, the heard words untouched", () => {
    use("hi");
    render(<BillView {...base} voice={voice({ phase: "failed", message: "Didn't catch anything — try again", transcript: "do kilo chini" })} onMicTap={() => {}} onAddByHand={() => {}} catalog={SEED_PARSER_CATALOG} />);
    expect(screen.getByRole("alert").textContent).toContain(say("voice.noSpeech", {}, "hi"));
    expect(screen.getByRole("alert").textContent).toContain(say("byhand.button", {}, "hi"));
    expect(screen.getByTestId("voice-transcript").textContent).toBe("“do kilo chini”");
  });
});

describe("the bill screen", () => {
  it.each(LANGUAGES)("menu, headings, total, customer - in %s; Bill Banao never changes", (l) => {
    use(l);
    render(<BillView {...base} lines={lines()} onFinalise={() => {}} onOpenCatalog={() => {}} onOpenSettings={() => {}} onOpenHistory={() => {}} onClearBill={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: say("menu.label", {}, l) })); // KB-342: the items exist while the menu is open
    for (const id of ["menu.history", "menu.catalog", "menu.settings", "menu.clear", "menu.signout"] as const) expect(screen.getAllByText(say(id, {}, l)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(say("bill.total", {}, l)).length).toBeGreaterThan(0);
    expect(screen.getByText(say("customer.label", {}, l))).toBeTruthy();
    const table = within(screen.getByRole("table"));
    for (const id of ["col.item", "col.qty", "col.unit", "col.rate", "col.amount"] as const) expect(table.getByText(say(id, {}, l))).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bill Banao" })).toBeTruthy();
    expect(screen.getByText("Cash")).toBeTruthy(); // the customer default is the English word on every screen
  });
  it("numbers and amounts are identical in every language", () => {
    const seen = LANGUAGES.map((l) => {
      use(l);
      const { unmount } = render(<BillView {...base} lines={lines()} />);
      const t = [screen.getByTestId("bill-total").textContent, within(screen.getByRole("table")).getByRole("button", { name: say("line.quantity", { name: "Chini" }, l) }).textContent];
      unmount();
      return t;
    });
    expect(seen[1]).toEqual(seen[0]);
    expect(seen[2]).toEqual(seen[0]);
    expect(seen[0]![0]).toBe("₹90");
  });
  it("switching the language changes the open screen at once - no reload, no remount", () => {
    render(<BillView {...base} lines={lines()} onMicTap={() => {}} voice={voice()} />);
    expect(screen.getByRole("button", { name: say("mic.idle", {}, "en") })).toBeTruthy();
    use("hi");
    expect(screen.getByRole("button", { name: say("mic.idle", {}, "hi") })).toBeTruthy();
    use("hl");
    expect(screen.getByRole("button", { name: say("mic.idle", {}, "hl") })).toBeTruthy();
    use("en");
    expect(screen.getByRole("button", { name: say("mic.idle", {}, "en") })).toBeTruthy();
  });
  it("a line's own controls carry the product name in the chosen language's sentence", () => {
    use("hi");
    render(<BillView {...base} lines={lines()} catalog={SEED_PARSER_CATALOG} onChangeProduct={() => {}} />);
    expect(screen.getAllByRole("button", { name: say("line.remove", { name: "Chini" }, "hi") }).length).toBeGreaterThan(0);
    expect(within(screen.getByRole("table")).getByRole("button", { name: say("line.change", { name: "Chini" }, "hi") })).toBeTruthy();
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
    const sentence = screen.getAllByText((_, el) => el?.tagName === "SPAN" && el.textContent !== null && el.textContent.includes("5") && el.className === "").map((e) => e.textContent)[0];
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
    render(<BillView {...base} unsynced={{ pending: 2, conflict: 0 }} />);
    chooseMenu(say("menu.signout", {}, "hi"));
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
