// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import type { BillLine } from "@/data/voiceBilling";
import { BillView } from "./BillingScreen";

// KB-313 (owner, 8 Oct 2026): the header chip (05 §7), "Clear bill" in the ≡ menu, and the sign-out warning
// (16 §2). Nothing here ever blocks billing: a chip is a status, never a dialog standing in the way.

afterEach(cleanup);

function lines(transcript = "2 kilo chini"): (BillLine & { id: string })[] {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error("did not parse");
  return items.map((item, i) => ({ id: `l${i}`, item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const }));
}
const base = { lines: [] as (BillLine & { id: string })[], onSignOut: () => {}, onEdit: () => null, onRemove: () => {} };

describe("the header chip", () => {
  it("no chip when there is nothing to say", () => {
    render(<BillView {...base} />);
    expect(screen.queryByTestId("sync-chip")).toBeNull();
  });

  it("'Offline' is plain grey text - not a button, not a dialog - and the bill still works", () => {
    render(<BillView {...base} lines={lines()} syncChip={{ kind: "offline", label: "Offline" }} />);
    const chip = screen.getByTestId("sync-chip");
    expect(chip.textContent).toBe("Offline");
    expect(chip.tagName).not.toBe("BUTTON");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: /Add item/ })).toBeTruthy();
  });

  it("'Syncing…' and the offline-session chip are text too", () => {
    const { rerender } = render(<BillView {...base} syncChip={{ kind: "syncing", label: "Syncing…" }} />);
    expect(screen.getByTestId("sync-chip").textContent).toBe("Syncing…");
    rerender(<BillView {...base} syncChip={{ kind: "nosession", label: "Not syncing — sign in again" }} />);
    expect(screen.getByTestId("sync-chip").textContent).toBe("Not syncing — sign in again");
    expect(screen.getByTestId("sync-chip").tagName).not.toBe("BUTTON");
  });

  it("amber 'Sync failing' is tappable: it says how many bills are waiting, the permanent ones separately, and 'Billing continues.'", () => {
    render(<BillView {...base} syncChip={{ kind: "failing", label: "Sync failing" }} syncDetail={{ pending: 3, conflict: 2, lastAttemptAt: "2026-10-08T16:40:00.000Z" }} />);
    const chip = screen.getByRole("button", { name: "Sync failing" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(chip);
    const detail = screen.getByRole("dialog", { name: "Sync details" });
    expect(detail.textContent).toContain("3 bills haven't reached the server yet");
    expect(detail.textContent).toContain("2 bills couldn't be saved to the server");
    expect(detail.textContent).toContain("Billing continues.");
    fireEvent.click(within(detail).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("singular wording for one bill, and nothing said about zero", () => {
    render(<BillView {...base} syncChip={{ kind: "failing", label: "Sync failing" }} syncDetail={{ pending: 1, conflict: 0, lastAttemptAt: null }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sync failing" }));
    const detail = screen.getByRole("dialog", { name: "Sync details" });
    expect(detail.textContent).toContain("1 bill hasn't reached the server yet");
    expect(detail.textContent).not.toContain("couldn't be saved");
  });
});

describe("Clear bill", () => {
  it("is in the ≡ menu only when the bill has lines", () => {
    const { rerender } = render(<BillView {...base} onClearBill={() => {}} />);
    expect(screen.queryByRole("button", { name: "Clear bill" })).toBeNull();
    rerender(<BillView {...base} lines={lines()} onClearBill={() => {}} />);
    expect(screen.getByRole("button", { name: "Clear bill" })).toBeTruthy();
  });

  it("asks first, with the number of lines; Cancel changes nothing; Clear removes the bill", () => {
    const onClearBill = vi.fn();
    const two = [...lines("2 kilo chini"), ...lines("teen parle g 10 wala").map((l) => ({ ...l, id: "p0" }))];
    render(<BillView {...base} lines={two} onClearBill={onClearBill} />);
    fireEvent.click(screen.getByRole("button", { name: "Clear bill" }));
    const dialog = screen.getByRole("alertdialog", { name: "Clear this bill?" });
    expect(dialog.textContent).toMatch(/2 lines will be removed/);
    expect(dialog.textContent).toContain("nothing is saved");
    expect(onClearBill).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onClearBill).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Clear bill" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Clear bill" }));
    expect(onClearBill).toHaveBeenCalledOnce();
  });

  it("is not offered on a saved bill (it is final)", () => {
    render(<BillView {...base} lines={lines()} onClearBill={() => {}} saved={{ receiptNumber: "KB-000001" }} />);
    expect(screen.queryByRole("button", { name: "Clear bill" })).toBeNull();
  });
});

describe("the sign-out warning", () => {
  it("nothing unsynced: Sign out signs out at once, no dialog", () => {
    const onSignOut = vi.fn();
    render(<BillView {...base} onSignOut={onSignOut} unsynced={{ pending: 0, conflict: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("unsynced bills: it warns with the count, and only 'Sign out anyway' signs out", () => {
    const onSignOut = vi.fn();
    render(<BillView {...base} onSignOut={onSignOut} unsynced={{ pending: 3, conflict: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = screen.getByRole("alertdialog", { name: "Sign out?" });
    expect(dialog.textContent).toContain("3 bills haven't reached the server yet — they'll stay on this phone and sync when you sign back in");
    expect(onSignOut).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onSignOut).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Sign out anyway" }));
    expect(onSignOut).toHaveBeenCalledOnce();
  });

  it("one bill reads in the singular", () => {
    render(<BillView {...base} unsynced={{ pending: 1, conflict: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("1 bill hasn't reached the server yet — it'll stay on this phone and sync when you sign back in");
  });

  it("bills in a permanent conflict get their own, truthful line - they will NOT sync by signing back in", () => {
    render(<BillView {...base} unsynced={{ pending: 2, conflict: 1 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).toContain("2 bills haven't reached the server yet");
    expect(text).toContain("1 bill couldn't be saved to the server and won't sync on its own — it stays on this phone");
  });

  it("only conflict bills: the pending line is not shown", () => {
    render(<BillView {...base} unsynced={{ pending: 0, conflict: 2 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    const text = screen.getByRole("alertdialog").textContent ?? "";
    expect(text).not.toContain("haven't reached");
    expect(text).toContain("2 bills couldn't be saved to the server and won't sync on its own");
  });

  it("a bill in progress is mentioned: it stays on this phone for the same user", () => {
    render(<BillView {...base} lines={lines()} unsynced={{ pending: 1, conflict: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("Your bill in progress stays on this phone too");
  });
  it("a SAVED bill (its lines still on screen, read-only) is not 'a bill in progress'", () => {
    render(<BillView {...base} lines={lines()} saved={{ receiptNumber: "KB-000001" }} unsynced={{ pending: 1, conflict: 0 }} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.getByRole("alertdialog").textContent).not.toContain("bill in progress");
  });
});
