import { useCallback, useEffect } from "react";
import type { DeviceDB } from "@/data/device";
import { requestPersistentStorage } from "@/data/storagePersist";

// KB-401 (KI-68, D67): ask for persistent storage once the shopkeeper is signed in and the shop has loaded (the
// billing screen mounting), on `appinstalled`, and - through the returned function - after each saved bill. It
// returns at once when already granted. Never shown to the shopkeeper; Settings -> Developer mode reports the answer.
export function usePersistentStorage(deviceDb: DeviceDB | null): () => void {
  const request = useCallback(() => {
    if (!deviceDb) return;
    const storage = typeof navigator === "undefined" ? undefined : navigator.storage;
    void requestPersistentStorage(deviceDb, storage).catch(() => undefined);
  }, [deviceDb]);
  useEffect(() => {
    request();
    window.addEventListener("appinstalled", request);
    return () => window.removeEventListener("appinstalled", request);
  }, [request]);
  return request;
}
