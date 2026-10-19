// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LANGUAGES, MESSAGES, render as say, translateEnglish } from "@/domain/messages";
import { PARSE_FAILED } from "./useBillLines";
import { NOT_ADDED } from "./useOrderResolver";
import { messageFor, NO_ITEM_FOUND, OFFLINE_REASON } from "./useVoiceBilling";
import { SAVE_FAILED } from "@/data/finalise";
import { SAVE_FAILED_TEXT } from "./EditProductSheet";
import { FAILED_TEXT, REFUSED_TEXT } from "@/data/oauthReturn";
import { VoiceApiError } from "@/data/voiceApi";
import { OnboardingScreen } from "./OnboardingScreen";
import { SignInScreen } from "./SignInScreen";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";

// KB-343 (owner, 19 Oct 2026; docs/21 Part 5 #18): the shopkeeper-visible error messages are all in हिन्दी and Hinglish -
// none reaches the screen as raw English or as a technical message. Times stay "5:20 PM".

stubLocalStorage();
const signInWithGoogle = vi.fn();
let createShop: (...args: unknown[]) => Promise<void>;
vi.mock("@/providers/AuthProvider", () => ({ useAuth: () => ({ signInWithGoogle }) }));
vi.mock("@/providers/ShopProvider", () => ({ useShop: () => ({ createShop: (...a: unknown[]) => createShop(...a) }) }));
beforeEach(() => {
  signInWithGoogle.mockReset();
  createShop = async () => {};
});
afterEach(() => {
  cleanup();
  setScreenLanguage("en");
});

const DEVANAGARI = /[ऀ-ॿ]/;

describe("every message a shopkeeper can read as an error has a हिन्दी and a Hinglish form", () => {
  const voiceErrors = (["unauthorized", "rate_limited", "network", "busy", "timeout", "server"] as const).map((kind) => messageFor(new VoiceApiError(kind, "x")));
  const english = [
    PARSE_FAILED, NOT_ADDED, NO_ITEM_FOUND, OFFLINE_REASON, SAVE_FAILED, SAVE_FAILED_TEXT, REFUSED_TEXT, FAILED_TEXT,
    ...voiceErrors,
    "Couldn't hear that — try again", "Didn't catch anything — try again", "Couldn't cancel the bill — try again",
    "Mic permission denied — allow it in the browser's site settings", "No microphone found", "Voice isn't supported in this browser",
    "The microphone didn't start — try again", "Recording stopped — the app went to the background. Tap to try again",
    "Shop name is required.", "Setting up a shop needs an internet connection.",
  ];
  it.each(english)("%s", (sentence) => {
    const hi = translateEnglish(sentence, "hi");
    const hl = translateEnglish(sentence, "hl");
    expect(hi, `hi: ${sentence}`).not.toBe(sentence);
    expect(hl, `hl: ${sentence}`).not.toBe(sentence);
    expect(hi).toMatch(DEVANAGARI);
    expect(hl).not.toMatch(DEVANAGARI);
  });
});

describe("sign-in: a failure is said in the shopkeeper's language, never as the browser's technical text", () => {
  it.each(LANGUAGES)("a network failure - in %s", async (lang) => {
    setScreenLanguage(lang);
    signInWithGoogle.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    render(<SignInScreen />);
    fireEvent.click(screen.getByRole("button", { name: say("signin.google", {}, lang) }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(say("signin.error", {}, lang));
    expect(alert.textContent).not.toContain("Failed to fetch");
  });
});

describe("set-up: a failure is said in the shopkeeper's language", () => {
  const submit = async (lang: "en" | "hi" | "hl") => {
    setScreenLanguage(lang);
    render(<OnboardingScreen />);
    fireEvent.change(screen.getByLabelText(say("settings.shopName", {}, lang)), { target: { value: "Sharma Kirana" } });
    fireEvent.click(screen.getByRole("button", { name: say("onboard.empty", {}, lang) }));
    return screen.findByRole("alert");
  };
  it.each(LANGUAGES)("a server error is not shown raw - in %s", async (lang) => {
    createShop = async () => {
      throw new Error('duplicate key value violates unique constraint "shops_pkey"');
    };
    const alert = await submit(lang);
    expect(alert.textContent).toBe(say("onboard.error", {}, lang));
  });
  it.each(LANGUAGES)("no internet keeps its own sentence - in %s", async (lang) => {
    createShop = async () => {
      throw new Error("Setting up a shop needs an internet connection.");
    };
    expect((await submit(lang)).textContent).toBe(say("onboard.offline", {}, lang));
  });
  it("the new catalog entries exist in all three languages", () => {
    for (const id of ["signin.error", "onboard.error", "voice.noItem", "voice.understanding"] as const) {
      for (const l of LANGUAGES) expect(MESSAGES[id][l], `${id}.${l}`).toBeTruthy();
    }
  });
});
