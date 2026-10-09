// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { isUpdateSafe, onUpdateSafetyChange, resetUpdateGate, setGate, useUpdateGate } from "./updateGate";

// KB-401 (D67): "is it safe to reload?" - safe only while somebody is mounted AND says so, and nobody says no.
afterEach(() => {
  cleanup();
  resetUpdateGate();
});

function Reporter({ safe }: { safe: boolean }) {
  useUpdateGate(safe);
  return null;
}

describe("update gate", () => {
  it("is not safe while no screen has reported (an unknown screen is never assumed idle)", () => {
    expect(isUpdateSafe()).toBe(false);
  });

  it("is safe when the only reporter says safe", () => {
    render(<Reporter safe />);
    expect(isUpdateSafe()).toBe(true);
  });

  it("any busy reporter makes it unsafe, and it clears when that reporter goes away", () => {
    render(<Reporter safe />);
    const busy = render(<Reporter safe={false} />);
    expect(isUpdateSafe()).toBe(false);
    busy.unmount();
    expect(isUpdateSafe()).toBe(true);
  });

  it("follows a reporter whose answer changes, and tells subscribers", () => {
    const seen = vi.fn();
    const off = onUpdateSafetyChange(seen);
    const r = render(<Reporter safe />);
    expect(seen).toHaveBeenCalled();
    r.rerender(<Reporter safe={false} />);
    expect(isUpdateSafe()).toBe(false);
    off();
    seen.mockClear();
    r.rerender(<Reporter safe />);
    expect(seen).not.toHaveBeenCalled();
  });

  it("an unmounted screen leaves nothing behind", () => {
    const r = render(<Reporter safe />);
    r.unmount();
    expect(isUpdateSafe()).toBe(false);
    setGate("x", true);
    expect(isUpdateSafe()).toBe(true);
  });
});
