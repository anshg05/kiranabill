import { installWorker, type SwConfig, type WorkerScope } from "./worker";

// KB-401 (D67): the entry bundled to dist/sw.js by scripts/pwa-build.ts, which injects the precache list.
declare const __KB_SW__: SwConfig;
installWorker(self as unknown as WorkerScope, __KB_SW__);
