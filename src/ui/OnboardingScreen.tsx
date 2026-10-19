import { useState } from "react";
import { useShop } from "@/providers/ShopProvider";
import { useT } from "./useT";

/**
 * S2 (05-FRONTEND-SPEC.md): shop name/phone, catalog choice. Logo upload
 * is KB-107b's own work (a distinct Storage/security surface) - not built
 * here. The field is intentionally absent rather than present-but-fake.
 */
const SETUP_OFFLINE = "Setting up a shop needs an internet connection."; // ShopProvider's wording
const SETUP_FAILED = "Couldn't set up the shop — check the internet and try again";

export function OnboardingScreen() {
  const { createShop } = useShop();
  const { t, tx } = useT();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChoice = (catalogChoice: "ready" | "empty") => {
    if (!name.trim()) {
      setError("Shop name is required.");
      return;
    }
    setError(null);
    setSubmitting(true);
    createShop({
      name: name.trim(),
      phone: phone.trim() || null,
      catalogChoice,
      // KB-315: no deviceId here any more - ShopProvider uses the device's
      // persistent id (device.ts), not a throwaway UUID (KI-32).
    }).catch((err) => {
      setSubmitting(false);
      // The one message written for the shopkeeper (ShopProvider) keeps its sentence; anything else is a developer's text.
      console.warn("[setup] could not create the shop:", err instanceof Error ? err.name : "error");
      setError(err instanceof Error && err.message === SETUP_OFFLINE ? err.message : SETUP_FAILED);
    });
  };

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">{t("onboard.title")}</h1>

      {/* KB-343: a label that stays while typing; the placeholder is only an example. */}
      <label className="flex w-full max-w-sm flex-col gap-1">
        <span className="text-[13px] font-medium text-ink-soft">{t("settings.shopName")}</span>
        <input
          type="text"
          placeholder="Sharma Kirana Store"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          className="w-full rounded-lg border border-line min-h-11 px-4 py-2"
        />
      </label>
      <label className="flex w-full max-w-sm flex-col gap-1">
        <span className="text-[13px] font-medium text-ink-soft">{t("onboard.phone")}</span>
        <input
          type="tel"
          placeholder="98765 43210"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          disabled={submitting}
          className="w-full rounded-lg border border-line min-h-11 px-4 py-2"
        />
      </label>

      <p className="text-ink-soft text-sm">{t("onboard.question")}</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleChoice("ready")}
          disabled={submitting}
          className="rounded-lg bg-indigo min-h-11 px-4 py-2 text-white font-medium"
        >
          {t("onboard.ready")}
        </button>
        <button
          type="button"
          onClick={() => handleChoice("empty")}
          disabled={submitting}
          className="rounded-lg border border-line min-h-11 px-4 py-2 font-medium"
        >
          {t("onboard.empty")}
        </button>
      </div>

      {error && <p role="alert" className="text-danger text-sm">{tx(error)}</p>}
    </div>
  );
}
