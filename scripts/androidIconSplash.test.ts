import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// KB-425 (owner, 20 Nov 2026; D123): the Android app's icon, splash and shell, checked in the files Gradle builds from (the flavours and
// the version are scripts/androidShell.test.ts).

const ROOT = join(__dirname, "..");
const RES = join(ROOT, "android", "app", "src", "main", "res");
const read = (...p: string[]) => readFileSync(join(...p), "utf8");
const pngSize = (file: string) => {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 } as const;

describe("the app icon (26 §4)", () => {
  it("adaptive, square and round: background, foreground and the monochrome layer (Android 13+ themed icons)", () => {
    for (const f of ["ic_launcher.xml", "ic_launcher_round.xml"]) {
      const xml = read(RES, "mipmap-anydpi-v26", f);
      expect(xml, f).toContain('<background android:drawable="@color/ic_launcher_background"/>');
      expect(xml, f).toContain('<foreground android:drawable="@mipmap/ic_launcher_foreground"/>');
      expect(xml, f).toContain('<monochrome android:drawable="@mipmap/ic_launcher_monochrome"/>');
    }
  });

  it("blue for the real app, red for KVB Test", () => {
    expect(read(RES, "values", "ic_launcher_background.xml")).toContain(">#2563D9<");
    expect(read(ROOT, "android", "app", "src", "kvbtest", "res", "values", "ic_launcher_background.xml")).toContain("#C0392B");
  });

  it("every density has its layers and legacy icons at the right size (made by scripts/makeIcons.ts)", () => {
    for (const [d, k] of Object.entries(DENSITY)) {
      for (const f of ["ic_launcher_foreground", "ic_launcher_monochrome"]) expect(pngSize(join(RES, `mipmap-${d}`, `${f}.png`)), `${d} ${f}`).toEqual([108 * k, 108 * k]);
      for (const f of ["ic_launcher", "ic_launcher_round"]) expect(pngSize(join(RES, `mipmap-${d}`, `${f}.png`)), `${d} ${f}`).toEqual([48 * k, 48 * k]);
      expect(pngSize(join(RES, `drawable-${d}`, "splash_icon.png")), d).toEqual([288 * k, 288 * k]);
    }
  });

  it("the Play listing icon: 512 x 512", () => {
    expect(pngSize(join(ROOT, "docs", "play", "icon-512.png"))).toEqual([512, 512]);
  });
});

describe("the splash", () => {
  it("blue + the light logo, then the app's theme; the old splash pictures are gone", () => {
    const styles = read(RES, "values", "styles.xml");
    expect(styles).toContain('<item name="windowSplashScreenBackground">@color/splash_background</item>');
    expect(styles).toContain('<item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>');
    expect(styles).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    expect(styles).not.toContain("@drawable/splash<");
    expect(read(RES, "values", "splash.xml")).toContain('<color name="splash_background">#2563D9</color>');
    expect(existsSync(join(RES, "drawable", "splash.png"))).toBe(false);
  });

  it("MainActivity holds it until the web app's ready() - and never longer than 5 s", () => {
    const main = read(ROOT, "android", "app", "src", "main", "java", "com", "kiranavoicebill", "app", "MainActivity.kt");
    expect(main).toContain("const val SPLASH_MAX_MS = 5_000L");
    expect(main).toMatch(/installSplashScreen\(\)\.setKeepOnScreenCondition \{ !AppShellState\.ready && SystemClock\.uptimeMillis\(\) - shown < SPLASH_MAX_MS \}/);
    expect(main.indexOf("installSplashScreen()")).toBeLessThan(main.indexOf("super.onCreate"));
    expect(main).toContain("if (savedInstanceState == null) AppShellState.ready = false");
    expect(main).toContain("registerPlugin(AppShellPlugin::class.java)");
    expect(main).toContain('bridge.webView.setBackgroundColor(Color.parseColor("#2563D9"))');
  });

  it("the plugin's name matches the web side", () => {
    const plugin = read(ROOT, "android", "app", "src", "main", "java", "com", "kiranavoicebill", "app", "AppShellPlugin.kt");
    expect(plugin).toContain('@CapacitorPlugin(name = "AppShell")');
    for (const m of ["fun ready(", "fun permissionState(", "fun openSettings(", "fun openBluetoothSettings("]) expect(plugin).toContain(m);
    // KB-416 (D125): Choose printer searches by itself only when the search is already allowed - "scan" = scan + connect (12+)
    expect(plugin).toMatch(/"scan" -> if \(Build\.VERSION\.SDK_INT >= Build\.VERSION_CODES\.S\) \{\s+arrayOf\(Manifest\.permission\.BLUETOOTH_SCAN, Manifest\.permission\.BLUETOOTH_CONNECT\)/);
    expect(plugin).toContain("Intent(Settings.ACTION_BLUETOOTH_SETTINGS)");
    // owner's phone test (20 Nov 2026): "can Android still ask" is judged on the MISSING parts only; Android 11 and older: nothing
    expect(plugin).toContain("val canAsk = missing.any { ActivityCompat.shouldShowRequestPermissionRationale(activity, it) }");
    expect(plugin).toMatch(/\} else \{\s+emptyArray\(\)\s+\}/);
    expect(read(ROOT, "src", "data", "appShell.ts")).toContain('registerPlugin<AppShellPlugin>("AppShell")');
  });
});
