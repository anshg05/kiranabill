import { isNativeApp } from "@/data/nativeSignIn";
import { BUILD_ID } from "@/pwa/buildId";
import { Icon, KB_ICONS } from "./kit/icons";
import { GroupLabel, ListCard, ListRow } from "./kit/ListRow";
import { InnerPage } from "./InnerPage";
import { privacyHref } from "./privacyLink";
import { useT } from "./useT";

// SG-27 (owner, 20 Nov 2026; D124): More -> Help & support. How to use - short steps, each true of today's app; the screen names they
// quote are the app's own labels (t("…")), so a renamed button changes the help text with it. Contact: email only, the build id in the
// subject, the reply time. Static: it works offline (only sending the email needs the internet).

export const SUPPORT_EMAIL = "kiranavoicebill@gmail.com";

export function HelpPage({ onClose }: { onClose: () => void }) {
  const { t } = useT();
  const labels = {
    finalise: t("bill.finalise"),
    bills: t("history.billsLabel"),
    cancel: t("cancel.andNew"),
    items: t("nav.items"),
    more: t("order.more"),
    printer: t("settings.printer"),
    choose: t("settings.printerChoose"),
  };
  const steps = (
    [
      ["onb1.title", "help.s1d"], // the onboarding's own words
      ["help.s2", "help.s2d"],
      ["help.s3", "help.s3d"],
      ["help.s4", "help.s4d"],
      ["help.s5", "help.s5d"],
      ["help.s6", "help.s6d"],
      ["help.s7", "help.s7d"],
      ["help.s8", "help.s8d"],
    ] as const
  ).filter(([title]) => title !== "help.s8" || isNativeApp()); // printing is in the Android app only
  const subject = encodeURIComponent(`Kirana Voice Bill help (${BUILD_ID})`);
  return (
    <InnerPage title={t("help.row")} backKey="kbHelp" onClose={onClose}>
      <h2 className="text-kb-18 font-extrabold">{t("help.how")}</h2>
      <ol aria-label={t("help.how")} className="flex flex-col gap-3">
        {steps.map(([title, text], i) => (
          <li key={title} className="flex gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
            <span aria-hidden="true" className="flex h-[28px] w-[28px] flex-none items-center justify-center rounded-full bg-kb-primary-pale text-kb-13 font-bold text-kb-primary">
              {i + 1}
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <h3 className="text-kb-15 font-bold">{t(title, labels)}</h3>
              <p className="text-kb-14 leading-[1.5] text-kb-sub">{t(text, labels)}</p>
            </span>
          </li>
        ))}
      </ol>
      <GroupLabel>{t("help.contact")}</GroupLabel>
      <a
        href={`mailto:${SUPPORT_EMAIL}?subject=${subject}`}
        className="kb-hit flex min-h-[54px] items-center justify-center gap-2 rounded-[16px] bg-kb-primary px-4 text-kb-15 font-bold text-white"
      >
        <Icon icon={KB_ICONS.MessageCircle} size={20} />
        {t("help.email", { email: SUPPORT_EMAIL })}
      </a>
      <p className="text-kb-13 text-kb-sub">{t("help.reply")}</p>
      <ListCard>
        <ListRow icon={KB_ICONS.ShieldCheck} title={t("more.privacy")} href={privacyHref()} />
      </ListCard>
    </InnerPage>
  );
}
