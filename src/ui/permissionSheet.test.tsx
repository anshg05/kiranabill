// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { render as say } from "@/domain/messages";
import { stubLocalStorage } from "./testStorage";

// KB-425 (owner, 20 Nov 2026; D123): screen 07's card for ONE permission, and the Open Settings sheet - three languages.

stubLocalStorage();
const settings = vi.hoisted(() => ({ opened: 0 }));
vi.mock("@capacitor/core", () => ({ registerPlugin: () => ({ openSettings: async () => void settings.opened++, permissionState: async () => ({ granted: false, canAsk: false }) }) }));
vi.mock("@/data/nativeSignIn", () => ({ isNativeApp: () => true }));
import { PermissionSheet, PermissionSheetHost } from "./PermissionSheet";
import { beforeAsking } from "@/data/appShell";

afterEach(cleanup);
const button = (name: string) => screen.getByRole("button", { name });

describe("the permission sheet", () => {
  it("the mic card: screen 07's words, Allow / Not now", () => {
    const onChoice = vi.fn();
    render(<PermissionSheet kind="microphone" sheet="explain" onChoice={onChoice} />);
    for (const text of ["Microphone", "Required", "Hears the order only when you tap Record.", "Only for this job. Change it any time in Settings."]) expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(button("Allow"));
    fireEvent.click(button("Not now"));
    expect(onChoice.mock.calls).toEqual([["allow"], ["close"]]);
  });

  it("the Nearby devices card", () => {
    render(<PermissionSheet kind="nearby" sheet="explain" onChoice={() => {}} />);
    for (const text of ["Nearby devices", "For printing", "Finds your Bluetooth thermal printer."]) expect(screen.getByText(text)).toBeTruthy();
  });

  it("turned off for good: says so and opens this app's settings page", async () => {
    const onChoice = vi.fn();
    render(<PermissionSheet kind="microphone" sheet="settings" onChoice={onChoice} />);
    expect(screen.getByText("The microphone is off for this app")).toBeTruthy();
    expect(screen.getByText("Turn it on in Settings to record orders. You can still type the items.")).toBeTruthy();
    await act(async () => fireEvent.click(button("Open Settings")));
    expect(settings.opened).toBe(1);
    expect(onChoice).toHaveBeenCalledWith("close");
  });

  it("the host: beforeAsking shows the card, Allow lets Android ask, and the card is gone", async () => {
    render(<PermissionSheetHost />);
    let result: boolean | undefined;
    await act(async () => {
      void beforeAsking("nearby").then((r) => (result = r));
    });
    expect(screen.getByText("Finds your Bluetooth thermal printer.")).toBeTruthy();
    await act(async () => fireEvent.click(button("Allow")));
    expect(result).toBe(true);
    expect(screen.queryByText("Finds your Bluetooth thermal printer.")).toBeNull();
  });

  it("every word in Hindi and Hinglish", () => {
    for (const lang of ["hi", "hl"] as const)
      for (const key of ["perm.sub", "perm.mic.title", "perm.mic.badge", "perm.mic.text", "perm.nearby.title", "perm.nearby.badge", "perm.nearby.text", "perm.allow", "perm.notNow", "perm.mic.off", "perm.mic.offText", "perm.nearby.off", "perm.nearby.offText", "perm.openSettings"] as const)
        if (!(lang === "hl" && ["perm.mic.title"].includes(key))) expect(say(key, {}, lang), `${lang} ${key}`).not.toBe(say(key, {}, "en"));
  });
});
