import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import { startServiceWorker } from "@/pwa/register";
import "./index.css";
import { markCold } from "@/ui/coldMarks";

// KB-352: every import above has been parsed and run - the bundle is ready (cold-start milestone "js").
markCold("js");

const root = createRoot(document.getElementById("root")!);
// DEV ONLY (KB-305, NI-28): the type-ahead bench for a real phone. A build-time
// `false` in production, so the import and its chunk (with the seed) are gone.
if (import.meta.env.DEV && window.location.pathname === "/__dev/typeahead") {
  void import("@/ui/DevTypeaheadBench").then(({ DevTypeaheadBench }) => root.render(<DevTypeaheadBench />));
} else if (import.meta.env.DEV && window.location.pathname === "/__dev/history") {
  // DEV ONLY (KB-310): History's load and search times on a real phone.
  void import("@/ui/DevHistoryBench").then(({ DevHistoryBench }) => root.render(<DevHistoryBench />));
} else if (import.meta.env.VITE_ACCEPTANCE === "1" && new URLSearchParams(window.location.search).has("session")) {
  // DRAFT BUILDS ONLY (KB-364): the acceptance-order recorder. VITE_ACCEPTANCE is set only when a draft is built; in any other build
  // this condition is a build-time `false`, so the import and its chunk are gone (scripts/check-recorder-absent.ts proves it).
  void import("@/acceptance/RecorderSession").then(({ RecorderSession }) => root.render(<RecorderSession />));
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
// KB-401: production only (nothing registers in the dev server); after the first render, never before it.
startServiceWorker();
