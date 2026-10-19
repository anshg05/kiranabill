// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { BillView } from "./BillingScreen";
import { IDLE_VOICE, type VoiceView } from "./useVoiceBilling";

// KB-342 (owner's screenshots): the ≡ menu stayed open over the Add item panel, after the mic, the mobile field or any
// tap elsewhere - it closed only when ≡ was tapped again. It now closes on an outside tap, on choosing an item, on
// Escape and Android Back, and whenever a panel, sheet, dialog or the mic opens; it never stacks above an open panel.

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 30)); // a closed overlay takes its history entry off on the next tick
});

const fns = { history: vi.fn(), catalog: vi.fn(), settings: vi.fn() };
function screenWith(voice: VoiceView = IDLE_VOICE) {
  return (
    <BillView
      lines={[]}
      onSignOut={() => {}}
      onEdit={() => null}
      onRemove={() => {}}
      voice={voice}
      onMicTap={() => {}}
      onOpenHistory={fns.history}
      onOpenCatalog={fns.catalog}
      onOpenSettings={fns.settings}
      catalog={SEED_PARSER_CATALOG}
      onAddByHand={() => {}}
      onCustomerName={() => null}
      onCustomerMobile={() => null}
    />
  );
}
const menuButton = () => screen.getByRole("button", { name: "Menu" });
const items = () => screen.queryAllByRole("button").filter((b) => ["History", "Catalog", "Settings", "Sign out"].includes(b.textContent ?? ""));
const openMenu = () => fireEvent.click(menuButton());
const expanded = () => menuButton().getAttribute("aria-expanded");

describe("KB-342 - the ≡ menu", () => {
  it("starts closed; ≡ opens it (aria-expanded true) and ≡ again closes it", () => {
    render(screenWith());
    expect(expanded()).toBe("false");
    expect(items()).toHaveLength(0);
    openMenu();
    expect(expanded()).toBe("true");
    expect(items().map((b) => b.textContent)).toEqual(["History", "Catalog", "Settings", "Sign out"]);
    openMenu();
    expect(expanded()).toBe("false");
    expect(items()).toHaveLength(0);
  });

  it("a tap outside closes it - on the page, the mic, the mobile field - and does not steal focus from what was tapped", () => {
    render(screenWith());
    for (const target of [document.body, screen.getByRole("button", { name: /Tap to speak/ }), screen.getByTestId("bill-total")]) {
      openMenu();
      expect(expanded()).toBe("true");
      fireEvent.pointerDown(target);
      expect(expanded(), "after a tap outside").toBe("false");
      expect(items()).toHaveLength(0);
    }
    openMenu();
    const mobile = screen.getByRole("button", { name: /Customer mobile|mobile/i });
    mobile.focus();
    fireEvent.pointerDown(mobile);
    expect(expanded()).toBe("false");
    expect(document.activeElement).toBe(mobile); // not pulled back to ≡
  });

  it("a tap INSIDE the menu does not close it by itself (only choosing an item does)", () => {
    render(screenWith());
    openMenu();
    fireEvent.pointerDown(items()[0]!);
    expect(expanded()).toBe("true");
  });

  it("choosing any item runs it, closes the menu and returns focus to ≡", () => {
    render(screenWith());
    for (const [name, fn] of [["History", fns.history], ["Catalog", fns.catalog], ["Settings", fns.settings]] as const) {
      openMenu();
      fireEvent.click(screen.getByRole("button", { name }));
      expect(fn).toHaveBeenCalledTimes(1);
      expect(expanded()).toBe("false");
      expect(items()).toHaveLength(0);
      expect(document.activeElement).toBe(menuButton());
    }
  });

  it("Escape closes it and focus returns to ≡", () => {
    render(screenWith());
    openMenu();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(expanded()).toBe("false");
    expect(document.activeElement).toBe(menuButton());
  });

  it("Android Back closes it (one history entry) and focus returns to ≡; closing normally leaves no entry behind", async () => {
    render(screenWith());
    openMenu();
    expect(typeof window.history.state?.kbMenu).toBe("string");
    act(() => window.history.back());
    await waitFor(() => expect(expanded()).toBe("false"));
    expect(document.activeElement).toBe(menuButton());
    openMenu();
    fireEvent.click(menuButton()); // closed by ≡: the entry must go too, so the next Back is not swallowed
    await new Promise((r) => setTimeout(r, 50));
    await waitFor(() => expect(window.history.state?.kbMenu).toBeUndefined());
  });

  it("when the Add item panel opens the menu closes - and with the panel open the menu cannot open above it", () => {
    render(screenWith());
    openMenu();
    act(() => screen.getByRole("button", { name: "Add item" }).click()); // no pointerdown: opened by script/keyboard
    expect(screen.getByRole("region", { name: "Add item" })).toBeTruthy();
    expect(expanded()).toBe("false");
    expect(items()).toHaveLength(0);
    openMenu();
    expect(items()).toHaveLength(0); // never stacks over an open panel
    expect(expanded()).toBe("false"); // and aria-expanded says so
  });

  it("when the mic starts the menu closes", () => {
    const { rerender } = render(screenWith());
    openMenu();
    expect(expanded()).toBe("true");
    rerender(screenWith({ ...IDLE_VOICE, phase: "listening" }));
    expect(expanded()).toBe("false");
    expect(items()).toHaveLength(0);
  });

  it("Sign out and Clear open their dialog and the menu is gone behind it", () => {
    render(
      <BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} unsynced={{ pending: 1, conflict: 0 }} />,
    );
    openMenu();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(expanded()).toBe("false");
  });
});
