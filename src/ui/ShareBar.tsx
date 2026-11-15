import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { FileDown, ImageDown, MessageCircle, MessageSquareText, type LucideIcon } from "lucide-react";
import { Icon, KB_ICONS } from "./kit/icons";
import { parseIndianMobile } from "@/domain/customer";
import type { ReceiptShare } from "./useReceiptShare";
import { useT } from "./useT";

// KB-309 (D58): the four share buttons under a saved receipt - the saved
// screen and the bill detail (KB-310) both use them.

const label = "text-[13px] font-medium tracking-[0.02em] text-ink-soft";

/** KB-309 (D58, the legacy behaviour): four buttons under the saved receipt.
 * Image, PDF and WhatsApp wait for the files (rendered when the receipt is
 * shown); SMS opens its sheet. */
export function ShareBar({ share, look }: { share: ReceiptShare; look?: "tiles" }) {
  const [smsOpen, setSmsOpen] = useState(false);
  const { t } = useT();
  if (look === "tiles") return <ShareTiles share={share} smsOpen={smsOpen} onSms={() => setSmsOpen(true)} onCloseSms={() => setSmsOpen(false)} />;
  const btn = "flex min-h-11 w-full items-center justify-center gap-2 rounded-[6px] border border-line bg-surface px-3 font-medium text-ink aria-disabled:opacity-50";
  const icon = { size: 20, strokeWidth: 1.5, "aria-hidden": true, className: "text-ink-soft" } as const;
  return (
    <div className="mx-auto mt-3 w-full max-w-[384px]">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" aria-disabled={!share.ready} onClick={share.downloadImage} className={btn}>
          <ImageDown {...icon} />
          {t("share.image")}
        </button>
        <button type="button" aria-disabled={!share.ready} onClick={share.downloadPdf} className={btn}>
          <FileDown {...icon} />
          {t("share.pdf")}
        </button>
        <button type="button" aria-disabled={!share.ready} onClick={share.ready ? share.whatsApp : undefined} className={btn}>
          <MessageCircle {...icon} />
          {t("share.whatsapp")}
        </button>
        <button type="button" aria-expanded={smsOpen} onClick={() => setSmsOpen(true)} className={btn}>
          <MessageSquareText {...icon} />
          {t("share.sms")}
        </button>
      </div>
      {!share.ready && <p className="mt-2 text-center text-[13px] text-ink-soft">{t("reason.preparing")}</p>}
      {smsOpen && <SmsSheet share={share} onClose={() => setSmsOpen(false)} />}
    </div>
  );
}

/**
 * KB-413 step 4 (owner, 16 Nov 2026): 13-BillSaved's tiles - WhatsApp (green), PDF, Share, SMS: 72 high, radius 16, white with the
 * border, a 22 px icon over 13 / 700 words. Nothing removed: Share is the phone's share sheet with the bill image (the download where
 * files cannot be shared). One row as drawn; when a bigger text size makes a word wider than its tile, two rows of two (never cut).
 */
function ShareTiles({ share, smsOpen, onSms, onCloseSms }: { share: ReceiptShare; smsOpen: boolean; onSms: () => void; onCloseSms: () => void }) {
  const { t } = useT();
  const row = useRef<HTMLDivElement>(null);
  const [twoRows, setTwoRows] = useState(false);
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    // the words never wrap (nowrap), so their own width says whether four fit side by side - it does not depend on the layout chosen
    const check = () => {
      if (el.clientWidth === 0) return;
      const tile = (el.clientWidth - 3 * 10) / 4 - 8;
      setTwoRows([...el.querySelectorAll("[data-tile-word]")].some((w) => (w as HTMLElement).scrollWidth > tile));
    };
    check();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tile = (key: string, label: string, icon: LucideIcon, onClick: (() => void) | undefined, opts: { disabled?: boolean; ok?: boolean; expanded?: boolean } = {}) => (
    <button
      key={key}
      type="button"
      aria-disabled={opts.disabled}
      aria-expanded={opts.expanded}
      onClick={opts.disabled ? undefined : onClick}
      className={`kb-hit kb-press flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-[6px] rounded-[16px] border border-kb-border bg-kb-card px-1 text-kb-13 font-bold aria-disabled:opacity-50 ${opts.ok ? "text-kb-ok" : "text-kb-ink"}`}
    >
      <Icon icon={icon} size={22} />
      <span data-tile-word className="whitespace-nowrap">{label}</span>
    </button>
  );
  return (
    <div className="font-kb">
      <div ref={row} className={`grid gap-[10px] [--kb-gap-x:10px] [--kb-gap-y:10px] ${twoRows ? "grid-cols-2" : "grid-cols-4"}`}>
        {tile("whatsapp", t("share.whatsapp"), KB_ICONS.MessageCircle, share.whatsApp, { disabled: !share.ready, ok: true })}
        {tile("pdf", t("share.pdf"), KB_ICONS.FileText, share.downloadPdf, { disabled: !share.ready })}
        {tile("share", t("share.share"), KB_ICONS.Share2, share.shareImage, { disabled: !share.ready })}
        {tile("sms", t("share.sms"), MessageSquareText, onSms, { expanded: smsOpen })}
      </div>
      {!share.ready && <p className="mt-2 text-center text-kb-13 text-kb-sub">{t("reason.preparing")}</p>}
      {smsOpen && <SmsSheet share={share} onClose={onCloseSms} />}
    </div>
  );
}

/** KB-309: the SMS number - the stored bill's mobile when it has one, else
 * typed. D52 rules; Send only when valid. Never stored (the bill is final). */
function SmsSheet({ share, onClose }: { share: ReceiptShare; onClose: () => void }) {
  const { t, tx } = useT();
  const [value, setValue] = useState("");
  const [copied, setCopied] = useState(false);
  const sheet = useRef<HTMLElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // KB-342: the sheet opens below the buttons, off screen on a small phone - bring it into view and put the cursor in the number.
  useEffect(() => {
    sheet.current?.scrollIntoView?.({ block: "nearest" });
    field.current?.focus({ preventScroll: true });
  }, []);
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
    <section ref={sheet} aria-label={t("share.sendLabel")} className="mt-3 rounded-[6px] border border-line bg-surface p-3">
      <label className="flex flex-col gap-1">
        <span className={label}>{t("share.mobile")}</span>
        <input
          ref={field}
          type="tel"
          inputMode="tel"
          autoComplete="off"
          aria-label={t("share.mobileLabel")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="min-h-11 rounded-[6px] border border-line px-3 tabular-nums"
        />
      </label>
      {!parsed.ok && (
        <p role="alert" className="mt-1 text-[13px] text-danger">
          {tx(parsed.error)}
        </p>
      )}
      {mobile === null && parsed.ok && <p className="mt-1 text-[13px] text-ink-soft">{t("reason.smsNumber")}</p>}
      {typeof navigator !== "undefined" && navigator.clipboard?.writeText && (
        <div className="mt-2 flex items-center gap-3">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(share.smsText).then(() => setCopied(true)).catch(() => setCopied(false));
            }}
            className="min-h-11 rounded-[6px] border border-line px-3 font-medium"
          >
            {t("share.copy")}
          </button>
          {copied && <span role="status" className="text-[13px] text-ok">{t("share.copied")}</span>}
        </div>
      )}
      <pre data-testid="sms-preview" className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-[6px] bg-paper p-2 font-mono text-[12px] text-ink-soft">
        {share.smsText}
      </pre>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-[6px] border border-line px-3 font-medium">
          {t("common.cancel")}
        </button>
        <button
          type="button"
          aria-disabled={mobile === null}
          onClick={() => {
            if (mobile) share.sendSms(mobile);
          }}
          className="min-h-11 rounded-[6px] bg-ink px-3 font-semibold text-surface aria-disabled:opacity-50"
        >
          {t("share.send")}
        </button>
      </div>
    </section>
  );
}

