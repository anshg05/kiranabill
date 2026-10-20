// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { smsLink } from "@/domain/receiptText";
import { storageStatusText } from "@/data/storagePersist";
import { isIos, isStandalone } from "./platform";
import { recordedMimeType } from "./recordingType";
import { useVoiceCapture } from "./useVoiceCapture";
import { BillView } from "./BillingScreen";
import { ShareBar } from "./ShareBar";
import { InstallHint } from "./InstallHint";
import { setScreenLanguage } from "./screenLanguage";
import { stubLocalStorage } from "./testStorage";
import type { ReceiptShare } from "./useReceiptShare";

// KB-346 (owner, 20 Oct 2026; D90): what the docs say about Safari / iOS, fixed in code. No device test here - the iPhone
// checklist is in docs/19-MACHINE-SETUP.md. Sources: WebKit (MediaRecorder writes MP4/AAC; Safari has no install prompt; the
// storage policy), MDN BCD 8.1.6 (minimum Safari versions), Groq (accepts mp4 / m4a / webm).

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const MAC = IPAD_AS_MAC;

beforeEach(() => {
  stubLocalStorage(); // unstubAllGlobals below removes it after each test
});
afterEach(() => {
  cleanup();
  setScreenLanguage("en");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("telling an iPhone from the rest", () => {
  it("an iPhone and an iPad (which reports itself as a Mac with a touch screen) are iOS; Android and a real Mac are not", () => {
    expect(isIos({ userAgent: IPHONE, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: IPAD_AS_MAC, maxTouchPoints: 5 })).toBe(true);
    expect(isIos({ userAgent: ANDROID, maxTouchPoints: 5 })).toBe(false);
    expect(isIos({ userAgent: MAC, maxTouchPoints: 0 })).toBe(false);
  });
  it("installed to the Home Screen = standalone (navigator.standalone on Safari, display-mode elsewhere)", () => {
    expect(isStandalone({ standalone: true }, () => false)).toBe(true);
    expect(isStandalone({}, (q) => q === "(display-mode: standalone)")).toBe(true);
    expect(isStandalone({ standalone: false }, () => false)).toBe(false);
  });
});

describe("recording: the type of what Safari recorded", () => {
  it("a type the browser reports is kept as it is (Chrome webm, Safari mp4 with its codec)", () => {
    expect(recordedMimeType("audio/webm;codecs=opus", IPHONE)).toBe("audio/webm;codecs=opus");
    expect(recordedMimeType("audio/mp4;codecs=mp4a.40.2", IPHONE)).toBe("audio/mp4;codecs=mp4a.40.2");
  });
  it("an EMPTY type (Safari can report none) is mp4 on an iPhone - never left to be labelled .webm for Groq", () => {
    expect(recordedMimeType("", IPHONE)).toBe("audio/mp4");
    expect(recordedMimeType("", ANDROID)).toBe("audio/webm");
  });
  it("the recording hook labels the blob that way", async () => {
    class Rec {
      state: "inactive" | "recording" = "inactive";
      mimeType = "";
      onstart: (() => void) | null = null;
      onstop: (() => void) | null = null;
      onerror: (() => void) | null = null;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      start() {
        this.state = "recording";
        queueMicrotask(() => this.onstart?.());
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["x"]) });
        queueMicrotask(() => this.onstop?.());
      }
    }
    const track = { readyState: "live", stop: vi.fn() };
    vi.stubGlobal("MediaRecorder", Rec);
    vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
    const { result } = renderHook(() => useVoiceCapture());
    await act(async () => void (await result.current.start()));
    let blob: Blob | null = null;
    await act(async () => void (blob = await result.current.stop()));
    expect((blob as Blob | null)?.type).toBe("audio/mp4");
  });
});

describe("the SMS link: iOS wants '&body=', Android '?body='", () => {
  it("Android / default: sms:<number>?body=", () => {
    expect(smsLink("Hello ₹5", "9876543210")).toBe(`sms:9876543210?body=${encodeURIComponent("Hello ₹5")}`);
  });
  it("iOS: sms:<number>&body=", () => {
    expect(smsLink("Hello ₹5", "9876543210", true)).toBe(`sms:9876543210&body=${encodeURIComponent("Hello ₹5")}`);
  });
  it("an invalid mobile has no link on either", () => {
    expect(smsLink("x", "12345")).toBeNull();
    expect(smsLink("x", "12345", true)).toBeNull();
  });
});

describe("the SMS sheet's 'Copy message'", () => {
  const fakeShare = (): ReceiptShare => ({ ready: true, smsText: "SHARMA KIRANA\nTOTAL Rs.90", downloadImage() {}, downloadPdf() {}, whatsApp() {}, storedMobile: async () => null, sendSms() {} });
  it("copies the text, says 'Copied', and is there when the clipboard exists", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });
    render(<ShareBar share={fakeShare()} />);
    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Copy message" })));
    expect(writeText).toHaveBeenCalledWith("SHARMA KIRANA\nTOTAL Rs.90");
    expect(screen.getByText("Copied")).toBeTruthy();
  });
  it("without a clipboard the button is not offered (never a dead button)", () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    render(<ShareBar share={fakeShare()} />);
    fireEvent.click(screen.getByRole("button", { name: "SMS" }));
    expect(screen.queryByRole("button", { name: "Copy message" })).toBeNull();
  });
});

describe("the install hint (Safari has no install prompt - Share, then Add to Home Screen)", () => {
  const onIphone = (standalone = false) =>
    vi.stubGlobal("navigator", { userAgent: IPHONE, maxTouchPoints: 5, standalone });
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
  });

  it("shows in iOS Safari, as a note with a dismiss button of 44 px class", () => {
    onIphone();
    render(<InstallHint eligible />);
    expect(screen.getByRole("note").textContent).toContain("Share");
    expect(screen.getByRole("note").textContent).toContain("Add to Home Screen");
    expect(screen.getByRole("button", { name: "Close" }).className).toContain("size-11");
  });
  it("not in the installed app, not on Android, not while there is a bill (eligible=false)", () => {
    onIphone(true);
    const { unmount } = render(<InstallHint eligible />);
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    vi.stubGlobal("navigator", { userAgent: ANDROID, maxTouchPoints: 5 });
    const second = render(<InstallHint eligible />);
    expect(screen.queryByRole("note")).toBeNull();
    second.unmount();
    onIphone();
    render(<InstallHint eligible={false} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("dismissing it is remembered on this phone", () => {
    onIphone();
    const { unmount } = render(<InstallHint eligible />);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("note")).toBeNull();
    unmount();
    render(<InstallHint eligible />);
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("in हिन्दी and Hinglish", () => {
    onIphone();
    setScreenLanguage("hi");
    const { unmount } = render(<InstallHint eligible />);
    expect(screen.getByRole("note").textContent).toContain("शेयर");
    unmount();
    localStorage.clear();
    setScreenLanguage("hl");
    render(<InstallHint eligible />);
    expect(screen.getByRole("note").textContent).toContain("Share dabayein");
  });
  it("the billing screen shows it on an empty bill only", () => {
    onIphone();
    const { rerender } = render(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} />);
    expect(screen.getByRole("note")).toBeTruthy();
    rerender(<BillView lines={[]} onSignOut={() => {}} onEdit={() => null} onRemove={() => {}} saved={{ receiptNumber: "1" }} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("storage wording on iOS (KI-68's analogue)", () => {
  it("'not protected yet' says Share, then Add to Home Screen on an iPhone - 'install the app' elsewhere", () => {
    expect(storageStatusText("denied", true)).toBe("Storage: not protected yet — tap Share, then Add to Home Screen");
    expect(storageStatusText("denied", false)).toBe("Storage: not protected yet — install the app");
    expect(storageStatusText("granted", true)).toBe("Storage: protected");
  });
});

describe("the notch and the home bar", () => {
  const read = (f: string) => readFileSync(join(__dirname, "..", "..", f), "utf8");
  it("the page covers the whole screen (viewport-fit=cover) so env(safe-area-inset-*) has a value", () => {
    expect(read("index.html")).toMatch(/<meta name="viewport"[^>]*viewport-fit=cover/);
  });
  it("the bottom bars keep clear of the home indicator: safe-bottom is defined and used", () => {
    expect(read("src/index.css")).toMatch(/\.safe-bottom\s*\{[^}]*env\(safe-area-inset-bottom\)/);
    for (const f of ["src/ui/BillingScreen.tsx", "src/ui/CancelBillSheet.tsx", "src/ui/AddProductSheet.tsx", "src/ui/EditProductSheet.tsx"]) expect(read(f), f).toContain("safe-bottom");
  });
  it("the sides keep clear of a landscape notch", () => {
    expect(read("src/index.css")).toMatch(/safe-area-inset-left/);
  });
});
