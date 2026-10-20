// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OnboardingScreen } from "./OnboardingScreen";
import { stubLocalStorage } from "./testStorage";

// KB-348 (D90): a double tap on a set-up button must make ONE shop (the database now refuses a second - shops_one_per_owner -
// but the screen should not even ask twice).

stubLocalStorage();
const createShop = vi.fn(() => new Promise<void>(() => {})); // the server is slow
vi.mock("@/providers/ShopProvider", () => ({ useShop: () => ({ createShop }) }));
afterEach(() => {
  cleanup();
  createShop.mockClear();
});

describe("set-up: a double tap", () => {
  it("two taps in the same instant ask for ONE shop (a state flag alone would let both through)", () => {
    render(<OnboardingScreen />);
    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Sharma Kirana" } });
    const ready = screen.getByRole("button", { name: "Use ready catalog" });
    act(() => {
      ready.click();
      ready.click();
    });
    expect(createShop).toHaveBeenCalledTimes(1);
  });
  it("a tap on each choice at once still asks once", () => {
    render(<OnboardingScreen />);
    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Sharma Kirana" } });
    act(() => {
      screen.getByRole("button", { name: "Use ready catalog" }).click();
      screen.getByRole("button", { name: "Start empty" }).click();
    });
    expect(createShop).toHaveBeenCalledTimes(1);
  });
  it("after a failure the buttons work again", async () => {
    createShop.mockRejectedValueOnce(new Error("boom"));
    render(<OnboardingScreen />);
    fireEvent.change(screen.getByLabelText("Shop name"), { target: { value: "Sharma Kirana" } });
    await act(async () => void screen.getByRole("button", { name: "Start empty" }).click());
    await screen.findByRole("alert");
    await act(async () => void screen.getByRole("button", { name: "Start empty" }).click());
    expect(createShop).toHaveBeenCalledTimes(2);
  });
});
