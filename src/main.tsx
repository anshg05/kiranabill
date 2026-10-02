import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "@/app/App";
import "./index.css";

const root = createRoot(document.getElementById("root")!);
// DEV ONLY (KB-305, NI-28): the type-ahead bench for a real phone. A build-time
// `false` in production, so the import and its chunk (with the seed) are gone.
if (import.meta.env.DEV && window.location.pathname === "/__dev/typeahead") {
  void import("@/ui/DevTypeaheadBench").then(({ DevTypeaheadBench }) => root.render(<DevTypeaheadBench />));
} else {
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
