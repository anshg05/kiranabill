import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import config from "../capacitor.config";

// KB-406 S1 (D111): the Android shell's settings are decisions, not defaults - this pins them.

const ROOT = path.resolve(__dirname, "..");
const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");
const manifest = read("android/app/src/main/AndroidManifest.xml");
const permissions = [...manifest.matchAll(/<uses-permission\s+android:name="([^"]+)"/g)].map((m) => m[1]);

describe("the Android shell (D111)", () => {
  it("has the final name and application id", () => {
    expect(config.appId).toBe("com.kiranavoicebill.app");
    expect(config.appName).toBe("Kirana Voice Bill");
    expect(read("android/app/build.gradle")).toContain('applicationId "com.kiranavoicebill.app"');
  });

  it("loads the release-draft site over https only (KB-410 decides production)", () => {
    expect(config.server?.url).toBe("https://release-draft--kiranabilling.netlify.app");
    expect(config.server?.cleartext).not.toBe(true);
    expect(config.android?.allowMixedContent).not.toBe(true);
  });

  it("targets SDK 36 with minimum Android 7.0 (API 24)", () => {
    const vars = read("android/variables.gradle");
    expect(vars).toMatch(/minSdkVersion = 24\b/);
    expect(vars).toMatch(/compileSdkVersion = 36\b/);
    expect(vars).toMatch(/targetSdkVersion = 36\b/);
  });

  it("asks only for what it needs: the internet, the microphone and Bluetooth printers (KB-408)", () => {
    expect(permissions.sort()).toEqual([
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.BLUETOOTH",
      "android.permission.BLUETOOTH_ADMIN",
      "android.permission.BLUETOOTH_CONNECT",
      "android.permission.BLUETOOTH_SCAN",
      "android.permission.INTERNET",
      "android.permission.MODIFY_AUDIO_SETTINGS",
      "android.permission.RECORD_AUDIO",
    ]);
  });

  it("Bluetooth (KB-408): the scan never derives location; the old-Android permissions and location stop at SDK 30", () => {
    const tag = (name: string) => manifest.match(new RegExp(`<uses-permission\\s+android:name="android.permission.${name}"[^>]*/>`))?.[0] ?? "";
    expect(tag("BLUETOOTH_SCAN")).toMatch(/android:usesPermissionFlags="neverForLocation"/);
    expect(tag("BLUETOOTH_SCAN")).toMatch(/tools:node="replace"/); // the BLE plugin's own BLUETOOTH_SCAN has no flag
    for (const old of ["BLUETOOTH", "BLUETOOTH_ADMIN", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"]) expect(tag(old), old).toMatch(/android:maxSdkVersion="30"/);
    for (const loc of ["ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"]) expect(tag(loc), loc).toMatch(/tools:node="replace"/); // the plugin's are uncapped
    expect(tag("BLUETOOTH_CONNECT")).not.toMatch(/maxSdkVersion/);
    expect(manifest).toMatch(/<uses-feature android:name="android.hardware.bluetooth" android:required="false"/); // phones without Bluetooth still install
  });

  it("native code is Kotlin only: MainActivity registers our Classic printer plugin (KB-408)", () => {
    const dir = "android/app/src/main/java/com/kiranavoicebill/app";
    expect(() => read(`${dir}/MainActivity.java`)).toThrow();
    const activity = read(`${dir}/MainActivity.kt`);
    expect(activity).toMatch(/registerPlugin\(ClassicPrinterPlugin::class\.java\)[\s\S]*super\.onCreate/); // before super, or it is never found
    const plugin = read(`${dir}/ClassicPrinterPlugin.kt`);
    expect(plugin).toContain('UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")'); // the serial-port profile
    expect(plugin).toContain('name = "ClassicPrinter"');
    expect(read("android/app/build.gradle")).toMatch(/apply plugin: 'kotlin-android'/);
    expect(read("android/build.gradle")).toMatch(/ext\.kotlin_version = '2\.2\.20'/);
  });

  it("keeps the shop's data out of Android's cloud and adb backups", () => {
    // the phone holds bills, customer names and the sign-in session; the server is the copy that is backed up (D75)
    expect(manifest).toMatch(/android:allowBackup="false"/);
    // Android 12+ ignores allowBackup for device-to-device transfer: the rules file must exclude every domain from both
    expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    const rules = read("android/app/src/main/res/xml/data_extraction_rules.xml");
    for (const section of ["cloud-backup", "device-transfer"]) {
      const body = rules.match(new RegExp(`<${section}>([\\s\\S]*?)</${section}>`))?.[1] ?? "";
      expect([...body.matchAll(/<exclude domain="(\w+)"/g)].map((m) => m[1]).sort(), section).toEqual(["database", "external", "file", "root", "sharedpref"]);
      expect(body, section).not.toMatch(/<include/);
    }
    expect(manifest).not.toMatch(/usesCleartextTraffic="true"/);
  });

  it("pins every Capacitor package to an exact version", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    const cap = Object.entries(all).filter(([name]) => name.startsWith("@capacitor/") || name.startsWith("@capacitor-community/"));
    expect(Object.fromEntries(cap)).toEqual({ "@capacitor-community/bluetooth-le": "8.3.0", "@capacitor/android": "8.5.3", "@capacitor/app": "8.1.2", "@capacitor/browser": "8.0.5", "@capacitor/cli": "8.5.3", "@capacitor/core": "8.5.3" });
  });
  it("opens for ONE app link only: the sign-in return (KB-409)", () => {
    const filters = [...manifest.matchAll(/<intent-filter[^>]*>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]!);
    const links = filters.filter((f) => f.includes("android.intent.action.VIEW"));
    expect(links).toHaveLength(1);
    const data = [...links[0]!.matchAll(/<data\s+([^>]*?)\s*\/>/g)].map((m) => m[1]!.trim().split(/\s+/).sort().join(" "));
    expect(data).toEqual(['android:host="auth-callback" android:scheme="com.kiranavoicebill.app"']);
    expect(links[0]).toContain("android.intent.category.BROWSABLE"); // Chrome must be allowed to hand the link over
    expect(links[0]).toContain("android.intent.category.DEFAULT");
    expect(manifest).not.toMatch(/android:scheme="https?"/); // no web link claimed without verification (KB-410)
    expect(manifest).toMatch(/android:launchMode="singleTask"/); // the link returns to the running app and closes the tab above it
  });
});
