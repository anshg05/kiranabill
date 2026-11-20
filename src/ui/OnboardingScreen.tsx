import { useRef, useState } from "react";
import { useShop } from "@/providers/ShopProvider";
import { useAuth } from "@/providers/AuthProvider";
import type { Paise } from "@/domain/money";
import { buildReceipt } from "@/domain/receipt";
import { parseShopPhone } from "@/domain/shopSettings";
import { Badge } from "./kit/Badge";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { ReceiptPaper } from "./kit/ReceiptPaper";
import { TextField } from "./kit/TextField";
import { TopBar } from "./kit/TopBar";
import { Receipt } from "./Receipt";
import { useBackEntry } from "./useBackEntry";
import { useT } from "./useT";

/**
 * S2 (05-FRONTEND-SPEC.md): shop name/phone, catalog choice. Logo upload
 * is KB-107b's own work (a distinct Storage/security surface) - not built
 * here. The field is intentionally absent rather than present-but-fake.
 *
 * KB-415 (owner + reviewer, 18 Nov 2026): 06-ShopSetup's look. Today's catalog question replaces the drawn "Continue" (default 3): Use
 * ready catalog (primary) / Start empty. The phone stays optional; when given it is a 10-digit mobile, as in Edit shop details
 * (default 5). The back arrow and Android Back sign out and return to Sign in (change 4: a wrong Google account can be changed - no
 * shop exists yet, nothing is lost). A live receipt shows the typed name and phone (Bill No. 1).
 */
const SETUP_OFFLINE = "Setting up a shop needs an internet connection."; // ShopProvider's wording
const SETUP_FAILED = "Couldn't set up the shop — check the internet and try again";
/** SG-20 (D121): the database's refusal in allowlist mode (shops_before_insert raises "signup_closed") - messages.ts onboard.invite */
const SETUP_INVITE = "Sign-ups are by invitation right now. Write to kiranavoicebill@gmail.com from this Google account.";
const isSignupClosed = (err: unknown) => typeof err === "object" && err !== null && ((err as { message?: unknown }).message === "signup_closed" || (err as { hint?: unknown }).hint === "signup_closed");

/** 06's sample lines, built by the real receipt (units as the app writes them - D110 item 8). */
function previewReceipt(name: string, phone: string | null) {
  const at = new Date().toISOString();
  const line = (displayName: string, qty: number, unit: string, rate: number, total: number) => ({ displayName, qty, unit, ratePaise: (rate * 100) as Paise, rateUnit: unit, totalPaise: (total * 100) as Paise });
  return buildReceipt(
    { receiptNumber: "1", customerName: "Cash", totalPaise: 54_400 as Paise, finalizedAt: at, createdAt: at, status: "final" },
    [line("चावल", 5, "kg", 68, 340), line("शक्कर", 3, "kg", 58, 174), line("टाटा नमक", 1, "piece", 30, 30)],
    { name, phone, logoUrl: null, billLanguage: "en" },
  );
}

export function OnboardingScreen() {
  const { createShop } = useShop();
  const { signOut } = useAuth();
  const { t, tx } = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // KB-348: a ref, not only the state - two taps in the same instant both see the old state.
  const asked = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // change 4: back = sign out (never while the shop is being made - that finishes first)
  const leave = () => {
    if (asked.current) return;
    void signOut().catch((err: unknown) => console.warn("[setup] sign-out failed:", err instanceof Error ? err.name : "error"));
  };
  useBackEntry("kbSetup", leave, () => !asked.current);

  const parsedPhone = phone.trim() ? parseShopPhone(phone) : null;
  const handleChoice = (catalogChoice: "ready" | "empty") => {
    if (!name.trim()) {
      setError("Shop name is required.");
      return;
    }
    if (parsedPhone && !parsedPhone.ok) {
      setError(parsedPhone.error);
      return;
    }
    if (asked.current) return;
    asked.current = true;
    setError(null);
    setSubmitting(true);
    createShop({
      name: name.trim(),
      phone: parsedPhone?.ok ? parsedPhone.value : null,
      catalogChoice,
      // KB-315: no deviceId here any more - ShopProvider uses the device's
      // persistent id (device.ts), not a throwaway UUID (KI-32).
    }).catch((err) => {
      asked.current = false;
      setSubmitting(false);
      // The one message written for the shopkeeper (ShopProvider) keeps its sentence; anything else is a developer's text.
      console.warn("[setup] could not create the shop:", err instanceof Error ? err.name : "error");
      setError(isSignupClosed(err) ? SETUP_INVITE : err instanceof Error && err.message === SETUP_OFFLINE ? err.message : SETUP_FAILED);
    });
  };

  const shownPhone = parsedPhone?.ok ? parsedPhone.value : null;
  return (
    <main data-scroll-page className="font-kb fixed inset-0 overflow-y-auto bg-kb-bg text-kb-ink">
      <div className="mx-auto flex min-h-full w-full max-w-[480px] flex-col">
        <TopBar title={t("onboard.title")} backLabel={t("settings.back")} onBack={leave} right={<Badge kind="almost">{t("onboard.almost")}</Badge>} />
        <div className="flex flex-1 flex-col gap-[14px] px-5 pt-3">
          <TextField label={t("settings.shopName")} icon={KB_ICONS.Store} height={54} value={name} onChange={setName} placeholder="Sharma Kirana Store" />
          <TextField label={t("onboard.phoneLabel")} labelNote={t("onboard.phoneNote")} prefix="+91" height={54} inputMode="tel" value={phone} onChange={setPhone} placeholder="98765 43210" />
          <figure aria-label={t("onboard.preview")} className="m-0 flex flex-col gap-[14px]">
            <figcaption className="mt-1 flex items-center gap-2 text-kb-13 font-bold tracking-[.4px] text-kb-sub uppercase">
              <Icon icon={KB_ICONS.ReceiptText} size={16} />
              {t("onboard.preview")}
            </figcaption>
            <div className="flex animate-kb-float justify-center">
              <ReceiptPaper width={330} torn>
                <Receipt receipt={previewReceipt(name.trim() || t("onboard.yourShop"), shownPhone)} />
              </ReceiptPaper>
            </div>
          </figure>
        </div>
        <div className="flex flex-col gap-3 px-5 pt-[14px] pb-[max(30px,env(safe-area-inset-bottom))]">
          {error && (
            <p role="alert" className="text-kb-14 text-kb-err">
              {tx(error)}
            </p>
          )}
          <p className="text-kb-15 font-semibold">{t("onboard.question")}</p>
          <Button variant="primary" height={56} ariaDisabled={submitting} onClick={submitting ? undefined : () => handleChoice("ready")}>
            {t("onboard.ready")}
          </Button>
          <Button variant="secondary" height={52} ariaDisabled={submitting} onClick={submitting ? undefined : () => handleChoice("empty")}>
            {t("onboard.empty")}
          </Button>
        </div>
      </div>
    </main>
  );
}
