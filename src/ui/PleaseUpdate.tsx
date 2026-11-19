import { useState } from "react";
import type { KiranaBillDB } from "@/data/db";
import { Button } from "./kit/Button";
import { Logo } from "./kit/Logo";
import { useSyncChip } from "./useSyncChip";
import { useT } from "./useT";
import { useVersionGate } from "./VersionGate";

/**
 * D116 (owner, 19 Nov 2026): the app is below app_min_version - a hard block. Mounted INSIDE the shop loader when a shop is open
 * (App.tsx), so the sync loop keeps uploading behind it; it shows how many bills have not reached the server. No Sign out: a sign-out
 * could lose them. Update goes to app_min_version.update_url in the phone's browser (none yet: "Ask for the new version").
 */
export function PleaseUpdate({ localDb }: { localDb: KiranaBillDB | null }) {
  const { t } = useT();
  const { updateUrl, checkAgain } = useVersionGate();
  const { unsynced } = useSyncChip(localDb);
  const [checking, setChecking] = useState(false);
  const waiting = unsynced.pending + unsynced.conflict;
  const onCheck = () => {
    if (checking) return;
    setChecking(true);
    void checkAgain().finally(() => setChecking(false));
  };
  return (
    <main className="min-h-screen bg-kb-bg text-kb-ink flex flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo size={76} />
      <h1 className="text-kb-22 font-bold">{t("update.title")}</h1>
      <p className="text-kb-15 text-kb-sub">{t("update.body")}</p>
      {localDb &&
        (waiting > 0 ? (
          <div className="text-kb-14">
            <p className="font-semibold">{t(waiting === 1 ? "sync.pending.one" : "sync.pending.many", { n: waiting })}</p>
            <p className="text-kb-sub">{t("update.keepOpen")}</p>
          </div>
        ) : (
          <p className="text-kb-14 text-kb-sub">{t("update.allUploaded")}</p>
        ))}
      <div className="flex w-full max-w-sm flex-col gap-3">
        {updateUrl ? (
          <a href={updateUrl} target="_blank" rel="noopener" className="font-kb kb-press kb-hit flex min-h-[54px] w-full items-center justify-center rounded-[16px] bg-kb-primary text-kb-16 font-bold text-kb-card shadow-kb-primary">
            {t("update.button")}
          </a>
        ) : (
          <p className="text-kb-15 font-semibold">{t("update.ask")}</p>
        )}
        <Button variant="secondary" ariaDisabled={checking} onClick={onCheck}>
          {checking ? t("update.checking") : t("update.checkAgain")}
        </Button>
      </div>
    </main>
  );
}
