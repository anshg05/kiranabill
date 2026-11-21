import { privacyHref, termsHref } from "./privacyLink";
import { isTestApp, testSignInHint } from "@/data/testApp";
import { useEffect, useState } from "react";
import { FAILED_TEXT, REFUSED_TEXT, readOAuthReturn, stripOAuthReturn } from "@/data/oauthReturn";
import { useT } from "./useT";
import { APP_NAME } from "./appName";
import { useAuth } from "@/providers/AuthProvider";
import { useUpdateGate } from "@/pwa/updateGate";
import { DevEmailSignIn, isLocalSupabaseUrl } from "./DevEmailSignIn";
import { isNativeApp } from "@/data/nativeSignIn";
import { Icon, KB_ICONS } from "./kit/icons";
import { Logo } from "./kit/Logo";
import { IllustrationPanel } from "./kit/IllustrationPanel";

/** S1 (05-FRONTEND-SPEC.md): Google sign-in only. (A dev-only email form
 * appears against a LOCAL Supabase stack - DevEmailSignIn.tsx.) */
const START_FAILED = "Couldn't start sign-in — check the internet and try again";

export function SignInScreen() {
  const { signInWithGoogle } = useAuth();
  const { t, tx } = useT();
  // KB-335 (D82): the marks of a refused or failed sign-in in the address bar - one plain sentence, then cleared.
  const [error, setError] = useState<string | null>(() => {
    const returned = readOAuthReturn(window.location.href);
    return returned === "refused" ? REFUSED_TEXT : returned === "failed" ? FAILED_TEXT : null;
  });
  useEffect(() => {
    const clean = stripOAuthReturn(window.location.href);
    if (clean !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", clean);
  }, []);
  useUpdateGate(true); // KB-401: nothing here to lose - a waiting update may apply

  // KB-342: one tap starts one sign-in (a second OAuth start could overwrite the first one's code verifier), and the button says it is working.
  const [opening, setOpening] = useState(false);
  const handleClick = () => {
    if (opening) return;
    setError(null);
    setOpening(true);
    signInWithGoogle()
      .then((answer) => {
        if (answer === "returned") setOpening(false); // KB-409, in the app: the Custom Tab is done with no sign-in - the tap comes back
      })
      .catch((err: unknown) => {
        setOpening(false);
        console.warn("[signin] could not start:", err instanceof Error ? err.name : "error"); // the raw text is for developers, not the shopkeeper (KB-343)
        setError(START_FAILED);
      });
  };

  const chip = "flex items-center gap-[6px] rounded-full bg-kb-card px-3 py-[7px] text-kb-13 font-semibold";
  const trust = [
    { icon: KB_ICONS.Cloud, text: t("signin.trust1") },
    { icon: KB_ICONS.Devices, text: t("signin.trust2") },
    { icon: KB_ICONS.ShieldTick, text: t("signin.trust3") },
  ];
  // KB-415 (owner + reviewer, 18 Nov 2026): 05's look - the hero panel, the title, the three true rows, the white Google button, the
  // privacy link alone (default 6: no "you agree" - that is KB-347's lawyer review); Print only inside the Android app (default 7).
  return (
    <main data-scroll-page className="font-kb fixed inset-0 overflow-y-auto bg-kb-bg text-kb-ink">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <IllustrationPanel minHeight={300}>
          <div className="flex flex-col items-center gap-4">
            <Logo size={76} shadow alt={`${APP_NAME} logo`} />
            <div className="text-center text-kb-26 leading-[1.2] font-extrabold tracking-[-0.5px]">{APP_NAME}</div>
            <div className="flex flex-wrap justify-center gap-2">
              <span className={chip}>
                <Icon icon={KB_ICONS.Mic} size={15} />
                {t("signin.speak")}
              </span>
              <span className={chip}>
                <Icon icon={KB_ICONS.ReceiptText} size={15} />
                {t("bill.savedBefore")}
              </span>
              {isNativeApp() && (
                <span className={chip}>
                  <Icon icon={KB_ICONS.Printer} size={15} />
                  {t("onb2.print")}
                </span>
              )}
            </div>
          </div>
        </IllustrationPanel>
        <div className="flex flex-1 flex-col gap-5 px-6 pt-[26px] pb-[max(32px,env(safe-area-inset-bottom))]">
          <div className="flex animate-kb-up flex-col gap-2">
            <h1 className="text-kb-28 font-extrabold tracking-[-0.5px]">{t("signin.title")}</h1>
            <p className="text-kb-16 text-kb-sub">{t("signin.sub")}</p>
          </div>
          <ul className="flex animate-kb-up flex-col gap-3 [animation-delay:.12s]">
            {trust.map((r) => (
              <li key={r.text} className="flex items-center gap-3 text-kb-15">
                <span className="flex size-9 flex-none items-center justify-center rounded-[10px] border border-kb-border bg-kb-card text-kb-primary">
                  <Icon icon={r.icon} size={18} />
                </span>
                {r.text}
              </li>
            ))}
          </ul>
          <div className="flex-1" />
          {error && (
            <p role="alert" className="text-kb-14 text-kb-err">
              {error === REFUSED_TEXT ? t("signin.refused") : error === FAILED_TEXT ? t("signin.unfinished") : tx(error)}
            </p>
          )}
          {isTestApp() && <p className="text-center text-kb-14 font-bold text-kb-err">{testSignInHint()}</p>}
          <button
            type="button"
            onClick={handleClick}
            aria-disabled={opening}
            className="kb-hit kb-press box-content flex min-h-[56px] items-center justify-center gap-3 rounded-[16px] border-[1.5px] border-kb-border bg-kb-card text-kb-16 font-bold text-kb-ink shadow-kb-1 aria-disabled:opacity-50"
          >
            <GoogleMark />
            {opening ? t("signin.opening") : t("signin.google")}
          </button>
          <p className="text-center text-kb-13 text-kb-sub">
            <a href={privacyHref()} target="_blank" rel="noopener" className="kb-hit-icon inline-flex min-h-[44px] items-center font-semibold text-kb-primary underline">
              {t("signin.privacy")}
            </a>
            {/* KB-435 (D126): a plain link beside Privacy - nothing to agree to, sign-in unchanged */}
            {" · "}
            <a href={termsHref()} target="_blank" rel="noopener" className="kb-hit-icon inline-flex min-h-[44px] items-center font-semibold text-kb-primary underline">
              {t("more.terms")}
            </a>
          </p>
          {import.meta.env.DEV && isLocalSupabaseUrl(import.meta.env.VITE_SUPABASE_URL) && <DevEmailSignIn />}
        </div>
      </div>
    </main>
  );
}

/** 05-SignIn's Google "G", in Google's own four colours (a brand mark - not a design token). */
function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <path fill="#4285F4" d="M22 12.2c0-.7-.1-1.4-.2-2H12v3.9h5.6a4.8 4.8 0 0 1-2.1 3.1v2.6h3.4c2-1.8 3.1-4.5 3.1-7.6z" />
      <path fill="#34A853" d="M12 22c2.8 0 5.2-.9 6.9-2.5l-3.4-2.6c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.7v2.7A10 10 0 0 0 12 22z" />
      <path fill="#FBBC05" d="M6.2 13.6a6 6 0 0 1 0-3.9V7H2.7a10 10 0 0 0 0 9z" />
      <path fill="#EA4335" d="M12 5.9c1.5 0 2.9.5 4 1.5l3-3A10 10 0 0 0 2.7 7l3.5 2.7C7 7.7 9.3 5.9 12 5.9z" />
    </svg>
  );
}
