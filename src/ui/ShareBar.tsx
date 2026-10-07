import { useEffect, useState } from "react";
import { FileDown, ImageDown, MessageCircle, MessageSquareText } from "lucide-react";
import { parseIndianMobile } from "@/domain/customer";
import type { ReceiptShare } from "./useReceiptShare";

// KB-309 (D58): the four share buttons under a saved receipt - the saved
// screen and the bill detail (KB-310) both use them.

const label = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

/** KB-309 (D58, the legacy behaviour): four buttons under the saved receipt.
 * Image, PDF and WhatsApp wait for the files (rendered when the receipt is
 * shown); SMS opens its sheet. */
export function ShareBar({ share }: { share: ReceiptShare }) {
  const [smsOpen, setSmsOpen] = useState(false);
  const btn = "flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink aria-disabled:opacity-50";
  const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true, className: "text-ink-soft" } as const;
  return (
    <div className="mx-auto mt-3 w-full max-w-[384px]">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-disabled={!share.ready} onClick={share.downloadImage} className={btn}>
          <ImageDown {...icon} />
          Image
        </button>
        <button type="button" aria-disabled={!share.ready} onClick={share.downloadPdf} className={btn}>
          <FileDown {...icon} />
          PDF
        </button>
        <button type="button" aria-disabled={!share.ready} onClick={share.ready ? share.whatsApp : undefined} className={btn}>
          <MessageCircle {...icon} />
          WhatsApp
        </button>
        <button type="button" aria-expanded={smsOpen} onClick={() => setSmsOpen(true)} className={btn}>
          <MessageSquareText {...icon} />
          SMS
        </button>
      </div>
      {smsOpen && <SmsSheet share={share} onClose={() => setSmsOpen(false)} />}
    </div>
  );
}

/** KB-309: the SMS number - the stored bill's mobile when it has one, else
 * typed. D52 rules; Send only when valid. Never stored (the bill is final). */
function SmsSheet({ share, onClose }: { share: ReceiptShare; onClose: () => void }) {
  const [value, setValue] = useState("");
  useEffect(() => {
    let live = true;
    share
      .storedMobile()
      .then((mobile) => {
        if (live && mobile) setValue(mobile);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // once, when the sheet opens
  }, []);
  const parsed = parseIndianMobile(value);
  const mobile = parsed.ok ? parsed.value : null;
  return (
    <section aria-label="Send SMS" className="mt-3 rounded-[6px] border border-line bg-surface p-3">
      <label className="flex flex-col gap-1">
        <span className={label}>Mobile</span>
        <input
          type="tel"
          inputMode="tel"
          autoComplete="off"
          aria-label="Mobile for SMS"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-11 rounded-[6px] border border-line px-3 tabular-nums"
        />
      </label>
      {!parsed.ok && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {parsed.error}
        </p>
      )}
      <pre data-testid="sms-preview" className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] bg-paper p-2 font-mono text-[12px] text-ink-soft">
        {share.smsText}
      </pre>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-[6px] border border-line px-3 font-medium">
          Cancel
        </button>
        <button
          type="button"
          aria-disabled={mobile === null}
          onClick={() => {
            if (mobile) share.sendSms(mobile);
          }}
          className="min-h-11 rounded-[6px] bg-ink px-3 font-semibold text-surface aria-disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </section>
  );
}

