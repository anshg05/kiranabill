import { useState } from "react";
import { isNativeApp } from "@/data/nativeSignIn";
import type { Paise } from "@/domain/money";
import { buildReceipt } from "@/domain/receipt";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { IllustrationPanel, Sparkle } from "./kit/IllustrationPanel";
import { Logo } from "./kit/Logo";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { Waveform } from "./kit/Waveform";
import { Receipt } from "./Receipt";
import { SignInScreen } from "./SignInScreen";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

// KB-415 (owner + reviewer, 18 Nov 2026; the approved plan): the signed-out part of the first-time flow - Splash (01), Onboarding 1-3
// (02-04), then Sign in (05). Splash and onboarding are shown once per install: finishing them (Get started on 3) or Skip remembers it on
// this phone; closing the app half way shows them again. Someone signed in on this phone is remembered too (App.tsx), so an update to
// this version never shows them to a shopkeeper who already uses the app. Android Back: 3 -> 2 -> 1 -> splash; Sign in -> 3 when it was
// reached through the onboarding just now. Printing (the "58 / 80 mm" chip, Print) is shown only inside the Android app (default 7).

const WELCOMED = "kb.welcomed.v1";
export function isWelcomed(): boolean {
  try {
    return localStorage.getItem(WELCOMED) === "1";
  } catch {
    return false; // no storage: the splash shows again - nothing is lost
  }
}
export function markWelcomed(): void {
  try {
    localStorage.setItem(WELCOMED, "1");
  } catch {
    // no storage: shown again next time
  }
}

/** One Back entry for the whole flow - each page takes it over (the same key), so history never stacks up. */
function BackTo({ onBack }: { onBack: () => void }) {
  useBackEntry("kbWelcome", onBack);
  return null;
}

/** 0 splash, 1-3 onboarding, 4 sign in */
export function SignedOutFlow({ start }: { start?: 0 | 1 | 2 | 3 | 4 } = {}) {
  // `start`: the dev sheets only (a page of the flow on its own)
  const [step, setStep] = useState<number>(() => start ?? (isWelcomed() ? 4 : 0));
  const [throughOnboarding] = useState(step === 0);
  const finish = () => {
    markWelcomed();
    setStep(4);
  };
  return (
    <>
      {step > 0 && (step < 4 || throughOnboarding) && <BackTo key={step} onBack={() => setStep(step - 1)} />}
      {step === 0 ? <Splash onStart={() => setStep(1)} /> : step < 4 ? <OnboardingPage step={step as 1 | 2 | 3} onNext={step < 3 ? () => setStep(step + 1) : finish} onSkip={finish} /> : <SignInScreen />}
    </>
  );
}

/** 01-Main: the blue splash - the light logo, the name, the two-line promise, the chips, Get started. */
function Splash({ onStart }: { onStart: () => void }) {
  const { t } = useT();
  const chip = "flex items-center gap-[6px] rounded-full border border-kb-card/25 bg-kb-card/14 px-[14px] py-[9px] text-kb-14";
  return (
    <main data-scroll-page className="font-kb fixed inset-0 overflow-y-auto bg-[linear-gradient(170deg,var(--color-kb-splash-1)_0%,var(--color-kb-splash-2)_50%,var(--color-kb-primary)_100%)] text-kb-card">
      <div className="relative mx-auto flex min-h-full w-full max-w-[480px] flex-col overflow-clip">
        <div aria-hidden="true" data-clip-ok className="absolute -top-[120px] -right-[140px] size-[360px] rounded-full bg-kb-card/7" />
        <div aria-hidden="true" data-clip-ok className="absolute bottom-[120px] -left-[110px] size-[260px] rounded-full bg-kb-amber/16" />
        <Sparkle size={18} tone="amber" className="top-[150px] right-[70px]" />
        <Sparkle size={12} tone="white" className="top-[250px] left-[60px] [animation-delay:1s]" />
        <div className="relative flex flex-1 flex-col items-center justify-center gap-[18px] px-8 py-10 text-center">
          <div className="animate-kb-up">
            <Logo size={92} light shadow alt="KiranaBill logo" />
          </div>
          {/* one word that cannot wrap: 36 px, or 12% of the screen's width when a big text size would push it off a small phone */}
          <h1 className="animate-kb-up text-[length:min(var(--text-kb-36),12vw)] font-extrabold tracking-[-0.8px] [animation-delay:.12s]">KiranaBill</h1>
          <p className="animate-kb-up text-kb-18 leading-[1.5] font-semibold [animation-delay:.24s]">
            {t("welcome.tagline1")}
            <br />
            {t("welcome.tagline2")}
          </p>
        </div>
        <div className="relative flex animate-kb-float flex-wrap justify-center gap-3 px-6 pb-[26px]">
          <span className={chip}>
            <Icon icon={KB_ICONS.Mic} size={17} />
            {t("welcome.chipLang")}
          </span>
          {isNativeApp() && (
            <span className={chip}>
              <Icon icon={KB_ICONS.Printer} size={17} />
              58 / 80 mm
            </span>
          )}
        </div>
        <div className="relative px-6 pb-[max(36px,env(safe-area-inset-bottom))]">
          <button type="button" onClick={onStart} className="kb-hit kb-press flex min-h-[56px] w-full items-center justify-center gap-[10px] rounded-[16px] bg-kb-card text-kb-16 font-bold text-kb-primary-deep">
            {t("welcome.start")}
            <Icon icon={KB_ICONS.ArrowRight} size={20} />
          </button>
          <p className="mt-[14px] text-center text-kb-13 opacity-85">{t("welcome.madeFor")}</p>
        </div>
      </div>
    </main>
  );
}

const WAVE = [14, 26, 38, 22, 44, 30, 18, 36, 24, 12];
const ORDER_LINES = ["“2 किलो चीनी 45 रुपये किलो,", "चावल 5 किलो 340,", "1 टाटा नमक 30...”"]; // an order as said - the same in every language

/** 03's sample bill, built by the real receipt (units as the app writes them: "piece", never "pc" - D110 item 8). */
function sampleReceipt() {
  const at = new Date().toISOString();
  const line = (displayName: string, qty: number, unit: string, rate: number, total: number) => ({ displayName, qty, unit, ratePaise: (rate * 100) as Paise, rateUnit: unit, totalPaise: (total * 100) as Paise });
  return buildReceipt(
    { receiptNumber: "514", customerName: "Cash", totalPaise: 46_000 as Paise, finalizedAt: at, createdAt: at, status: "final" },
    [line("चीनी", 2, "kg", 45, 90), line("चावल", 5, "kg", 68, 340), line("टाटा नमक", 1, "piece", 30, 30)],
    { name: "Gupta Kirana Store", phone: null, logoUrl: null, billLanguage: "en" },
  );
}

function Illustration({ step }: { step: 1 | 2 | 3 }) {
  const { t } = useT();
  const label = "text-kb-12 font-semibold tracking-[.4px] uppercase";
  if (step === 1)
    return (
      <div className="mx-auto flex w-full max-w-[320px] animate-kb-float flex-col items-center gap-[18px]">
        <div className="self-stretch rounded-[22px_22px_22px_6px] bg-kb-card px-5 py-[18px] text-kb-19 leading-[1.65] shadow-kb-2">
          <div className={`${label} mb-1 text-kb-sub`}>{t("onb1.youSay")}</div>
          {ORDER_LINES.map((l) => (
            <div key={l}>{l}</div>
          ))}
        </div>
        <div className="flex items-center gap-4">
          <div className="hidden min-[360px]:block">
            <Waveform heights={WAVE} live height={48} />
          </div>
          <div aria-hidden="true" className="relative flex size-[104px] flex-none items-center justify-center">
            <div className="absolute inset-0 animate-kb-pulse rounded-full bg-kb-primary" />
            <div className="relative flex size-[88px] items-center justify-center rounded-full bg-kb-primary text-kb-card shadow-kb-mic">
              <Icon icon={KB_ICONS.Mic} size={40} />
            </div>
          </div>
          <div className="hidden min-[360px]:block">
            <Waveform heights={WAVE} live height={48} />
          </div>
        </div>
      </div>
    );
  if (step === 2) {
    // 03 floats the two chips over the receipt's edge; on our real receipt they would cover its words (the header, a line), so they sit
    // in a row on the torn edge, below the words - flagged for the owner's review (KB-415)
    const chip = "flex items-center gap-[6px] rounded-full border border-kb-border bg-kb-card px-3 py-2 text-kb-13 font-semibold shadow-kb-2";
    return (
      <div className="mx-auto flex w-fit max-w-full animate-kb-float flex-col items-center">
        <ReceiptPaper width={280} torn>
          <Receipt receipt={sampleReceipt()} />
        </ReceiptPaper>
        <div className="relative -mt-[6px] flex flex-wrap justify-center gap-3">
          {isNativeApp() && (
            <span className={chip}>
              <Icon icon={KB_ICONS.Printer} size={17} />
              {t("onb2.print")}
            </span>
          )}
          <span className={`${chip} text-kb-ok`}>
            <Icon icon={KB_ICONS.MessageCircle} size={17} />
            WhatsApp
          </span>
        </div>
      </div>
    );
  }
  // default 2 (owner + reviewer, 18 Nov 2026): the learning engine as it really works - a price seen on a few bills, approved once
  return (
    <div className="mx-auto flex w-full max-w-[316px] animate-kb-float flex-col items-center gap-3">
      <div className="self-stretch rounded-[18px] bg-kb-card px-4 py-[14px] shadow-kb-1">
        <div className={`${label} text-kb-sub`}>{t("onb3.said")}</div>
        <div className="mt-1 text-kb-17">
          “चीनी <b>45 रुपये</b> किलो”
        </div>
      </div>
      <div className="flex items-center gap-2 rounded-full bg-kb-card px-[14px] py-2 text-kb-13 font-semibold text-kb-ok shadow-kb-1">
        <Icon icon={KB_ICONS.Check} size={16} />
        {t("onb3.approve")}
      </div>
      <div className="self-stretch rounded-[18px] border-[1.5px] border-kb-primary bg-kb-card px-4 py-[14px] shadow-kb-primary">
        <div className={`${label} text-kb-primary normal-case`}>{t("onb3.next")} “2 किलो चीनी”</div>
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="text-kb-17 font-semibold">चीनी · 2 kg</div>
          <div className="text-kb-18 font-extrabold">₹90</div>
        </div>
        <div className="mt-2 inline-flex items-center gap-[6px] rounded-full bg-kb-warn-bg px-[10px] py-1 text-kb-12 font-semibold text-kb-warn-text">
          <Icon icon={KB_ICONS.Lightbulb} size={14} />
          {t("onb3.price")}
        </div>
      </div>
    </div>
  );
}

/** 02 / 03 / 04: "N of 3" + Skip, the illustration, the dots, the title, one line, Next (Get started on 3). */
function OnboardingPage({ step, onNext, onSkip }: { step: 1 | 2 | 3; onNext: () => void; onSkip: () => void }) {
  const { t } = useT();
  const title = t(step === 1 ? "onb1.title" : step === 2 ? "onb2.title" : "onb3.title");
  const text = step === 1 ? t("onb1.text") : step === 2 ? t(isNativeApp() ? "onb2.text" : "onb2.textWeb") : t("gen.tip");
  return (
    <main data-scroll-page className="font-kb fixed inset-0 overflow-y-auto bg-kb-bg text-kb-ink">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <div className="flex items-center justify-between px-5 pt-3">
          <span className="text-kb-14 font-semibold text-kb-sub">{t("welcome.step", { n: step })}</span>
          <button type="button" onClick={onSkip} className="kb-hit-icon flex min-h-[44px] items-center px-2 text-kb-15 font-semibold text-kb-sub">
            {t("welcome.skip")}
          </button>
        </div>
        <IllustrationPanel minHeight={440}>
          <Illustration key={step} step={step} />
        </IllustrationPanel>
        <div className="flex flex-1 flex-col gap-3 px-6 pt-[26px] pb-[max(32px,env(safe-area-inset-bottom))]">
          <div aria-hidden="true" className="flex gap-[6px]">
            {[1, 2, 3].map((i) => (
              <div key={i} className={`h-2 rounded-[4px] ${i === step ? "w-6 bg-kb-primary" : "w-2 bg-kb-border"}`} />
            ))}
          </div>
          <h1 key={`t${step}`} className="mt-1 animate-kb-up text-kb-30 leading-[1.15] font-extrabold tracking-[-0.6px]">
            {title}
          </h1>
          <p key={`p${step}`} className="animate-kb-up text-kb-16 leading-[1.55] text-kb-sub [animation-delay:.12s]">
            {text}
          </p>
          <div className="flex-1" />
          <Button variant="primary" height={56} icon={KB_ICONS.ArrowRight} iconSize={20} iconEnd onClick={onNext}>
            {step < 3 ? t("welcome.next") : t("welcome.start")}
          </Button>
        </div>
      </div>
    </main>
  );
}
