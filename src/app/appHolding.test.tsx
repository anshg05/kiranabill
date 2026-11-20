// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { stubLocalStorage } from "@/ui/testStorage";

// KB-425 (owner, 20 Nov 2026; D123): the cream "Loading" screen never shows inside the Android app - a blue holding screen the splash
// stays over (src/data/appShell.ts). The website keeps its loading line.

stubLocalStorage();
const env = vi.hoisted(() => ({ native: false }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => env.native, buildMatchesPackage: async () => true }));
import { AppHolding } from "./App";
import { HOLDING_ATTR } from "@/data/appShell";

afterEach(cleanup);

describe("waiting for the session or the shop", () => {
  it("the Android app: the splash's blue, marked as holding - no Loading text, no cream", () => {
    env.native = true;
    const { container } = render(<AppHolding />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.hasAttribute(HOLDING_ATTR)).toBe(true);
    expect(el.className).toContain("bg-[#2563D9]");
    expect(el.className).not.toContain("bg-paper");
    expect(screen.queryByText("Loading…")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("the website: today's loading line, not a holding screen", () => {
    env.native = false;
    const { container } = render(<AppHolding />);
    expect(container.querySelector(`[${HOLDING_ATTR}]`)).toBeNull();
    expect(container.textContent).not.toBe("");
  });
});
