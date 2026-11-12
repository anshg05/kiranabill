// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SignInScreen } from "./SignInScreen";

// KB-342: one tap on "Sign in with Google" starts one sign-in; the button says it is working; a failure gives the tap back.

const signInWithGoogle = vi.fn();
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle }) }));
afterEach(() => {
  cleanup();
  signInWithGoogle.mockReset();
});

describe("sign-in: a double tap", () => {
  it("starts ONE sign-in and the button reads 'Opening Google…'", () => {
    signInWithGoogle.mockReturnValue(new Promise(() => {})); // the browser is on its way to Google
    render(<SignInScreen />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(button.textContent).toBe("Opening Google…");
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("if it fails the message shows and the button works again", async () => {
    signInWithGoogle.mockRejectedValueOnce(new Error("network down"));
    render(<SignInScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Couldn't start sign-in — check the internet and try again"); // KB-343: a sentence, not "network down"
    expect(screen.getByRole("button", { name: "Sign in with Google" }).getAttribute("aria-disabled")).toBe("false");
    signInWithGoogle.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInWithGoogle).toHaveBeenCalledTimes(2);
  });
  // KB-409: inside the Android app the sign-in happens in a Chrome Custom Tab; when that is over without a sign-in
  // (closed, or the app is back in front, or 60 s passed) the provider answers "returned" and the tap comes back.
  it("in the app: the button comes back when the sign-in attempt is over, and the next tap is one more attempt", async () => {
    let over: (v: "returned") => void = () => {};
    signInWithGoogle.mockReturnValueOnce(new Promise((resolve) => (over = resolve)));
    render(<SignInScreen />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    await act(async () => over("returned"));
    expect(button.getAttribute("aria-disabled")).toBe("false");
    expect(button.textContent).toBe("Sign in with Google");
    expect(screen.queryByRole("alert")).toBeNull(); // closing the tab is not an error
    signInWithGoogle.mockReturnValue(new Promise(() => {}));
    fireEvent.click(button);
    expect(signInWithGoogle).toHaveBeenCalledTimes(2);
  });

  it("on the web: the sign-in call finishing does NOT give the tap back (the page is leaving for Google)", async () => {
    signInWithGoogle.mockResolvedValueOnce(undefined);
    render(<SignInScreen />);
    const button = screen.getByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    await act(async () => {});
    expect(button.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(button);
    expect(signInWithGoogle).toHaveBeenCalledTimes(1);
  });
});
