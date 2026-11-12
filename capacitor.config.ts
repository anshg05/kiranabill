import type { CapacitorConfig } from "@capacitor/cli";

// KB-406 S1 (D111): the Android shell. For testing it loads the release-draft site, so /voice, /voice-run, the service worker and
// Supabase work exactly as in the browser; KB-410 decides what production loads (bundled or remote).
const config: CapacitorConfig = {
  appId: "com.kiranavoicebill.app",
  appName: "Kirana Voice Bill",
  webDir: "dist",
  server: {
    url: "https://release-draft--kiranabilling.netlify.app",
  },
};

export default config;
