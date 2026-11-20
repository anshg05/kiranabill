import { useEffect, useRef, useState } from "react";
import { openAppSettings, setPermissionHost, type PermissionKind } from "@/data/appShell";
import { Badge } from "./kit/Badge";
import { BottomSheet } from "./kit/BottomSheet";
import { Button } from "./kit/Button";
import { Icon, KB_ICONS } from "./kit/icons";
import { useT } from "./useT";

// KB-425 (owner, 20 Nov 2026; D123): screen 07's card, ONE permission at a time, just before Android's own prompt (src/data/appShell.ts
// beforeAsking) - and, when Android will not ask again, the same sheet with Open Settings. Mounted once (App.tsx), inside the app only.

const CARD = {
  microphone: { icon: KB_ICONS.Mic, title: "perm.mic.title", badge: "perm.mic.badge", text: "perm.mic.text", off: "perm.mic.off", offText: "perm.mic.offText" },
  nearby: { icon: KB_ICONS.Bluetooth, title: "perm.nearby.title", badge: "perm.nearby.badge", text: "perm.nearby.text", off: "perm.nearby.off", offText: "perm.nearby.offText" },
} as const;

interface Open {
  kind: PermissionKind;
  sheet: "explain" | "settings";
  done: (choice: "allow" | "close") => void;
}

export function PermissionSheetHost() {
  const [open, setOpen] = useState<Open | null>(null);
  const openRef = useRef<Open | null>(null);
  useEffect(
    () =>
      setPermissionHost(
        (kind, sheet) =>
          new Promise((resolve) => {
            openRef.current?.done("close"); // never two at once
            const next: Open = { kind, sheet, done: (choice) => { openRef.current = null; setOpen(null); resolve(choice); } };
            openRef.current = next;
            setOpen(next);
          }),
      ),
    [],
  );
  return open ? <PermissionSheet kind={open.kind} sheet={open.sheet} onChoice={open.done} /> : null;
}

export function PermissionSheet({ kind, sheet, onChoice, position }: { kind: PermissionKind; sheet: "explain" | "settings"; onChoice: (c: "allow" | "close") => void; position?: "fixed" | "static" }) {
  const { t } = useT();
  const c = CARD[kind];
  const explain = sheet === "explain";
  return (
    <BottomSheet backKey={`kbPerm-${kind}`} title={explain ? t(c.title) : t(c.off)} intro={explain ? t("perm.sub") : t(c.offText)} onClose={() => onChoice("close")} position={position}>
      {explain && (
        <div className="flex items-start gap-3 rounded-[16px] border border-kb-border bg-kb-card p-[14px]">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[12px] bg-kb-primary-pale text-kb-primary">
            <Icon icon={c.icon} size={20} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <span>
              <Badge kind="small">{t(c.badge)}</Badge>
            </span>
            <span className="text-kb-15 leading-[1.45]">{t(c.text)}</span>
          </span>
        </div>
      )}
      {explain ? (
        <>
          <Button variant="primary" height={54} onClick={() => onChoice("allow")}>
            {t("perm.allow")}
          </Button>
          <Button variant="secondary" height={50} onClick={() => onChoice("close")}>
            {t("perm.notNow")}
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="primary"
            height={54}
            onClick={() => {
              openAppSettings();
              onChoice("close");
            }}
          >
            {t("perm.openSettings")}
          </Button>
          <Button variant="secondary" height={50} onClick={() => onChoice("close")}>
            {t("common.close")}
          </Button>
        </>
      )}
    </BottomSheet>
  );
}
