// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    expect((await screen.findByRole("alert")).textContent).toBe("network down");
    expect(screen.getByRole("button", { name: "Sign in with Google" }).getAttribute("aria-disabled")).toBe("false");
    signInWithGoogle.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    expect(signInWithGoogle).toHaveBeenCalledTimes(2);
  });
});
