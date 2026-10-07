import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
// DEV ONLY (KB-305, NI-28): the type-ahead bench for a real phone. A build-time
// `false` in production, so the import and its chunk (with the seed) are gone.
if (import.meta.env.DEV && window.location.pathname === "/__dev/typeahead") {
  void import("@/ui/DevTypeaheadBench").then(({ DevTypeaheadBench }) => root.render(<DevTypeaheadBench />));
} else if (import.meta.env.DEV && window.location.pathname === "/__dev/history") {
  // DEV ONLY (KB-310): History's load and search times on a real phone.
  void import("@/ui/DevHistoryBench").then(({ DevHistoryBench }) => root.render(<DevHistoryBench />));
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
