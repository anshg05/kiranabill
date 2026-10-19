// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BillView } from "./BillingScreen";
import { ConfirmDialog } from "./OfflineUi";
import { EditableValue } from "./EditableValue";
import { useBackEntry } from "./useBackEntry";
import { CancelBillSheet } from "./CancelBillSheet";
import { OnboardingScreen } from "./OnboardingScreen";

vi.mock("@/providers/ShopProvider", () => ({ useShop: () => ({ createShop: async () => {} }) }));

// KB-342: every overlay closes on Escape and Android Back (the top one only); a dialog is modal in fact - a tap on the
// dim backdrop cancels, focus goes in and stays in; the bill behind a full-screen overlay is inert.

afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 30));
});

function Sheet({ name, onClose, children }: { name: string; onClose: () => void; children?: React.ReactNode }) {
  useBackEntry(`kb${name}`, onClose);
  return <section aria-label={name}>{children}</section>;
}
const esc = (target: Element | Document = document) => fireEvent.keyDown(target, { key: "Escape" });

describe("Escape closes the TOP overlay only", () => {
  it("a sheet closes on Escape", () => {
    const close = vi.fn();
    render(<Sheet name="One" onClose={close} />);
    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("with two open (History > bill), Escape closes the upper one and not the lower", () => {
    const lower = vi.fn();
    const upper = vi.fn();
    const { rerender } = render(<Sheet name="Lower" onClose={lower} />);
    rerender(
      <Sheet name="Lower" onClose={lower}>
        <Sheet name="Upper" onClose={upper} />
      </Sheet>,
    ); // the upper one opens after the lower, as History > bill does
    esc();
    expect(upper).toHaveBeenCalledTimes(1);
    expect(lower).not.toHaveBeenCalled();
  });

  it("the Cancel-bill sheet closes on Escape", () => {
    const close = vi.fn();
    render(<CancelBillSheet receiptNumber="59" billInProgress={false} onCancel={async () => null} onClose={close} />);
    esc();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("an inline editor's own Escape cancels the edit and does NOT also close the overlay", () => {
    const close = vi.fn();
    render(
      <Sheet name="One" onClose={close}>
        <EditableValue label="Qty" fieldId="q" text="1" initial="1" startOpen onCommit={() => null} />
      </Sheet>,
    );
    esc(screen.getByRole("textbox", { name: "Qty" }));
    expect(screen.queryByRole("textbox", { name: "Qty" })).toBeNull(); // the edit closed
    expect(close).not.toHaveBeenCalled();
  });
});

describe("a confirmation dialog is modal in fact", () => {
  const dialog = (over: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(<ConfirmDialog title="Sign out?" lines={["x"]} confirmLabel="Sign out anyway" onCancel={onCancel} onConfirm={onConfirm} {...over} />);
    return { onCancel, onConfirm };
  };

  it("is aria-modal; focus starts on Cancel - never on the destructive button", () => {
    dialog();
    expect(screen.getByRole("alertdialog").getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
  });

  it("Escape cancels", () => {
    const { onCancel, onConfirm } = dialog();
    esc();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Android Back cancels", async () => {
    const { onCancel } = dialog();
    window.history.back();
    await new Promise((r) => setTimeout(r, 50));
    expect(onCancel).toHaveBeenCalled();
  });

  it("a tap on the dim backdrop cancels; a tap inside the dialog does not", () => {
    const { onCancel, onConfirm } = dialog();
    fireEvent.pointerDown(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.pointerDown(screen.getByRole("alertdialog").parentElement!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("Tab stays inside: from the last button it wraps to the first, Shift+Tab from the first to the last", () => {
    dialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Sign out anyway" });
    confirm.focus();
    fireEvent.keyDown(confirm, { key: "Tab" });
    expect(document.activeElement).toBe(cancel);
    fireEvent.keyDown(cancel, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });
});

describe("the bill behind a full-screen overlay", () => {
  const view = (covered?: boolean) => <BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} covered={covered} />;
  it("is inert and hidden from a screen reader while covered - and normal when not", () => {
    const { container, rerender } = render(view(true));
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute("inert")).toBe(true);
    expect(root.getAttribute("aria-hidden")).toBe("true");
    rerender(view(false));
    expect(root.hasAttribute("inert")).toBe(false);
    expect(root.getAttribute("aria-hidden")).toBeNull();
  });
});

describe("the set-up screen's touch targets are 44 px", () => {
  it("both fields and both buttons carry min-h-11", () => {
    render(<OnboardingScreen />);
    for (const el of [screen.getByLabelText("Shop name"), screen.getByLabelText("Phone (optional)"), screen.getByRole("button", { name: "Use ready catalog" }), screen.getByRole("button", { name: "Start empty" })]) {
      expect(el.className, el.outerHTML.slice(0, 60)).toContain("min-h-11");
    }
  });
});

describe("a 44 px button is never squeezed by a long name beside it", () => {
  const sources = import.meta.glob("./*.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
  it("every size-11 class in the screens also has shrink-0 (a flex row would otherwise shrink it to 18 px)", () => {
    const bad = Object.entries(sources)
      .filter(([file]) => !file.includes(".test."))
      .flatMap(([file, src]) => [...src.matchAll(/\bsize-11\b(?! shrink-0)/g)].map(() => file));
    expect(bad).toEqual([]);
  });
});
