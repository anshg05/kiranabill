import { useState } from "react";
import { Share, X } from "lucide-react";
import { isIos, isStandalone } from "./platform";
import { useT } from "./useT";

// KB-346 (D90): Safari has no install prompt - the way in is Share, then Add to Home Screen. On an iPhone, in Safari (not
// the installed app), a quiet note says so while the bill is empty; it is dismissed for good with the X. Why it matters: an
// installed app is exempt from Safari's clean-up of a site that is not used for a while (WebKit, "Updates to Storage Policy").

const KEY = "kb.installHintDismissed";
const remembered = (): boolean => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function InstallHint({ eligible }: { eligible: boolean }) {
  const { t } = useT();
  const [dismissed, setDismissed] = useState(remembered);
  if (!eligible || dismissed || !isIos() || isStandalone()) return null;
  return (
    <div role="note" className="flex items-start gap-2 border-b border-line bg-surface pl-4 text-[13px] text-ink-soft">
      <Share size={16} strokeWidth={1.5} aria-hidden className="mt-3.5 shrink-0" />
      <p className="min-w-0 flex-1 py-3">{t("install.ios")}</p>
      <button
        type="button"
        aria-label={t("common.close")}
        onClick={() => {
          try {
            localStorage.setItem(KEY, "1");
          } catch {
            /* a private window: dismissed for this visit only */
          }
          setDismissed(true);
        }}
        className="flex size-11 shrink-0 items-center justify-center text-ink-soft"
      >
        <X size={18} strokeWidth={1.5} aria-hidden />
      </button>
    </div>
  );
}
