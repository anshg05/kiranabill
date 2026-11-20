// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { render as say } from "@/domain/messages";
import { OnboardingScreen } from "./OnboardingScreen";
import { stubLocalStorage } from "./testStorage";

// SG-20 (D121, owner 20 Nov 2026): in allowlist mode the database refuses a shop for a Google account not on the owner's list
// (shops_before_insert: P0001 "signup_closed"). The set-up screen says so plainly, with the support address - never "check the internet".

stubLocalStorage();
const createShop = vi.fn();
vi.mock("@/providers/ShopProvider", () => ({ useShop: () => ({ createShop }) }));
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signOut: () => Promise.resolve() }) }));

afterEach(() => {
  cleanup();
  createShop.mockReset();
});

const INVITE = "Sign-ups are by invitation right now. Write to kiranavoicebill@gmail.com from this Google account.";
const NETWORK = "Couldn't set up the shop — check the internet and try again";

async function tapReady() {
  render(<OnboardingScreen />);
  fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Sharma Kirana" } });
  await act(async () => void screen.getByRole("button", { name: "Use ready catalog" }).click());
  return (await screen.findByRole("alert")).textContent;
}

describe("set-up when sign-ups are by invitation", () => {
  it.each([
    ["supabase-js's error object (code, message, hint)", { code: "P0001", message: "signup_closed", hint: "signup_closed", details: null }],
    ["an Error with the same message", Object.assign(new Error("signup_closed"), { code: "P0001" })],
  ])("%s -> the invitation sentence", async (_, err) => {
    createShop.mockRejectedValueOnce(err);
    expect(await tapReady()).toBe(INVITE);
  });

  it("any other failure keeps the internet sentence", async () => {
    createShop.mockRejectedValueOnce({ code: "P0001", message: "something else", hint: null });
    expect(await tapReady()).toBe(NETWORK);
  });

  it("the sentence in Hindi and Hinglish keeps the address", () => {
    for (const lang of ["hi", "hl"] as const) {
      const text = say("onboard.invite", {}, lang);
      expect(text).not.toBe(INVITE);
      expect(text).toContain("kiranavoicebill@gmail.com");
    }
    expect(say("onboard.invite", {}, "en")).toBe(INVITE);
  });
});
