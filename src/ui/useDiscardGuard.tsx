import { useRef, useState, type ReactNode } from "react";
import { ConfirmDialog } from "./OfflineUi";
import { useT } from "./useT";

/**
 * KB-343 (owner): Back (the arrow, Escape and Android Back) in Edit / Add product with typed changes asks "Discard changes?";
 * with none it just closes. Catalog sheets only - never during billing. `canClose` goes to useBackEntry (Android Back);
 * `requestClose` is for the arrow and Escape; `dialog` is the question, to be rendered inside the sheet.
 */
export function useDiscardGuard(dirty: boolean, onClose: () => void): { requestClose: () => void; canClose: () => boolean; dialog: ReactNode } {
  const { t } = useT();
  const [asking, setAsking] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const canClose = () => {
    if (!dirtyRef.current) return true;
    setAsking(true);
    return false;
  };
  const dialog = asking ? (
    <ConfirmDialog title="Discard changes?" lines={["What you typed here will be lost."]} confirmLabel={t("discard.confirm")} onCancel={() => setAsking(false)} onConfirm={onClose} />
  ) : null;
  return { requestClose: () => void (canClose() && onClose()), canClose, dialog };
}
