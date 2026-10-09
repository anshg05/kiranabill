// KB-401 (D67): which build this page is - stamped by vite.config.ts (`define`), shown in Settings so support can
// see which version a phone has. "dev" when nothing stamped it.
declare const __BUILD_ID__: string;
export const BUILD_ID: string = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev";

/** True in a build made with src/sw/mode.txt = kill: its pages must never register a worker (D67). */
declare const __KB_SW_KILL__: boolean;
export const SW_KILL_BUILD: boolean = typeof __KB_SW_KILL__ === "boolean" ? __KB_SW_KILL__ : false;
