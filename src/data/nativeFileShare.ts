import { registerPlugin } from "@capacitor/core";
import { toBase64 } from "./printerClassic";

// KB-414 step 2 phone check (owner, 17 Nov 2026): the Android app's WebView has no share sheet (navigator.share is undefined) and drops
// every download, so the bill's Share / PDF / WhatsApp go through our own Kotlin plugin (android/.../FileSharePlugin.kt) - no npm
// package (B6). The browser never comes here (useReceiptShare).

interface FileSharePlugin {
  /** The phone's share sheet with the file - or straight to `app` (a package name) when it is installed, else the share sheet. */
  share(options: { name: string; mime: string; data: string; app?: string }): Promise<unknown>;
  /** Android 10+: the file into Downloads (saved: true). Older Android: saved: false, nothing written. Rejects SAVE_FAILED. */
  saveToDownloads(options: { name: string; mime: string; data: string }): Promise<{ saved: boolean }>;
}

const FileShare = registerPlugin<FileSharePlugin>("FileShare");

export const WHATSAPP = "com.whatsapp";

const asPlugin = async (file: File) => ({ name: file.name, mime: file.type, data: toBase64(new Uint8Array(await file.arrayBuffer())) });

export async function shareFile(file: File, app?: string): Promise<void> {
  await FileShare.share({ ...(await asPlugin(file)), ...(app ? { app } : {}) });
}

/** D58 "PDF always downloads": into Downloads; on Android 7-9 (no MediaStore Downloads) the share sheet with the PDF instead. */
export async function savePdf(file: File): Promise<"saved" | "shared"> {
  const options = await asPlugin(file);
  if ((await FileShare.saveToDownloads(options)).saved) return "saved";
  await FileShare.share(options);
  return "shared";
}
