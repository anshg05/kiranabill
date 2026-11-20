// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { render as say } from "@/domain/messages";
import { BUILD_ID } from "@/pwa/buildId";
import { stubLocalStorage } from "./testStorage";

// SG-27 (owner, 20 Nov 2026; D124): Help & support - how to use (8 short steps, true to today's app), contact by email (the build id in
// the subject), "We reply within 2 working days", Privacy. Three languages. The screen names a step quotes come from the app's own
// labels, so a renamed button can never leave the help text wrong.

stubLocalStorage();
const env = vi.hoisted(() => ({ native: false }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native }));
import { HelpPage, SUPPORT_EMAIL } from "./HelpPage";

afterEach(() => {
  cleanup();
  env.native = false;
});

const STEPS = ["Speak the whole order", "Check the bill", "Bill Banao saves the bill", "A wrong bill?", "Your prices", "No internet?", "Many phones, one shop", "Printer (Android app only)"];

describe("Help & support", () => {
  it("how to use: the steps in order, each with its line (the printer step only inside the app)", () => {
    env.native = true;
    render(<HelpPage onClose={() => {}} />);
    const list = screen.getByRole("list", { name: "How to use" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("h3")?.textContent)).toEqual(STEPS);
    cleanup();
    env.native = false;
    render(<HelpPage onClose={() => {}} />);
    expect(within(screen.getByRole("list", { name: "How to use" })).getAllByRole("listitem")).toHaveLength(7);
  });

  it("each step quotes the app's own labels - never a name the screens do not show", () => {
    env.native = true;
    render(<HelpPage onClose={() => {}} />);
    const text = screen.getByRole("list", { name: "How to use" }).textContent!;
    for (const key of ["bill.finalise", "history.billsLabel", "cancel.andNew", "nav.items", "order.more", "settings.printer", "settings.printerChoose"] as const) expect(text, key).toContain(say(key, {}, "en"));
  });

  it("the owner's words: many phones, one shop", () => {
    render(<HelpPage onClose={() => {}} />);
    expect(screen.getByText("Sign in with the same Google account on each phone in your shop - every phone bills into the same shop, all bills reach every phone, and bill numbers never clash.")).toBeTruthy();
  });

  it("contact: email only, the build id in the subject, the reply time", () => {
    render(<HelpPage onClose={() => {}} />);
    expect(SUPPORT_EMAIL).toBe("kiranavoicebill@gmail.com");
    const mail = screen.getByRole("link", { name: /Email kiranavoicebill@gmail.com/ }) as HTMLAnchorElement;
    expect(mail.getAttribute("href")).toBe(`mailto:kiranavoicebill@gmail.com?subject=${encodeURIComponent(`Kirana Voice Bill help (${BUILD_ID})`)}`);
    expect(screen.getByText("Write in Hindi, English or Hinglish. We reply within 2 working days.")).toBeTruthy();
    expect(screen.queryByText(/whatsapp\.com|wa\.me|\+91/)).toBeNull(); // email only
  });

  it("Privacy links to the policy; Back closes", () => {
    const onClose = vi.fn();
    render(<HelpPage onClose={onClose} />);
    expect((screen.getByRole("link", { name: /^Privacy/ }) as HTMLAnchorElement).getAttribute("href")).toBe("/privacy");
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("every word in Hindi and Hinglish; the address and the build id stay as they are", () => {
    for (const lang of ["hi", "hl"] as const) {
      for (const key of ["help.row", "help.rowSub", "help.how", "help.s1d", "help.s2", "help.s2d", "help.s3", "help.s3d", "help.s4", "help.s4d", "help.s5", "help.s5d", "help.s6", "help.s6d", "help.s7", "help.s7d", "help.s8", "help.s8d", "help.contact", "help.reply"] as const)
        expect(say(key, { finalise: "Bill Banao", bills: "B", cancel: "C", items: "I", more: "M", printer: "P", choose: "X" }, lang), `${lang} ${key}`).not.toBe(say(key, { finalise: "Bill Banao", bills: "B", cancel: "C", items: "I", more: "M", printer: "P", choose: "X" }, "en"));
      expect(say("help.email", { email: SUPPORT_EMAIL }, lang)).toContain(SUPPORT_EMAIL);
    }
  });
});
