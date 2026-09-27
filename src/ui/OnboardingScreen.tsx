import { useState } from "react";
import { useShop } from "@/providers/ShopProvider";

/**
 * S2 (05-FRONTEND-SPEC.md): shop name/phone, catalog choice. Logo upload
 * is KB-107b's own work (a distinct Storage/security surface) - not built
 * here. The field is intentionally absent rather than present-but-fake.
 */
export function OnboardingScreen() {
  const { createShop } = useShop();
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
      setError(err instanceof Error ? err.message : String(err));
    });
  };

  return (
    <div className="min-h-screen bg-paper text-ink font-body flex flex-col items-center justify-center gap-4 px-4">
      <h1 className="text-2xl font-semibold">Set up your shop</h1>

      <input
        type="text"
        placeholder="Shop name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={submitting}
        className="w-full max-w-sm rounded-lg border border-line px-4 py-2"
      />
      <input
        type="tel"
        placeholder="Phone (optional)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        disabled={submitting}
        className="w-full max-w-sm rounded-lg border border-line px-4 py-2"
      />

      <p className="text-ink-soft text-sm">Ready catalog, or start empty?</p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => handleChoice("ready")}
          disabled={submitting}
          className="rounded-lg bg-indigo px-4 py-2 text-white font-medium"
        >
          Use ready catalog
        </button>
        <button
          type="button"
          onClick={() => handleChoice("empty")}
          disabled={submitting}
          className="rounded-lg border border-line px-4 py-2 font-medium"
        >
          Start empty
        </button>
      </div>

      {error && <p className="text-danger text-sm">{error}</p>}
    </div>
  );
}
