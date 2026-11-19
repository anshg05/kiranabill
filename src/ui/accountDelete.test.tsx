// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { KiranaBillDB } from "@/data/db";
import type { DeleteOutcome } from "@/data/accountDeletion";
import { MoreScreen } from "./MoreScreen";
import { sameShopName } from "./MorePages";

// KB-430 (D119, owner 20 Nov 2026): More -> Account -> Delete account. What goes is listed; the shop's name must be typed (case,
// outer spaces and runs of spaces do not matter - an English and a Hindi name); offline the button stays off; bills not yet on the
// server and a bill in progress are named; the server's answer is said in one sentence; "deleted" leaves the page to the app.

const SHOP = "11111111-1111-4111-8111-111111111111";
let db: KiranaBillDB | null = null;
afterEach(async () => {
  cleanup();
  db?.close();
  await db?.delete();
  db = null;
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => true });
});

const SYNC = (pending = 0, conflict = 0) => ({ chip: null, unsynced: { pending, conflict }, detail: { pending, conflict, lastAttemptAt: null } });

async function open(name: string, opts: { onDelete?: () => Promise<DeleteOutcome>; pending?: number; billInProgress?: boolean; page?: "account" | undefined } = {}) {
  db = new KiranaBillDB(`acct-${crypto.randomUUID()}`);
  await db.shops.put({ id: SHOP, syncStatus: "synced", name, phone: null, address: null, logoUrl: null, catalogMode: "custom_only", billLanguage: "en", receiptPrefix: "KB", updatedAt: "2026-11-20T10:00:00.000Z" });
  await db.bills.put({ localId: crypto.randomUUID(), shopId: SHOP, status: "final", syncStatus: "synced", createdAt: "2026-11-20T10:00:00.000Z", customerName: "Cash", totalPaise: 100 } as never);
  const onDelete = vi.fn(opts.onDelete ?? (async (): Promise<DeleteOutcome> => ({ kind: "deleted", counts: null })));
  render(
    <MoreScreen localDb={db} shopId={SHOP} deviceId="d" sync={SYNC(opts.pending ?? 0)} billInProgress={opts.billInProgress ?? false} onSignOut={() => {}} onItems={() => {}} onClose={() => {}} onDeleteAccount={onDelete} initialPage={"page" in opts ? opts.page : "account"} />,
  );
  return onDelete;
}
const toConfirm = async () => fireEvent.click(await screen.findByRole("button", { name: /^Delete account/ }));
const type = (v: string) => fireEvent.change(screen.getByRole("textbox", { name: "Type your shop's name to confirm" }), { target: { value: v } });
const deleteButton = () => screen.getByRole("button", { name: /^(Delete everything|Deleting…)$/ });

describe("sameShopName", () => {
  it("ignores case, outer spaces and runs of spaces; never matches an empty answer", () => {
    expect(sameShopName("  gupta   KIRANA store ", "Gupta Kirana Store")).toBe(true);
    expect(sameShopName("Gupta Kirana", "Gupta Kirana Store")).toBe(false);
    expect(sameShopName("   ", "  ")).toBe(false);
  });
  it("a Hindi name: spaces do not matter; composed and decomposed forms are the same name", () => {
    expect(sameShopName("  गुप्ता   किराना ", "गुप्ता किराना")).toBe(true);
    expect(sameShopName("क़", "क़")).toBe(true); // NFC: one letter, two ways of typing it
    expect(sameShopName("गुप्ता", "गुप्ता किराना")).toBe(false);
  });
});

describe("More -> Account -> Delete account (KB-430)", () => {
  it("More shows an Account row only when the app passes the deletion", async () => {
    await open("Gupta Kirana Store", { page: undefined });
    expect(await screen.findByRole("button", { name: /^Account/ })).toBeTruthy();
  });

  it("lists what goes, then needs the shop's name typed - case and spaces do not matter (English)", async () => {
    const onDelete = await open("Gupta Kirana Store");
    await toConfirm();
    expect(screen.getByText("the shop Gupta Kirana Store")).toBeTruthy();
    expect(await screen.findByText("Bills: 1 · Items: 0 · Learned names: 0")).toBeTruthy();
    expect(screen.getByText(/your login/)).toBeTruthy();
    expect(deleteButton().getAttribute("aria-disabled")).toBe("true");
    type("Gupta Kirana");
    fireEvent.click(deleteButton());
    expect(onDelete).not.toHaveBeenCalled();
    type("  gupta  kirana STORE ");
    expect(deleteButton().getAttribute("aria-disabled")).not.toBe("true");
    await act(async () => fireEvent.click(deleteButton()));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("a Hindi shop name, typed with extra spaces, confirms", async () => {
    const onDelete = await open("गुप्ता किराना");
    await toConfirm();
    type("  गुप्ता    किराना  ");
    await act(async () => fireEvent.click(deleteButton()));
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("offline: the button stays off and says why - nothing is asked", async () => {
    Object.defineProperty(navigator, "onLine", { configurable: true, get: () => false });
    const onDelete = await open("Gupta Kirana Store");
    await toConfirm();
    type("Gupta Kirana Store");
    expect(screen.getByText("Deleting needs internet.")).toBeTruthy();
    expect(deleteButton().getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(deleteButton());
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("bills not yet on the server and a bill in progress are named before anything is deleted", async () => {
    await open("Gupta Kirana Store", { pending: 3, billInProgress: true });
    await toConfirm();
    expect(screen.getByText("3 bills have not reached the server - they will be deleted too.")).toBeTruthy();
    expect(screen.getByText("The bill you are making will be lost.")).toBeTruthy();
  });

  it("the server's answer, in one sentence: a shared shop, a failure - and the button comes back", async () => {
    await open("Gupta Kirana Store", { onDelete: async () => ({ kind: "shared_shop" }) });
    await toConfirm();
    type("Gupta Kirana Store");
    await act(async () => fireEvent.click(deleteButton()));
    expect(screen.getByText("This shop has other members - remove them first. Nothing was deleted.")).toBeTruthy();
    cleanup();
    await open("Gupta Kirana Store", { onDelete: async () => ({ kind: "failed", reason: "server" }) });
    await toConfirm();
    type("Gupta Kirana Store");
    await act(async () => fireEvent.click(deleteButton()));
    expect(screen.getByText("Could not delete - nothing was deleted. Try again.")).toBeTruthy();
    expect(deleteButton().getAttribute("aria-disabled")).not.toBe("true");
  });
});
