// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { SignInScreen } from "@/ui/SignInScreen";
import { REFUSED_TEXT, FAILED_TEXT } from "@/data/oauthReturn";
import { resetUpdateGate } from "./updateGate";

vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

// KB-335 (D82): coming back to the sign-in screen with the marks of a refused or failed sign-in in the address bar.
afterEach(() => {
  cleanup();
  resetUpdateGate();
  window.history.replaceState(null, "", "/");
});
const at = (url: string) => window.history.replaceState(null, "", url);

describe("the sign-in screen after a return", () => {
  it("a refused sign-up says so in the approved words - and never repeats what the server wrote (an email)", () => {
    at("/?error=access_denied&error_code=signup_disabled&error_description=Signups+not+allowed+for+someone%40gmail.com");
    render(<SignInScreen />);
    expect(screen.getByRole("alert").textContent).toBe(REFUSED_TEXT);
    expect(document.body.textContent).not.toContain("someone@gmail.com");
  });
  it("the marks are taken out of the address bar (a reload must not show the message again)", () => {
    at("/?error=access_denied&error_code=signup_disabled&keep=1#error=x");
    render(<SignInScreen />);
    expect(window.location.search).toBe("?keep=1");
    expect(window.location.hash).toBe("");
  });
  it("a ?code= left behind (the exchange never happened, e.g. the sign-in started in another browser) says the sign-in did not finish", () => {
    at("/?code=abc123");
    render(<SignInScreen />);
    expect(screen.getByRole("alert").textContent).toBe(FAILED_TEXT);
    expect(window.location.search).toBe("");
  });
  it("a normal visit, or pressing Cancel at Google, shows nothing", () => {
    render(<SignInScreen />);
    expect(screen.queryByRole("alert")).toBeNull();
    cleanup();
    at("/?error=access_denied&error_description=The+user+denied+access");
    render(<SignInScreen />);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(window.location.search).toBe("");
  });
});
