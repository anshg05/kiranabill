import { registerPlugin } from "@capacitor/core";
import { toBase64 } from "./printerClassic";

// KB-414 step 2 phone check (owner, 17 Nov 2026): the Android app's WebView has no share sheet (navigator.share is undefined) and drops
// every download, so the bill's Share / PDF / WhatsApp go through our own Kotlin plugin (android/.../FileSharePlugin.kt) - no npm
// package (B6). The browser never comes here (useReceiptShare).
// KB-414 step 3 phone check: a save answers WHERE it went (a content uri), and "Open" shows it in the phone's own viewer - the Xiaomi
// Files app's Downloads view lists a saved PDF but not a CSV, though both are in Download/ (read over USB).

interface FileSharePlugin {
  /** The phone's share sheet with the file - or straight to `app` (a package name) when it is installed, else the share sheet. */
  share(options: { name: string; mime: string; data: string; app?: string }): Promise<unknown>;
  /** Android 10+: the file into Downloads (saved: true, its uri). Older Android: saved: false, nothing written. Rejects SAVE_FAILED. */
  saveToDownloads(options: { name: string; mime: string; data: string }): Promise<{ saved: boolean; uri?: string }>;
  /** The saved file in the phone's viewer for its type. Rejects NO_APP when nothing can open it. */
  open(options: { uri: string; mime: string }): Promise<unknown>;
}

const FileShare = registerPlugin<FileSharePlugin>("FileShare");

export const WHATSAPP = "com.whatsapp";

const asPlugin = async (file: File) => ({ name: file.name, mime: file.type, data: toBase64(new Uint8Array(await file.arrayBuffer())) });

export async function shareFile(file: File, app?: string): Promise<void> {
  await FileShare.share({ ...(await asPlugin(file)), ...(app ? { app } : {}) });
}

export type SavedFile = { kind: "saved"; uri: string } | { kind: "shared" };

/** D58 "PDF always downloads": into Downloads; on Android 7-9 (no MediaStore Downloads) the share sheet with the file instead. */
export async function saveFile(file: File): Promise<SavedFile> {
  const options = await asPlugin(file);
  const r = await FileShare.saveToDownloads(options);
  if (r.saved && r.uri) return { kind: "saved", uri: r.uri };
  await FileShare.share(options);
  return { kind: "shared" };
}

export async function openFile(uri: string, mime: string): Promise<void> {
  await FileShare.open({ uri, mime });
}
