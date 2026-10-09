// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { parseUtterance } from "@/domain/grammar";
import { SEED_PARSER_CATALOG } from "@/domain/seedCatalog";
import { prepareParserCatalog } from "@/domain/catalogIndex";
import type { BillLine } from "@/data/voiceBilling";
import { KiranaBillDB } from "@/data/db";
import { BillView } from "@/ui/BillingScreen";
import { HistoryScreen } from "@/ui/HistoryScreen";
import { SettingsScreen } from "@/ui/SettingsScreen";
import { IDLE_VOICE } from "@/ui/useVoiceBilling";
import { isUpdateSafe, resetUpdateGate } from "./updateGate";

// KB-401 (D67 - owner, 9 Oct 2026): the update never reloads the page under a bill. The billing screen reports
// "idle" only for an EMPTY bill with nothing open; every overlay (Add item, History, Catalog, Settings, a dialog)
// reports busy; the sign-in screen has nothing to lose.
afterEach(() => {
  cleanup();
  resetUpdateGate();
});

function lines(transcript = "2 kilo chini"): (BillLine & { id: string })[] {
  const items = parseUtterance(transcript, SEED_PARSER_CATALOG);
  if (!items) throw new Error("did not parse");
  return items.map((item, i) => ({ id: `l${i}`, item, displayName: (item.catalogId && SEED_PARSER_CATALOG.byId.get(item.catalogId)?.displayName) || item.spokenName, source: "fastpath" as const }));
}
const base = { lines: [] as (BillLine & { id: string })[], onSignOut: () => {}, onEdit: () => null, onRemove: () => {} };
const parser = prepareParserCatalog(SEED_PARSER_CATALOG.entries);

describe("the billing screen reports whether a reload is safe", () => {
  it("an empty bill with nothing open is safe", () => {
    render(<BillView {...base} />);
    expect(isUpdateSafe()).toBe(true);
  });

  it("a bill with a line is not", () => {
    render(<BillView {...base} lines={lines()} />);
    expect(isUpdateSafe()).toBe(false);
  });

  it("a heard-but-not-added utterance is not", () => {
    render(<BillView {...base} notAdded={[{ id: "n1", transcript: "do kilo kuch", message: "Couldn't read the items", retrying: false }]} />);
    expect(isUpdateSafe()).toBe(false);
  });

  it("a typed customer is not", () => {
    render(<BillView {...base} customer={{ name: "Ramesh", mobile: null }} />);
    expect(isUpdateSafe()).toBe(false);
    cleanup();
    render(<BillView {...base} customer={{ name: "Cash", mobile: "9876543210" }} />);
    expect(isUpdateSafe()).toBe(false);
  });

  it("a recording or an utterance in flight is not; a finished one (done, failed) is", () => {
    for (const phase of ["requesting", "listening", "transcribing", "resolving"] as const) {
      const r = render(<BillView {...base} voice={{ ...IDLE_VOICE, phase }} />);
      expect(isUpdateSafe(), phase).toBe(false);
      r.unmount();
    }
    for (const phase of ["idle", "done", "failed"] as const) {
      const r = render(<BillView {...base} voice={{ ...IDLE_VOICE, phase }} />);
      expect(isUpdateSafe(), phase).toBe(true);
      r.unmount();
    }
  });

  it("saving, a failed save and the saved-bill screen are not (the receipt and share buttons would be lost)", () => {
    render(<BillView {...base} saving />);
    expect(isUpdateSafe()).toBe(false);
    cleanup();
    render(<BillView {...base} saveError="Couldn't save" />);
    expect(isUpdateSafe()).toBe(false);
    cleanup();
    render(<BillView {...base} saved={{ receiptNumber: "KB-000001" }} />); // judged on `saved` alone, not on its lines
    expect(isUpdateSafe()).toBe(false);
  });

  it("the Add item panel is not", () => {
    render(<BillView {...base} catalog={parser} onAddByHand={() => {}} />);
    expect(isUpdateSafe()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Add item/ }));
    expect(isUpdateSafe()).toBe(false);
  });

  it("a confirmation dialog is not", () => {
    render(<BillView {...base} lines={lines()} onClearBill={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(isUpdateSafe()).toBe(false);
  });

  it("is safe again once the bill is cleared", () => {
    const r = render(<BillView {...base} lines={lines()} />);
    expect(isUpdateSafe()).toBe(false);
    r.rerender(<BillView {...base} />);
    expect(isUpdateSafe()).toBe(true);
  });
});

describe("overlays", () => {
  it("History and Settings are busy while open (every overlay uses useBackEntry)", () => {
    const db = new KiranaBillDB(`gate-${crypto.randomUUID()}`);
    const idle = render(<BillView {...base} />);
    expect(isUpdateSafe()).toBe(true);
    const history = render(<HistoryScreen localDb={db} shopId="s" render={() => Promise.reject(new Error("unused"))} onClose={() => {}} />);
    expect(isUpdateSafe()).toBe(false);
    history.unmount();
    expect(isUpdateSafe()).toBe(true);
    const settings = render(<SettingsScreen localDb={db} shopId="s" deviceId="d" onClose={() => {}} />);
    expect(isUpdateSafe()).toBe(false);
    settings.unmount();
    idle.unmount();
  });
});
