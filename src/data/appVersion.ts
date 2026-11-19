// D116 (owner, 19 Nov 2026): this build's Android versionCode - stamped by vite.config.ts from app-version.json, the ONE source of the
// version (android/app/build.gradle reads the same file). Compared as a whole number, never as text. 0 when nothing stamped it.
declare const __APP_VERSION_CODE__: number;
export const APP_VERSION_CODE: number = typeof __APP_VERSION_CODE__ === "number" ? __APP_VERSION_CODE__ : 0;
