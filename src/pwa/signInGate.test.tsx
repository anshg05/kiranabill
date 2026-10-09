// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { SignInScreen } from "@/ui/SignInScreen";
import { isUpdateSafe, resetUpdateGate } from "./updateGate";

vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle: () => Promise.resolve() }) }));

// KB-401 (D67): the sign-in screen holds nothing to lose, so a waiting update may apply there.
afterEach(() => {
  cleanup();
  resetUpdateGate();
});

describe("the sign-in screen", () => {
  it("is a safe moment to update", () => {
    render(<SignInScreen />);
    expect(isUpdateSafe()).toBe(true);
  });
});
