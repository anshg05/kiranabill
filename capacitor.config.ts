import type { CapacitorConfig } from "@capacitor/cli";

// KB-406 S1 (D111): the Android shell. Option (b) step 3 (owner, 18 Nov 2026): the screens are BUNDLED in the APK (webDir dist, no
// server.url) - billing works with no network from the first start. The origin is written out, not left to Capacitor's defaults:
// /voice-run's CORS allows exactly https://localhost (netlify/functions/_shared/cors.ts), so a changed default must fail a test.
const config: CapacitorConfig = {
  appId: "com.kiranavoicebill.app",
  appName: "Kirana Voice Bill",
  webDir: "dist",
  server: {
    androidScheme: "https",
    hostname: "localhost",
  },
};

export default config;
